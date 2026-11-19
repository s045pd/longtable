// One board's room: a Durable Object that holds the board, keeps it in its
// own SQLite storage, and relays changes, cursors and reactions between the
// people who have it open. It uses hibernating WebSockets, so an idle board
// costs nothing while its tabs stay connected.
//
// Nobody gets in on the board's address alone. A hello has to bring the key
// from an edit or watch link, or the owner key; a board with a password
// also wants the password (or the pass it gave for it last time). The owner
// can set and change the password, make new links, and delete the board.
import { DurableObject } from "cloudflare:workers";
import { LIMITS, cleanColor, cleanCoord, cleanEffect, cleanName, cleanOp, cleanPresence, cleanReaction } from "../src/shared/schema";
import { BoardState } from "../src/shared/state";
import { TEMPLATES, makeTemplate, type TemplateName } from "../src/shared/templates";
import type { AdminAct, ClientMessage, DeniedReason, Item, Meta, Op, Person, PlanNote, PlanTrouble, Presence, Role, ServerMessage } from "../src/shared/types";
import { newKey, randomId } from "../src/shared/ids";
import { FORGET_TRIES_MS, PASSWORD_MAX, PASSWORD_MIN, Tries, accessFor, addressKey, checkPassword, cleanZone, hashPassword, newLock, roleFor, same, sha256, type Lock, type TryRecord, type TryStore } from "./access";
import { fileStem, toIcs } from "../src/shared/exporter";
import { PLAN_MAX_CHARS, planMessages, readPlan } from "../src/shared/plan";

export interface Env {
  BOARDS: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** When set, starting a board needs this password (see DEPLOY.md). */
  CREATE_PASSWORD?: string;
  /** Workers AI, which reads a pasted chat into notes. Missing in `wrangler dev --local`: boards then read the chat line by line. */
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  /** The Workers AI model for reading chats, if not the default. */
  AI_MODEL?: string;
}

/** Good at Chinese and English, and cheap: a group chat costs 40 to 80 neurons, so the free plan's 10,000 a day read 150 or more. */
export const DEFAULT_AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
/** Chats one address may have read on one board in an hour, so nobody spends the day's free AI alone. */
const PLANS_PER_HOUR = 20;
/** How long the model may take; it thinks first, which for a long chat can be most of a minute. */
const PLAN_TIMEOUT_MS = 100_000;

interface Attachment {
  pid: string;
  name: string;
  color: string;
  /** In the room: gets everyone's changes and cursors. */
  ready: boolean;
  /** Set once the link checked out. */
  role?: Role;
  /** The link checked out, the password has not yet. */
  locked?: boolean;
  /** A hash of the address the socket comes from, to count wrong passwords. */
  ip: string;
  /** Wrong passwords on this socket. */
  fails?: number;
}

/** What starting a board hands back: the keys of its links. */
export interface NewBoard {
  edit: string;
  owner: string;
}

const EMPTY_META: Meta = { client: "My team", file: "This week", weekOf: "", template: "" };
const MAX_MESSAGE = 512 * 1024;
/**
 * Changes reach everyone at once but are written to storage at most this
 * often, each item once with its latest state. A drag sends dozens of moves a
 * second; writing each would spend the free plan's 100,000 rows a day in an
 * hour of planning. A pending write keeps the room awake, so nothing waits
 * through hibernation, and the last person leaving writes at once.
 */
const FLUSH_MS = 1000;
/** Boards one address may start in an hour, so a script can't spend the day's free writes. */
const BOARDS_PER_HOUR = 30;

/** What the check in front of starting a board says. */
export type StartCheck = { ok: true } | { ok: false; why: "password" | "busy"; wait?: number };

/** Wrong tries kept in the room's own SQLite, so they outlast the room sleeping. */
class SqlTryStore implements TryStore {
  constructor(private sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS tries (who TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL, at INTEGER NOT NULL)");
    sql.exec("DELETE FROM tries WHERE at < ?", Date.now() - FORGET_TRIES_MS);
  }
  get(who: string): TryRecord | undefined {
    return this.sql.exec<{ n: number; until: number; at: number }>("SELECT n, until, at FROM tries WHERE who = ?", who).toArray()[0];
  }
  set(who: string, t: TryRecord) {
    this.sql.exec("INSERT OR REPLACE INTO tries (who, n, until, at) VALUES (?, ?, ?, ?)", who, t.n, t.until, t.at);
  }
  delete(who: string) {
    this.sql.exec("DELETE FROM tries WHERE who = ?", who);
  }
}

export class BoardRoom extends DurableObject<Env> {
  private state!: BoardState;
  private presence = new Map<string, Presence>();
  /** Messages per socket in the current second, to keep one tab from flooding the room. */
  private budget = new Map<string, { at: number; n: number }>();
  private dirty = new Set<string>();
  private metaDirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** The board's keys and password; null on a board made before boards had keys, or none at all. */
  private lock: Lock | null = null;
  private tries!: Tries;
  /** Sockets whose hello is being checked: a second hello meanwhile only renames. */
  private checking = new Set<string>();
  /** Sockets with a chat being read; one at a time each. */
  private planning = new Set<string>();

  /** When the board last wrote its "touched" time (once a minute is plenty). */
  private touchedAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.load());
    // Tabs ping every 25 seconds to keep their socket open. The runtime answers
    // without waking the room, so open but quiet tabs cost nothing.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  private load() {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    const meta = this.row("meta");
    const items = sql.exec<{ data: string }>("SELECT data FROM items").toArray().map((r) => JSON.parse(r.data) as Item);
    this.state = new BoardState(meta ? (JSON.parse(meta) as Meta) : EMPTY_META, items);
    const lock = this.row("lock");
    this.lock = lock ? (JSON.parse(lock) as Lock) : null;
    this.tries = new Tries(new SqlTryStore(sql));
  }

  private row(k: string): string | null {
    return this.ctx.storage.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", k).toArray()[0]?.v ?? null;
  }

  private get seeded() {
    return this.row("meta") !== null;
  }

  /** When the board was deleted, if it was. */
  private get deletedAt(): string | null {
    return this.row("deleted");
  }

  private saveLock() {
    if (this.lock) this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('lock', ?)", JSON.stringify(this.lock));
  }

  private saveMeta() {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('meta', ?)", JSON.stringify(this.state.meta));
    this.touch();
  }

  /** Note when the board last changed, at most once a minute. */
  private touch() {
    const now = Date.now();
    if (now - this.touchedAt < 60_000) return;
    this.touchedAt = now;
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('touched', ?)", new Date(now).toISOString());
  }

  /** Remember that something changed; it is written within FLUSH_MS. */
  private later(id: string | null) {
    if (id === null) this.metaDirty = true;
    else this.dirty.add(id);
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Write everything that changed since the last write. */
  private flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.dirty.size && !this.metaDirty) return;
    for (const id of this.dirty) this.saveItem(id);
    this.dirty.clear();
    if (this.metaDirty) this.saveMeta();
    else this.touch();
    this.metaDirty = false;
  }

  private saveItem(id: string) {
    const it = this.state.items.get(id);
    if (it) this.ctx.storage.sql.exec("INSERT OR REPLACE INTO items (id, data) VALUES (?, ?)", id, JSON.stringify(it));
    else this.ctx.storage.sql.exec("DELETE FROM items WHERE id = ?", id);
  }

  /** Fill a new board from a template and give it keys. Returns null for a board that already exists. */
  async seed(template: string): Promise<NewBoard | null> {
    if (this.seeded || this.deletedAt) return null;
    const name: TemplateName = (TEMPLATES as readonly string[]).includes(template) ? (template as TemplateName) : "blank";
    const seed = makeTemplate(name);
    const { lock, ownerKey } = await newLock();
    this.lock = lock;
    this.state = new BoardState(seed.meta, seed.items);
    for (const it of seed.items) this.saveItem(it.id);
    this.saveMeta();
    this.saveLock();
    return { edit: lock.edit, owner: ownerKey };
  }

  /**
   * The check in front of starting a board. It runs in one room set aside for
   * it: the team password, when the deployment has one, with wrong guesses
   * counted (and slowed) like a board's; then at most BOARDS_PER_HOUR boards
   * an hour from one address.
   */
  async mayStart(ip: string | null, given: unknown, expected: string | undefined): Promise<StartCheck> {
    const who = await addressKey(ip);
    if (expected) {
      const wait = this.tries.wait(who);
      if (wait) return { ok: false, why: "password", wait };
      const next = this.tries.fail(who);
      if (typeof given !== "string" || !same(await sha256(given), await sha256(expected))) {
        return { ok: false, why: "password", ...(next ? { wait: next } : {}) };
      }
      this.tries.clear(who);
    }
    const wait = this.count("started", who, BOARDS_PER_HOUR);
    return wait ? { ok: false, why: "busy", wait } : { ok: true };
  }

  /**
   * Count one more of something an address may do `limit` times an hour.
   * Returns 0 and counts it when it is allowed, or the seconds to wait.
   */
  private count(table: "started" | "plans", who: string, limit: number): number {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    sql.exec(`CREATE TABLE IF NOT EXISTS ${table} (who TEXT PRIMARY KEY, n INTEGER NOT NULL, since INTEGER NOT NULL)`);
    sql.exec(`DELETE FROM ${table} WHERE since < ?`, now - 3600_000);
    const row = sql.exec<{ n: number; since: number }>(`SELECT n, since FROM ${table} WHERE who = ?`, who).toArray()[0];
    if (row && row.n >= limit) return Math.max(1, Math.ceil((row.since + 3600_000 - now) / 1000));
    sql.exec(`INSERT OR REPLACE INTO ${table} (who, n, since) VALUES (?, ?, ?)`, who, (row?.n ?? 0) + 1, row?.since ?? now);
    return 0;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/snapshot")) return this.snapshot(request);
    const cal = /^\/api\/boards\/([a-z0-9]+)\/cal\/([a-z0-9]+)\.ics$/.exec(url.pathname);
    if (cal) return this.calendar(cal[1], cal[2], url.searchParams.get("tz"));
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = { pid: randomId(8), name: "", color: "#FFFFFF", ready: false, ip: await addressKey(request.headers.get("CF-Connecting-IP")) };
    server.serializeAttachment(attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The whole board as JSON, for the same keys (and password pass) a hello needs, sent as headers. */
  private async snapshot(request: Request): Promise<Response> {
    const h = request.headers;
    if (this.deletedAt || !this.seeded || !this.lock) return Response.json({ error: "No such board" }, { status: 404 });
    const role = await roleFor(this.lock, h.get("x-longtable-key"), h.get("x-longtable-owner"));
    if (!role) return Response.json({ error: "That link does not open this board" }, { status: 403 });
    if (role !== "owner" && this.lock.pw && !same(h.get("x-longtable-pass"), this.lock.pass)) {
      return Response.json({ error: "This board has a password" }, { status: 401 });
    }
    return Response.json({ meta: this.state.meta, items: this.state.list() }, { headers: { "cache-control": "no-store" } });
  }

  /**
   * The board's week as a calendar feed, for Google, Apple or Outlook
   * calendars to subscribe to. Its own key, in the address (calendar apps
   * can't keep one after a #), opens only this: no edits, no live board.
   * New links or a new password give the board a new one.
   */
  private calendar(boardId: string, key: string, tz: string | null): Response {
    const headers = { "cache-control": "no-cache", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
    if (this.deletedAt) return new Response("This board was deleted.\n", { status: 410, headers });
    if (!this.seeded || !this.lock?.cal || !same(key, this.lock.cal)) return new Response("No such calendar.\n", { status: 404, headers });
    const meta = this.state.meta;
    return new Response(toIcs(meta, this.state.list(), boardId, new Date(), { tz: cleanZone(tz) }), {
      headers: { ...headers, "content-type": "text/calendar; charset=utf-8", "content-disposition": `inline; filename="${fileStem(meta)}.ics"` },
    });
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
      if (a?.ready) out.push({ ...this.person(a), p: this.presence.get(a.pid) });
    }
    return out;
  }

  private person(a: Attachment): Person {
    return { pid: a.pid, name: a.name, color: a.color, ...(a.role === "viewer" ? { view: true } : {}) };
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
    if (!this.allowed(me.pid)) return;

    if (msg.t === "hello") return this.hello(ws, me, msg);
    if (msg.t === "unlock") return this.unlock(ws, me, msg.pw);
    if (!me.ready) return;
    if (msg.t === "admin") return this.admin(ws, me, msg);

    if (msg.t === "ops") {
      if (!Array.isArray(msg.ops)) return;
      // The watch link can look, point and react, never change.
      if (me.role === "viewer") {
        if (typeof msg.tx === "number") this.send(ws, { t: "ack", tx: msg.tx, rejected: msg.ops.length });
        return;
      }
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
        this.later(op.op === "meta" ? null : op.op === "put" ? op.item.id : op.id);
      }
      if (typeof msg.tx === "number") this.send(ws, { t: "ack", tx: msg.tx, ...(rejected ? { rejected } : {}) });
      if (applied.length) {
        const fx = cleanEffect(msg.fx);
        this.broadcast({ t: "ops", from: me.pid, ops: applied, ...(fx ? { fx } : {}) }, ws);
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
    if (msg.t === "plan") return this.plan(ws, me, msg);
    if (msg.t === "react") {
      const kind = cleanReaction(msg.kind);
      const x = cleanCoord(msg.x);
      const y = cleanCoord(msg.y);
      if (kind && x !== undefined && y !== undefined) this.broadcast({ t: "react", pid: me.pid, kind, x, y }, ws);
    }
  }

  // --------------------------------------------------------- reading a chat
  /**
   * Read a pasted chat into notes with Workers AI and send them back to the
   * one who asked; they look them over and add them as ordinary notes. The
   * chat itself is never stored or logged.
   */
  private async plan(ws: WebSocket, me: Attachment, msg: Extract<ClientMessage, { t: "plan" }>) {
    const reply = (r: { ok: true; notes: PlanNote[] } | { ok: false; why: PlanTrouble; wait?: number }) => this.send(ws, { t: "plan", ...r });
    if (me.role === "viewer") return reply({ ok: false, why: "view" });
    if (this.planning.has(me.pid)) return;
    const text = typeof msg.text === "string" ? msg.text.trim().slice(0, PLAN_MAX_CHARS) : "";
    if (!text) return reply({ ok: false, why: "empty" });
    if (!this.env.AI) return reply({ ok: false, why: "off" });
    const wait = this.count("plans", me.ip, PLANS_PER_HOUR);
    if (wait) return reply({ ok: false, why: "busy", wait });
    this.planning.add(me.pid);
    try {
      const today = typeof msg.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(msg.today) ? msg.today : new Date().toISOString().slice(0, 10);
      const ask = this.env.AI.run(this.env.AI_MODEL || DEFAULT_AI_MODEL, {
        messages: planMessages(text, this.state.meta.weekOf, today),
        max_tokens: 6000,
        temperature: 0.2,
      });
      const raw = await Promise.race([ask, new Promise((_, no) => setTimeout(() => no(new Error("timed out")), PLAN_TIMEOUT_MS))]);
      // How much of the day's free Workers AI it used: counts only, never the words.
      const usage = (raw as { usage?: unknown } | null)?.usage;
      if (usage) console.log("plan: tokens", JSON.stringify(usage));
      const notes = readPlan(raw);
      if (notes === null) return reply({ ok: false, why: "failed" });
      reply(notes.length ? { ok: true, notes } : { ok: false, why: "empty" });
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      // Only the error, never the chat.
      if (!/run remotely|not supported/i.test(message)) console.warn("plan: Workers AI failed:", message.slice(0, 300));
      // `wrangler dev --local` has the binding but can't run it: that is AI being off.
      reply({ ok: false, why: /4006|neuron|daily free|allocation/i.test(message) ? "spent" : /run remotely|not supported/i.test(message) ? "off" : "failed" });
    } finally {
      this.planning.delete(me.pid);
    }
  }

  // ------------------------------------------------------------- getting in
  private async hello(ws: WebSocket, me: Attachment, msg: Extract<ClientMessage, { t: "hello" }>) {
    me.name = cleanName(msg.name) || "Guest";
    me.color = cleanColor(msg.color) ?? "#8FD0FF";
    // Already in (or being let in): a later hello only renames or recolours.
    if (me.role || this.checking.has(me.pid)) {
      ws.serializeAttachment(me);
      if (me.ready) this.broadcast({ t: "join", person: this.person(me) }, ws);
      return;
    }
    const deleted = this.deletedAt;
    if (deleted) return this.deny(ws, "deleted", deleted);
    if (!this.seeded) return this.deny(ws, "missing");
    ws.serializeAttachment(me);
    this.checking.add(me.pid);
    try {
      await this.letIn(ws, me, msg);
    } finally {
      this.checking.delete(me.pid);
    }
  }

  private async letIn(ws: WebSocket, me: Attachment, msg: Extract<ClientMessage, { t: "hello" }>) {
    let handOver: string | undefined;
    if (!this.lock) {
      // A board from before boards had keys: whoever opens it first becomes its owner.
      const made = await newLock();
      this.lock ??= made.lock;
      if (this.lock === made.lock) {
        this.saveLock();
        handOver = made.ownerKey;
      }
    }
    const role = handOver ? "owner" : await roleFor(this.lock, msg.key, msg.owner);
    if (!role) return this.deny(ws, "link");
    // A board from before calendar feeds gets its feed key now.
    if (!this.lock.cal) {
      this.lock.cal = newKey();
      this.saveLock();
    }
    // A rename may have come in while the keys were checked.
    const latest = ws.deserializeAttachment() as Attachment | null;
    if (latest) Object.assign(me, { name: latest.name, color: latest.color });
    me.role = role;
    if (role !== "owner" && this.lock.pw && !same(msg.pass, this.lock.pass)) {
      me.locked = true;
      ws.serializeAttachment(me);
      return this.send(ws, { t: "locked", ...(this.tries.wait(me.ip) ? { wait: this.tries.wait(me.ip) } : {}) });
    }
    this.admit(ws, me, handOver);
  }

  private async unlock(ws: WebSocket, me: Attachment, pw: unknown) {
    if (!me.locked || !this.lock?.pw) return;
    const wait = this.tries.wait(me.ip);
    if (wait) return this.send(ws, { t: "locked", wrong: true, wait });
    // Counted before the check, so guesses sent all at once still meet the wait.
    const next = this.tries.fail(me.ip);
    const ok = await checkPassword(pw, this.lock.pw);
    // The socket may have gone, or the password changed, while the check ran.
    const now = ws.deserializeAttachment() as Attachment | null;
    if (!now?.locked || !this.lock?.pw || !this.lock.pass) return;
    if (!ok) {
      now.fails = (now.fails ?? 0) + 1;
      ws.serializeAttachment(now);
      this.send(ws, { t: "locked", wrong: true, ...(next ? { wait: next } : {}) });
      if (now.fails >= 30) ws.close(4008, "Too many tries");
      return;
    }
    this.tries.clear(now.ip);
    this.send(ws, { t: "pass", token: this.lock.pass });
    this.admit(ws, now);
  }

  private admit(ws: WebSocket, me: Attachment, ownerKey?: string) {
    me.ready = true;
    me.locked = false;
    me.fails = 0;
    ws.serializeAttachment(me);
    const access = { ...accessFor(this.lock!, me.role!), ...(ownerKey ? { owner: ownerKey } : {}) };
    this.send(ws, { t: "init", you: me.pid, meta: this.state.meta, items: this.state.list(), people: this.people(ws), access });
    this.broadcast({ t: "join", person: this.person(me) }, ws);
  }

  /** Send someone away for good: the socket closes and the tab does not reconnect. */
  private deny(ws: WebSocket, why: DeniedReason, at?: string) {
    this.leave(ws);
    this.send(ws, { t: "denied", why, ...(at ? { at } : {}) });
    try {
      ws.close(4003, why);
    } catch {
      // already closed
    }
  }

  /** Take someone out of the room (they stop getting changes and cursors); the socket stays. */
  private leave(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a?.ready) return;
    a.ready = false;
    ws.serializeAttachment(a);
    this.presence.delete(a.pid);
    this.broadcast({ t: "leave", pid: a.pid }, ws);
  }

  // -------------------------------------------------------- owner's controls
  private async admin(ws: WebSocket, me: Attachment, msg: Extract<ClientMessage, { t: "admin" }>) {
    const done = (act: AdminAct, ok: boolean, message?: string) => this.send(ws, { t: "done", act, ok, ...(message ? { message } : {}) });
    const act = msg.act;
    if (act !== "password" && act !== "links" && act !== "delete") return;
    if (me.role !== "owner" || !this.lock) return done(act, false, "Only the board’s owner can do that.");
    const others = () =>
      this.ctx.getWebSockets().filter((s) => {
        const a = s.deserializeAttachment() as Attachment | null;
        return s !== ws && a?.role && a.role !== "owner";
      });

    if (act === "password") {
      const pw = (msg as { pw: unknown }).pw;
      if (pw === null) {
        delete this.lock.pw;
        delete this.lock.pass;
        this.saveLock();
        // Anyone waiting at the password screen comes straight in.
        for (const s of others()) {
          const a = s.deserializeAttachment() as Attachment;
          if (a.locked) this.admit(s, a);
        }
      } else {
        if (typeof pw !== "string" || pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) {
          return done(act, false, `A password needs ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`);
        }
        this.lock.pw = await hashPassword(pw);
        this.lock.pass = newKey();
        // Calendars subscribed before the new password stop getting the week.
        this.lock.cal = newKey();
        this.saveLock();
        // Everyone but the owners has to give the new password.
        for (const s of others()) {
          this.leave(s);
          const a = s.deserializeAttachment() as Attachment;
          a.locked = true;
          s.serializeAttachment(a);
          this.send(s, { t: "locked" });
        }
      }
      this.tellAccess();
      return done(act, true);
    }

    if (act === "links") {
      this.lock.edit = newKey();
      this.lock.view = newKey();
      this.lock.cal = newKey();
      this.saveLock();
      for (const s of others()) this.deny(s, "link");
      this.tellAccess();
      return done(act, true);
    }

    // Delete: everything goes, and the room keeps only the date it went.
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.dirty.clear();
    this.metaDirty = false;
    const at = new Date().toISOString();
    await this.ctx.storage.deleteAll();
    this.load();
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('deleted', ?)", at);
    this.presence.clear();
    done(act, true);
    for (const s of this.ctx.getWebSockets()) this.deny(s, "deleted", at);
  }

  /** Tell everyone in the room what their access is now. */
  private tellAccess() {
    if (!this.lock) return;
    for (const s of this.ctx.getWebSockets()) {
      const a = s.deserializeAttachment() as Attachment | null;
      if (a?.ready && a.role) this.send(s, { t: "access", access: accessFor(this.lock, a.role) });
    }
  }

  private gone(ws: WebSocket) {
    const me = ws.deserializeAttachment() as Attachment | null;
    if (!me) return;
    this.budget.delete(me.pid);
    this.leave(ws);
    // The last one out writes the board straight away.
    const left = this.ctx.getWebSockets().filter((s) => s !== ws && (s.deserializeAttachment() as Attachment | null)?.ready);
    if (!left.length) this.flush();
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
