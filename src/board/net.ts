// The link between this tab and the board's room. LiveLink talks to the
// Worker over a WebSocket and reconnects on its own; LocalLink keeps the board
// on this device (localStorage) and shares it between tabs, which is what
// `npm run dev` uses when no Worker is running.
import type { Effect, Item, Meta, Op, Person, Presence, ReactionKind, ServerMessage } from "../shared/types";
import { BoardState } from "../shared/state";
import { makeTemplate, type TemplateName } from "../shared/templates";
import { randomId } from "../shared/ids";

export type LinkStatus = "connecting" | "online" | "offline";

export interface InitData {
  you: string;
  meta: Meta;
  items: Item[];
  people: (Person & { p?: Presence })[];
}

export interface LinkEvents {
  /** The board as the room has it. `pending` are this tab's changes the room has not confirmed yet; apply them on top. */
  init(data: InitData, pending: Op[]): void;
  ops(from: string, ops: Op[], fx?: Effect): void;
  join(person: Person): void;
  leave(pid: string): void;
  presence(pid: string, p: Presence): void;
  reaction(pid: string, kind: ReactionKind, x: number, y: number): void;
  status(status: LinkStatus): void;
}

export interface Link {
  hello(name: string, color: string, cid: string): void;
  ops(ops: Op[], fx?: Effect): void;
  presence(p: Presence): void;
  react(kind: ReactionKind, x: number, y: number): void;
  close(): void;
}

/** Presence is merged and sent at most this often. */
const PRESENCE_MS = 45;

export class LiveLink implements Link {
  private ws: WebSocket | null = null;
  private tx = 0;
  private pending = new Map<number, { ops: Op[]; fx?: Effect }>();
  private me: { name: string; color: string; cid: string } | null = null;
  private retries = 0;
  private closed = false;
  private presenceQueue: Presence | null = null;
  private presenceTimer = 0;
  private lastPresence = 0;
  private ping = 0;
  private status: LinkStatus = "connecting";

  constructor(
    private boardId: string,
    private events: LinkEvents,
  ) {
    this.connect();
    addEventListener("online", () => this.retryNow());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.retryNow();
    });
  }

  private setStatus(s: LinkStatus) {
    if (s === this.status) return;
    this.status = s;
    this.events.status(s);
  }

  private retryNow() {
    if (this.closed || (this.ws && this.ws.readyState <= WebSocket.OPEN)) return;
    this.retries = 0;
    this.connect();
  }

  private connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/boards/${this.boardId}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      if (this.me) ws.send(JSON.stringify({ t: "hello", ...this.me }));
      clearInterval(this.ping);
      this.ping = window.setInterval(() => this.raw({ t: "ping" }), 25_000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.receive(msg);
    };
    ws.onclose = () => {
      clearInterval(this.ping);
      if (this.ws !== ws || this.closed) return;
      this.ws = null;
      this.setStatus(this.retries > 1 ? "offline" : "connecting");
      const wait = Math.min(8000, 400 * 2 ** this.retries) * (0.75 + Math.random() * 0.5);
      this.retries++;
      setTimeout(() => !this.closed && !this.ws && this.connect(), wait);
    };
  }

  private receive(msg: ServerMessage) {
    switch (msg.t) {
      case "init": {
        const pending = [...this.pending.values()];
        this.events.init(msg, pending.flatMap((p) => p.ops));
        this.setStatus("online");
        // Changes made while the link was down go up now, in order.
        const resend = [...this.pending.entries()];
        this.pending.clear();
        for (const [, p] of resend) this.ops(p.ops, p.fx);
        if (this.presenceQueue) this.flushPresence();
        break;
      }
      case "ack":
        this.pending.delete(msg.tx);
        break;
      case "ops":
        this.events.ops(msg.from, msg.ops, msg.fx);
        break;
      case "join":
        this.events.join(msg.person);
        break;
      case "leave":
        this.events.leave(msg.pid);
        break;
      case "pres":
        this.events.presence(msg.pid, msg.p);
        break;
      case "react":
        this.events.reaction(msg.pid, msg.kind, msg.x, msg.y);
        break;
    }
  }

  private raw(msg: unknown): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  hello(name: string, color: string, cid: string) {
    this.me = { name, color, cid };
    this.raw({ t: "hello", ...this.me });
  }

  ops(ops: Op[], fx?: Effect) {
    if (!ops.length) return;
    const tx = ++this.tx;
    this.pending.set(tx, { ops, fx });
    if (this.status === "online") this.raw({ t: "ops", tx, ops, ...(fx ? { fx } : {}) });
  }

  presence(p: Presence) {
    this.presenceQueue = { ...this.presenceQueue, ...p };
    const wait = PRESENCE_MS - (performance.now() - this.lastPresence);
    if (wait <= 0) this.flushPresence();
    else if (!this.presenceTimer) this.presenceTimer = window.setTimeout(() => this.flushPresence(), wait);
  }

  private flushPresence() {
    clearTimeout(this.presenceTimer);
    this.presenceTimer = 0;
    if (!this.presenceQueue || this.status !== "online") return;
    if (this.raw({ t: "pres", p: this.presenceQueue })) {
      this.presenceQueue = null;
      this.lastPresence = performance.now();
    }
  }

  react(kind: ReactionKind, x: number, y: number) {
    this.raw({ t: "react", kind, x, y });
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

/**
 * The board kept on this device. Every tab of the same board shares it through
 * a BroadcastChannel, so two windows side by side still behave like two people.
 */
export class LocalLink implements Link {
  private state: BoardState;
  private channel: BroadcastChannel | null = null;
  private pid = randomId(8);
  private me: Person | null = null;
  private others = new Map<string, Person>();
  private key: string;

  constructor(
    boardId: string,
    private events: LinkEvents,
    template: TemplateName = "blank",
  ) {
    this.key = `longtable:board:${boardId}`;
    this.state = this.load() ?? (() => {
      const seed = makeTemplate(template);
      return new BoardState(seed.meta, seed.items);
    })();
    this.save();
    try {
      this.channel = new BroadcastChannel(this.key);
      this.channel.onmessage = (ev) => this.receive(ev.data);
    } catch {
      this.channel = null;
    }
    addEventListener("pagehide", () => this.post({ t: "leave", pid: this.pid }));
  }

  private load(): BoardState | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return new BoardState(v.meta, v.items);
    } catch {
      return null;
    }
  }

  private save() {
    try {
      localStorage.setItem(this.key, JSON.stringify({ meta: this.state.meta, items: this.state.list() }));
    } catch {
      // storage full or blocked: the board lives until the tab closes
    }
  }

  private post(msg: unknown) {
    this.channel?.postMessage(msg);
  }

  private receive(msg: { t: string; [k: string]: unknown }) {
    switch (msg.t) {
      case "hello": {
        const person = msg.person as Person;
        this.others.set(person.pid, person);
        this.events.join(person);
        if (this.me && msg.reply !== false) this.post({ t: "hello", person: this.me, reply: false });
        break;
      }
      case "leave":
        this.others.delete(msg.pid as string);
        this.events.leave(msg.pid as string);
        break;
      case "ops": {
        const ops = msg.ops as Op[];
        for (const op of ops) this.state.apply(op);
        this.events.ops(msg.from as string, ops, msg.fx as Effect | undefined);
        break;
      }
      case "pres":
        this.events.presence(msg.pid as string, msg.p as Presence);
        break;
      case "react":
        this.events.reaction(msg.pid as string, msg.kind as ReactionKind, msg.x as number, msg.y as number);
        break;
    }
  }

  hello(name: string, color: string) {
    const first = !this.me;
    this.me = { pid: this.pid, name, color };
    if (first) {
      this.events.init({ you: this.pid, meta: this.state.meta, items: this.state.list(), people: [...this.others.values()] }, []);
      this.events.status("online");
    }
    this.post({ t: "hello", person: this.me });
  }

  ops(ops: Op[], fx?: Effect) {
    // Re-read first: another tab may have saved since.
    const fresh = this.load();
    if (fresh) this.state = fresh;
    for (const op of ops) this.state.apply(op);
    this.save();
    this.post({ t: "ops", from: this.pid, ops, fx });
  }

  presence(p: Presence) {
    this.post({ t: "pres", pid: this.pid, p });
  }

  react(kind: ReactionKind, x: number, y: number) {
    this.post({ t: "react", pid: this.pid, kind, x, y });
  }

  close() {
    this.post({ t: "leave", pid: this.pid });
    this.channel?.close();
  }
}

/**
 * The demo's link: the board lives in this tab only. Nothing is saved,
 * nothing is sent, and nobody else can see it.
 */
export class DemoLink implements Link {
  constructor(
    private events: LinkEvents,
    private meta: Meta,
  ) {}

  hello() {
    this.events.init({ you: "demo-you", meta: this.meta, items: [], people: [] }, []);
    this.events.status("online");
  }

  ops() {}
  presence() {}
  react() {}
  close() {}
}
