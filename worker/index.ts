// The Worker in front of everything: the board API and its WebSockets; every
// other path is the single-page app from ./dist (wrangler serves it).
import { BoardRoom, validTemplate, type Env } from "./room";
import { BOARD_ID, newBoardId } from "../src/shared/ids";

export { BoardRoom };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") return json({ ok: true, service: "longtable" });

    // Start a board: { template: "pell-and-rye" | "blank" } → { id }.
    if (path === "/api/boards" && request.method === "POST") {
      let body: { template?: unknown } = {};
      try {
        body = await request.json();
      } catch {
        // an empty body makes a blank board
      }
      const template = validTemplate(body.template) ? (body.template as string) : "blank";
      const id = newBoardId();
      const room = env.BOARDS.get(env.BOARDS.idFromName(id));
      await room.seed(template);
      return json({ id }, 201);
    }

    const m = /^\/api\/boards\/([a-z0-9]+)\/(ws|snapshot)$/.exec(path);
    if (m) {
      if (!BOARD_ID.test(m[1])) return json({ error: "No such board" }, 404);
      const room = env.BOARDS.get(env.BOARDS.idFromName(m[1]));
      return room.fetch(request);
    }

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
