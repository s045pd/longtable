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

/** Room set aside for counting wrong team passwords; its name can never be a board's. */
const GATE = "_gate";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // createPassword: whether starting a board asks for the team password.
    if (path === "/api/health") return json({ ok: true, service: "longtable", createPassword: !!env.CREATE_PASSWORD });

    // Start a board: { template, password? } → { id, edit, owner }, the keys of its links.
    if (path === "/api/boards" && request.method === "POST") {
      if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "Send JSON" }, 415);
      let body: { template?: unknown; password?: unknown } = {};
      try {
        body = await request.json();
      } catch {
        // an empty body makes a blank board
      }
      if (env.CREATE_PASSWORD) {
        const gate = env.BOARDS.get(env.BOARDS.idFromName(GATE));
        const r = await gate.gate(request.headers.get("CF-Connecting-IP") ?? "local", body.password, env.CREATE_PASSWORD);
        if (!r.ok) return json({ error: "team-password", ...(r.wait ? { wait: r.wait } : {}) }, r.wait ? 429 : 401, r.wait ? { "retry-after": String(r.wait) } : {});
      }
      const template = validTemplate(body.template) ? (body.template as string) : "blank";
      const id = newBoardId();
      const keys = await env.BOARDS.get(env.BOARDS.idFromName(id)).seed(template);
      if (!keys) return json({ error: "Try again" }, 409);
      return json({ id, ...keys }, 201);
    }

    const m = /^\/api\/boards\/([a-z0-9]+)\/(ws|snapshot)$/.exec(path);
    if (m) {
      if (!BOARD_ID.test(m[1])) return json({ error: "No such board" }, 404);
      // Only this site's pages may open a board's socket.
      const origin = request.headers.get("Origin");
      if (m[2] === "ws" && origin && origin !== url.origin) return json({ error: "Wrong origin" }, 403);
      const room = env.BOARDS.get(env.BOARDS.idFromName(m[1]));
      return room.fetch(request);
    }

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
