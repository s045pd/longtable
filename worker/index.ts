// The Worker in front of everything: the board API and its WebSockets; every
// other path is the single-page app from ./dist (wrangler serves it, with the
// headers in public/_headers).
import { BoardRoom, validTemplate, type Env } from "./room";
import { BOARD_ID, newBoardId } from "../src/shared/ids";

export { BoardRoom };

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
      ...extra,
    },
  });

/** Room set aside for the site's password and the check in front of starting boards; its name can never be a board's. */
const GATE = "_gate";

/** The cookie that lets a browser back in without typing the site's password again. */
const SITE_COOKIE = "longtable_site";
/** How long a browser stays in: half a year, or until the password changes. */
const SITE_COOKIE_DAYS = 180;

/** The site's password as fixed in Cloudflare (its old name too), or undefined when it's picked on the site. */
const fixedPassword = (env: Env) => env.SITE_PASSWORD || env.CREATE_PASSWORD || undefined;

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

const siteCookie = (url: URL, token: string) =>
  `${SITE_COOKIE}=${token}; Path=/; Max-Age=${SITE_COOKIE_DAYS * 86_400}; HttpOnly; SameSite=Lax${url.protocol === "https:" ? "; Secure" : ""}`;

/** A JSON POST from this site's own pages, read; or the response that turns it away. */
async function readPost(request: Request, url: URL): Promise<Record<string, unknown> | Response> {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405, { allow: "POST" });
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "Wrong origin" }, 403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "Send JSON" }, 415);
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // password: whether this Longtable asks for its site password; fixed: whether that is set in Cloudflare (SITE_PASSWORD).
    if (path === "/api/health") {
      const fixed = fixedPassword(env);
      const off = !!fixed && /^\s*(off|none)\s*$/i.test(fixed);
      return json({ ok: true, service: "longtable", password: !off, fixed: !!fixed && !off });
    }

    // The site's password: is this browser in; give it; pick a new one.
    if (path === "/api/site" || path.startsWith("/api/site/")) {
      const gate = env.BOARDS.get(env.BOARDS.idFromName(GATE));
      const ip = request.headers.get("CF-Connecting-IP");
      if (path === "/api/site") return json(await gate.siteStatus(fixedPassword(env), cookie(request, SITE_COOKIE)));
      if (path !== "/api/site/unlock" && path !== "/api/site/password") return json({ error: "Not found" }, 404);
      const body = await readPost(request, url);
      if (body instanceof Response) return body;
      if (path === "/api/site/unlock") {
        const r = await gate.siteUnlock(ip, fixedPassword(env), body.password);
        if (!r.ok) return json({ error: "wrong-password", ...(r.wait ? { wait: r.wait } : {}) }, r.wait ? 429 : 401, r.wait ? { "retry-after": String(r.wait) } : {});
        return json({ ok: true, initial: r.initial }, 200, r.token ? { "set-cookie": siteCookie(url, r.token) } : {});
      }
      const r = await gate.siteChange(ip, fixedPassword(env), body.current, body.next);
      if (!r.ok) {
        const status = r.why === "wrong" ? (r.wait ? 429 : 401) : r.why === "weak" ? 400 : 409;
        return json({ error: r.why, ...(r.message ? { message: r.message } : {}), ...(r.wait ? { wait: r.wait } : {}) }, status, r.wait ? { "retry-after": String(r.wait) } : {});
      }
      return json({ ok: true }, 200, { "set-cookie": siteCookie(url, r.token) });
    }

    // Start a board: { template, password? } → { id, edit, owner }, the keys of its links.
    if (path === "/api/boards" && request.method === "POST") {
      if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "Send JSON" }, 415);
      let body: { template?: unknown; password?: unknown; today?: unknown } = {};
      try {
        body = await request.json();
      } catch {
        // an empty body makes a blank board
      }
      const check = await env.BOARDS.get(env.BOARDS.idFromName(GATE)).mayStart(request.headers.get("CF-Connecting-IP"), body.password, fixedPassword(env), cookie(request, SITE_COOKIE));
      if (!check.ok) {
        const wait = check.wait ? { "retry-after": String(check.wait) } : undefined;
        return json({ error: check.why === "busy" ? "too-many-boards" : "site-password", ...(check.wait ? { wait: check.wait } : {}) }, check.wait ? 429 : 401, wait);
      }
      const template = validTemplate(body.template) ? (body.template as string) : "blank";
      const id = newBoardId();
      const keys = await env.BOARDS.get(env.BOARDS.idFromName(id)).seed(template, typeof body.today === "string" ? body.today : undefined);
      if (!keys) return json({ error: "Try again" }, 409);
      return json({ id, ...keys }, 201);
    }

    const m = /^\/api\/boards\/([a-z0-9]+)\/(ws|snapshot|delete|cal\/[a-z0-9]{26}\.ics|mcp\/[a-z0-9]{26})$/.exec(path);
    if (m) {
      if (!BOARD_ID.test(m[1])) return json({ error: "No such board" }, 404);
      // Only this site's pages may open a board's socket.
      const origin = request.headers.get("Origin");
      if ((m[2] === "ws" || m[2] === "delete") && origin && origin !== url.origin) return json({ error: "Wrong origin" }, 403);
      const room = env.BOARDS.get(env.BOARDS.idFromName(m[1]));
      return room.fetch(request);
    }

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
