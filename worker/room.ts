// One board's room: a Durable Object that holds the board, keeps it in its
// own SQLite storage, and relays changes, cursors and reactions between the
// people who have it open. It uses hibernating WebSockets, so an idle board
// costs nothing while its tabs stay connected.
import { DurableObject } from "cloudflare:workers";
import { LIMITS, cleanColor, cleanCoord, cleanEffect, cleanName, cleanOp, cleanPresence, cleanReaction } from "../src/shared/schema";
import { BoardState } from "../src/shared/state";
import { TEMPLATES, makeTemplate, type TemplateName } from "../src/shared/templates";
import type { ClientMessage, Item, Meta, Op, Person, Presence, ServerMessage } from "../src/shared/types";
import { randomId } from "../src/shared/ids";

export interface Env {
  BOARDS: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

interface Attachment {
  pid: string;
  name: string;
  color: string;
  ready: boolean;
}

const EMPTY_META: Meta = { client: "My team", file: "This week", weekOf: "", template: "" };
const MAX_MESSAGE = 512 * 1024;

export class BoardRoom extends DurableObject<Env> {
  private state!: BoardState;
  private presence = new Map<string, Presence>();
  /** Messages per socket in the current second, to keep one tab from flooding the room. */
  private budget = new Map<string, { at: number; n: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec("CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
      sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
      const metaRow = sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'meta'").toArray()[0];
      const meta = metaRow ? (JSON.parse(metaRow.v) as Meta) : EMPTY_META;
      const items = sql.exec<{ data: string }>("SELECT data FROM items").toArray().map((r) => JSON.parse(r.data) as Item);
      this.state = new BoardState(meta, items);
    });
  }

  private get seeded() {
    return this.ctx.storage.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'meta'").toArray().length > 0;
  }

  private saveMeta() {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('meta', ?)", JSON.stringify(this.state.meta));
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('touched', ?)", new Date().toISOString());
  }

  private saveItem(id: string) {
    const it = this.state.items.get(id);
    if (it) this.ctx.storage.sql.exec("INSERT OR REPLACE INTO items (id, data) VALUES (?, ?)", id, JSON.stringify(it));
    else this.ctx.storage.sql.exec("DELETE FROM items WHERE id = ?", id);
  }

  /** Fill a new board from a template. Does nothing to a board that already exists. */
  seed(template: string): boolean {
    if (this.seeded) return false;
    const name: TemplateName = (TEMPLATES as readonly string[]).includes(template) ? (template as TemplateName) : "blank";
    const seed = makeTemplate(name);
    this.state = new BoardState(seed.meta, seed.items);
    for (const it of seed.items) this.saveItem(it.id);
    this.saveMeta();
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/snapshot")) {
      return Response.json({ meta: this.state.meta, items: this.state.list() });
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    if (!this.seeded) this.seed("blank");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = { pid: randomId(8), name: "", color: "#FFFFFF", ready: false };
    server.serializeAttachment(attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // The socket closed under us; webSocketClose tidies up.
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a?.ready) continue;
      try {
        ws.send(text);
      } catch {
        // ignore
      }
    }
  }

  private people(except?: WebSocket): (Person & { p?: Presence })[] {
    const out: (Person & { p?: Presence })[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.ready) out.push({ pid: a.pid, name: a.name, color: a.color, p: this.presence.get(a.pid) });
    }
    return out;
  }

  private allowed(pid: string): boolean {
    const now = Date.now();
    const b = this.budget.get(pid);
    if (!b || now - b.at > 1000) {
      this.budget.set(pid, { at: now, n: 1 });
      return true;
    }
    b.n++;
    return b.n <= 90;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const me = ws.deserializeAttachment() as Attachment;
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "ping") return this.send(ws, { t: "pong" });

    if (msg.t === "hello") {
      me.name = cleanName(msg.name) || "Guest";
      me.color = cleanColor(msg.color) ?? "#8FD0FF";
      const firstHello = !me.ready;
      me.ready = true;
      ws.serializeAttachment(me);
      // The first hello gets the board; a later one only renames or recolours.
      if (firstHello) this.send(ws, { t: "init", you: me.pid, meta: this.state.meta, items: this.state.list(), people: this.people(ws) });
      this.broadcast({ t: "join", person: { pid: me.pid, name: me.name, color: me.color } }, ws);
      return;
    }
    if (!me.ready || !this.allowed(me.pid)) return;

    if (msg.t === "ops") {
      if (!Array.isArray(msg.ops)) return;
      const applied: Op[] = [];
      let rejected = 0;
      for (const rawOp of msg.ops.slice(0, LIMITS.opsPerMessage)) {
        const op = cleanOp(rawOp, this.state.typeOf);
        if (!op) {
          rejected++;
          continue;
        }
        if (op.op === "put" && !this.state.items.has(op.item.id) && this.state.items.size >= LIMITS.items) {
          rejected++;
          continue;
        }
        if (!this.state.apply(op)) continue;
        applied.push(op);
        if (op.op === "meta") this.saveMeta();
        else this.saveItem(op.op === "put" ? op.item.id : op.id);
      }
      if (typeof msg.tx === "number") this.send(ws, { t: "ack", tx: msg.tx, ...(rejected ? { rejected } : {}) });
      if (applied.length) {
        const fx = cleanEffect(msg.fx);
        this.broadcast({ t: "ops", from: me.pid, ops: applied, ...(fx ? { fx } : {}) }, ws);
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('touched', ?)", new Date().toISOString());
      }
      return;
    }
    if (msg.t === "pres") {
      const p = cleanPresence(msg.p);
      if (!p) return;
      this.presence.set(me.pid, { ...this.presence.get(me.pid), ...p });
      this.broadcast({ t: "pres", pid: me.pid, p }, ws);
      return;
    }
    if (msg.t === "react") {
      const kind = cleanReaction(msg.kind);
      const x = cleanCoord(msg.x);
      const y = cleanCoord(msg.y);
      if (kind && x !== undefined && y !== undefined) this.broadcast({ t: "react", pid: me.pid, kind, x, y }, ws);
    }
  }

  private gone(ws: WebSocket) {
    const me = ws.deserializeAttachment() as Attachment | null;
    if (!me?.ready) return;
    me.ready = false;
    ws.serializeAttachment(me);
    this.presence.delete(me.pid);
    this.budget.delete(me.pid);
    this.broadcast({ t: "leave", pid: me.pid }, ws);
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.gone(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye");
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws);
  }
}

export const validTemplate = (v: unknown) => typeof v === "string" && (TEMPLATES as readonly string[]).includes(v);
