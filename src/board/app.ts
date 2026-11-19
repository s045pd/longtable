// One open board: its state, its view, and everything you can do to it.
// Every change goes the same way: worked out as ops, applied here at once,
// remembered for undo, and sent to the room, which passes it on to everyone
// else. Their changes arrive as ops too and are applied the same way.
import { PALETTE, freeColor } from "../shared/colors";
import { DAY_NAMES, dateOf, noteDay } from "../shared/days";
import { bounds, setLabelMeasure, union, type Box } from "../shared/geometry";
import { randomId } from "../shared/ids";
import { BoardState } from "../shared/state";
import { FLIGHT, notesInWeek, planTidy, waveDelay } from "../shared/tidy";
import type { TemplateName } from "../shared/templates";
import type { Effect, Item, NoteItem, Op, Person, Presence, ReactionKind } from "../shared/types";
import { Camera, type Insets } from "./camera";
import { Chrome } from "./chrome";
import { measureLabel, resetFits } from "./fit";
import { Grid } from "./grid";
import { loadIdentity, rememberBoard, saveIdentity, deviceId, type Identity } from "./identity";
import { attachInput } from "./input";
import { DemoLink, LiveLink, LocalLink, type InitData, type Link, type LinkStatus } from "./net";
import { Demo } from "./demo";
import { nextMonday } from "../shared/days";
import { People } from "./people";
import { ItemView, setWeekOf, type Motion } from "./views";
import { Editor } from "./editor";
import { SampleTeam } from "./sample-team";

export type Tool = "select" | "note" | "pen" | "text" | "check" | "hand";

interface HistoryEntry {
  undo: Op[];
  redo: Op[];
}

export class Board {
  readonly id: string;
  root: HTMLElement;
  stage!: HTMLDivElement;
  world!: HTMLDivElement;
  itemsLayer!: HTMLDivElement;
  selLayer!: HTMLDivElement;
  overlay!: HTMLDivElement;
  marquee!: HTMLDivElement;
  state = new BoardState({ client: "", file: "", weekOf: "", template: "" });
  views = new Map<string, ItemView>();
  cam = new Camera();
  grid!: Grid;
  people!: People;
  chrome!: Chrome;
  editor!: Editor;
  sampleTeam!: SampleTeam;
  /** Set on the demo board (/demo), which plays the whole story by itself. */
  demo: Demo | null = null;
  link: Link;
  sel = new Set<string>();
  tool: Tool = "select";
  me: Identity & { pid: string };
  ready = false;
  status: LinkStatus = "connecting";
  following: string | null = null;
  /** Where your pointer is on the board (world units), for reactions and paste. */
  pointer: [number, number] | null = null;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private selDirty = true;
  private lastFrame = performance.now();
  private lastView = "";
  private firstInit = true;

  constructor(root: HTMLElement, id: string, opts: { live: boolean; template?: TemplateName; demo?: boolean }) {
    this.id = id;
    this.root = root;
    if (opts.demo) this.demo = new Demo(this);
    const saved = loadIdentity();
    this.me = { cid: saved?.cid ?? deviceId(), name: saved?.name ?? "", color: saved?.color ?? PALETTE[Math.floor(Math.random() * 5)], pid: "" };
    // The demo's five are Ana, Bo, Cy, Dee and Eli; you watch as yourself, in grey if you have no colour yet.
    if (opts.demo && !saved?.name) this.me = { ...this.me, name: "You", color: "#8E919C" };
    this.build();
    setLabelMeasure(measureLabel);
    const events = {
      init: (d: InitData, pending: Op[]) => this.onInit(d, pending),
      ops: (from: string, ops: Op[], fx?: Effect) => this.onRemoteOps(from, ops, fx),
      join: (p: Person) => this.onJoin(p),
      leave: (pid: string) => this.onLeave(pid),
      presence: (pid: string, p: Presence) => this.onPresence(pid, p),
      reaction: (pid: string, kind: ReactionKind, x: number, y: number) => {
        const who = this.people.all.get(pid);
        this.people.react(kind, x, y, who?.color ?? "#FFFFFF");
      },
      status: (s: LinkStatus) => {
        this.status = s;
        this.chrome.setStatus(s);
      },
    };
    this.link = opts.demo
      ? new DemoLink(events, { client: "Pell & Rye", file: "Opening week", weekOf: nextMonday(), template: "demo" })
      : opts.live
        ? new LiveLink(id, events)
        : new LocalLink(id, events, opts.template ?? "blank");
    // Say hello with whatever name we have; the join card renames us after.
    this.link.hello(this.me.name || "Guest", this.me.color, this.me.cid);
    document.fonts?.ready.then(() => {
      resetFits();
      for (const v of this.views.values()) v.paint();
      this.selDirty = true;
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ setup
  private build() {
    this.root.innerHTML = "";
    this.root.className = "board-app";
    this.root.dataset.tool = this.tool;
    this.stage = el("div", "stage");
    const canvas = el("canvas", "grid") as unknown as HTMLCanvasElement;
    this.world = el("div", "world");
    this.itemsLayer = el("div", "items");
    this.selLayer = el("div", "selections");
    this.world.append(this.itemsLayer, this.selLayer);
    this.marquee = el("div", "marquee");
    this.stage.append(canvas, this.world, this.marquee);
    this.overlay = el("div", "overlay");
    this.root.append(this.stage, this.overlay);
    this.grid = new Grid(canvas);
    this.people = new People(this.overlay);
    this.chrome = new Chrome(this);
    this.editor = new Editor(this);
    this.sampleTeam = new SampleTeam(this);
    const resize = () => {
      this.cam.resize(this.stage.clientWidth, this.stage.clientHeight);
      this.selDirty = true;
    };
    new ResizeObserver(resize).observe(this.stage);
    resize();
    attachInput(this);
  }

  /** Space the chrome covers, so fitting keeps things in the clear. */
  insets(): Insets {
    const phone = this.cam.w < 700;
    // On a phone the example's notice and the sample-teammates button sit under the top bar.
    const notice = this.state.meta.template ? 64 : 0;
    return phone ? { top: 60 + notice, right: 12, bottom: 132, left: 12 } : { top: 72, right: 24, bottom: 96, left: 96 };
  }

  // ----------------------------------------------------------------- events
  private onInit(d: InitData, pending: Op[]) {
    this.me.pid = d.you;
    this.state = new BoardState(d.meta, d.items);
    for (const op of pending) this.state.apply(op);
    setWeekOf(this.state.meta.weekOf);
    for (const v of this.views.values()) v.remove();
    this.views.clear();
    for (const it of this.state.items.values()) this.mount(it, false);
    for (const p of d.people) this.people.upsert(p, p.p);
    for (const id of [...this.sel]) if (!this.state.items.has(id)) this.sel.delete(id);
    this.selDirty = true;
    this.ready = true;
    this.chrome.onMeta();
    this.chrome.onPeople();
    this.chrome.onItems();
    if (this.demo) {
      if (this.firstInit) {
        this.firstInit = false;
        this.demo.autoplay();
      }
      return;
    }
    rememberBoard(this.id, [d.meta.client, d.meta.file].filter(Boolean).join(" · "));
    if (this.firstInit) {
      this.firstInit = false;
      this.fitAll(false);
      if (!loadIdentity()?.name) this.chrome.askName(this.suggestColor());
    }
  }

  private onRemoteOps(_from: string, ops: Op[], fx?: Effect) {
    const motion = (id: string): Motion => (fx?.kind === "tidy" && id in fx.delays ? { kind: "spring", delay: fx.delays[id] } : { kind: "glide" });
    for (const op of ops) {
      if (!this.state.apply(op)) continue;
      this.reflect(op, motion, true);
    }
    if (fx?.kind === "tidy") this.playTidy(fx, false);
    this.chrome.onItems();
  }

  private onJoin(p: Person) {
    const isNew = !this.people.all.has(p.pid);
    this.people.upsert(p);
    if (isNew && this.ready) this.chrome.toast(`${p.name} joined`, p.color);
    this.chrome.onPeople();
  }

  private onLeave(pid: string) {
    if (this.following === pid) this.follow(null);
    this.people.remove(pid);
    this.selDirty = true;
    this.chrome.onPeople();
  }

  private onPresence(pid: string, p: Presence) {
    this.people.presence(pid, p);
    if (p.sel !== undefined || p.edit !== undefined) this.selDirty = true;
    if (this.following === pid && p.view) this.cam.chase = { x: p.view[0], y: p.view[1], z: p.view[2] };
  }

  // ------------------------------------------------------------------ views
  private mount(it: Item, born: boolean) {
    const v = new ItemView(it, born);
    this.views.set(it.id, v);
    this.itemsLayer.append(v.el);
  }

  /** Bring the DOM in line with one applied op. */
  private reflect(op: Op, motion: (id: string) => Motion, remote: boolean) {
    if (op.op === "meta") {
      if (op.set.weekOf !== undefined) {
        // New dates: the notes' day tags and the week's headers show them.
        setWeekOf(this.state.meta.weekOf);
        for (const v of this.views.values()) if (v.item.type === "note" || v.item.type === "week") v.paint();
      }
      this.chrome.onMeta();
      return;
    }
    const id = op.op === "put" ? op.item.id : op.id;
    const it = this.state.items.get(id);
    const v = this.views.get(id);
    if (!it) {
      v?.remove();
      this.views.delete(id);
      if (this.sel.delete(id)) this.chrome.onSelection();
      if (this.editor.id === id) this.editor.cancel();
    } else if (!v) this.mount(it, remote || op.op === "put");
    else if (this.editor.id === id && remote) {
      // Someone moved what you are typing into: follow the move, keep your words.
      v.update({ ...it, ...this.editor.liveFields() } as Item, motion(id));
    } else v.update(it, motion(id));
    this.selDirty = true;
  }

  // ---------------------------------------------------------------- changes
  /**
   * Apply ops here and send them. With `history`, one undo step reverses
   * them all. Returns the ops that undo them.
   */
  commit(ops: Op[], opts: { history?: boolean; fx?: Effect; motion?: (id: string) => Motion; send?: boolean } = {}): Op[] {
    const inverse: Op[] = [];
    const applied: Op[] = [];
    for (const op of ops) {
      const back = this.state.inverse(op);
      if (!this.state.apply(op)) continue;
      inverse.unshift(...back);
      applied.push(op);
      this.reflect(op, opts.motion ?? (() => ({ kind: "now" })), false);
    }
    if (opts.send !== false) this.link.ops(applied, opts.fx);
    if (opts.history !== false && applied.length) this.remember(inverse, applied);
    this.chrome.onItems();
    return inverse;
  }

  /** Record a finished change for undo (used when it was applied bit by bit, like a drag). */
  remember(undo: Op[], redo: Op[]) {
    if (!undo.length && !redo.length) return;
    this.undoStack.push({ undo, redo });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.chrome.onHistory();
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return;
    this.editor.commit();
    this.commit(step.undo, { history: false, motion: () => ({ kind: "spring", delay: 0 }) });
    this.redoStack.push(step);
    this.chrome.onHistory();
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return;
    this.commit(step.redo, { history: false, motion: () => ({ kind: "spring", delay: 0 }) });
    this.undoStack.push(step);
    this.chrome.onHistory();
  }

  /** Forget every undo step (the demo starts over on a clean slate). */
  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.chrome.onHistory();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  // -------------------------------------------------------------- selection
  setSelection(ids: Iterable<string>) {
    const next = new Set([...ids].filter((id) => this.state.items.has(id)));
    if (next.size === this.sel.size && [...next].every((id) => this.sel.has(id))) return;
    this.sel = next;
    this.selDirty = true;
    this.link.presence({ sel: [...this.sel] });
    this.chrome.onSelection();
  }

  markSelectionsDirty() {
    this.selDirty = true;
  }

  selected(): Item[] {
    return [...this.sel].map((id) => this.state.items.get(id)!).filter(Boolean);
  }

  selectionBox(): Box | null {
    return union(this.selected().map(bounds));
  }

  private drawSelections() {
    if (!this.selDirty) return;
    this.selDirty = false;
    const boxes: string[] = [];
    const box = (it: Item, color: string, cls: string, tag = "") => {
      const b = bounds(it);
      const pad = 6 / this.cam.z;
      const w = b.x1 - b.x0 + pad * 2;
      const h = b.y1 - b.y0 + pad * 2;
      // Turn with the item about its centre.
      const ox = it.x - (b.x0 - pad);
      const oy = it.y - (b.y0 - pad);
      boxes.push(
        `<div class="${cls}" style="--c:${color};left:${b.x0 - pad}px;top:${b.y0 - pad}px;width:${w}px;height:${h}px;transform-origin:${ox}px ${oy}px;transform:rotate(${it.type === "stroke" || it.type === "week" ? 0 : it.rot}deg)">${tag}</div>`,
      );
    };
    for (const s of this.people.all.values()) {
      for (const id of s.p.sel ?? []) {
        const it = this.state.items.get(id);
        if (it && !this.sel.has(id)) box(it, s.color, "selbox theirs");
      }
      if (s.p.edit) {
        const it = this.state.items.get(s.p.edit);
        if (it) box(it, s.color, "selbox theirs typing", `<span class="typing-tag" style="background:${s.color}">${escapeHtml(s.name)} is typing…</span>`);
      }
    }
    for (const it of this.selected()) box(it, "#ECE9E2", "selbox mine");
    this.selLayer.innerHTML = boxes.join("");
    this.chrome.placeSelectionBar();
  }

  // ---------------------------------------------------------------- actions
  topZ() {
    return this.state.topZ() + 1;
  }

  newItemId() {
    return randomId(12);
  }

  /** Raise items to the top of the stack (picking something up brings it forward). */
  raise(ids: string[]): Op[] {
    let z = this.state.topZ();
    const ops: Op[] = [];
    const sorted = ids.map((id) => this.state.items.get(id)!).filter((it) => it && it.type !== "week").sort((a, b) => a.z - b.z);
    for (const it of sorted) if (it.z <= z || sorted.length > 1) ops.push({ op: "patch", id: it.id, set: { z: ++z } });
    return ops;
  }

  addNote(x: number, y: number, edit = true): string {
    const id = this.newItemId();
    const rot = Math.round((Math.random() * 6 - 3) * 10) / 10;
    this.commit([{ op: "put", item: { id, type: "note", x: Math.round(x), y: Math.round(y), rot, z: this.topZ(), by: this.me.name, color: this.me.color, text: "" } }], { history: !edit });
    this.setSelection([id]);
    if (edit) this.editor.open(id, { fresh: true });
    return id;
  }

  addLabel(x: number, y: number) {
    const id = this.newItemId();
    this.commit([{ op: "put", item: { id, type: "label", x: Math.round(x), y: Math.round(y), rot: 0, z: this.topZ(), by: this.me.name, color: this.me.color, text: "" } }], { history: false });
    this.setSelection([id]);
    this.editor.open(id, { fresh: true });
  }

  addChecklist(x: number, y: number) {
    const id = this.newItemId();
    this.commit([
      {
        op: "put",
        item: { id, type: "check", x: Math.round(x), y: Math.round(y), rot: 0, z: this.topZ(), by: this.me.name, color: this.me.color, title: "", rows: [{ text: "", done: false }] },
      },
    ], { history: false });
    this.setSelection([id]);
    this.editor.open(id, { fresh: true });
  }

  deleteSelected() {
    const ids = [...this.sel];
    if (!ids.length) return;
    this.editor.commit();
    this.commit(ids.map((id) => ({ op: "del", id }) as Op));
    this.setSelection([]);
  }

  /** Copies of the given items, offset, on top. Returns the copies' ids. */
  duplicate(ids: string[], dx = 32, dy = 32, select = true): string[] {
    let z = this.state.topZ();
    const copies: Item[] = [];
    for (const id of ids) {
      const it = this.state.items.get(id);
      if (!it || it.type === "week") continue;
      const copy = { ...structuredClone(it), id: this.newItemId(), x: it.x + dx, y: it.y + dy, z: ++z, by: this.me.name } as Item;
      if (copy.type === "note") delete copy.votes;
      copies.push(copy);
    }
    this.commit(copies.map((item) => ({ op: "put", item }) as Op));
    if (select) this.setSelection(copies.map((c) => c.id));
    return copies.map((c) => c.id);
  }

  recolor(color: string) {
    const ops: Op[] = [];
    for (const it of this.selected()) if ("color" in it && it.type !== "label") ops.push({ op: "patch", id: it.id, set: { color } });
    this.commit(ops);
  }

  /** Your vote on the selected notes: on for all if any lacks it, else off for all. */
  toggleVote() {
    const notes = this.selected().filter((it) => it.type === "note");
    if (!notes.length) return;
    const on = notes.some((n) => !(n.type === "note" && n.votes?.[this.me.cid]));
    this.commit(notes.map((n) => ({ op: "vote", id: n.id, who: this.me.cid, color: this.me.color, on }) as Op));
    this.chrome.onSelection();
  }

  toggleRow(id: string, row: number) {
    const it = this.state.items.get(id);
    if (!it || it.type !== "check" || !it.rows[row]) return;
    const rows = it.rows.map((r, i) => (i === row ? { ...r, done: !r.done } : r));
    this.commit([{ op: "patch", id, set: { rows } }]);
  }

  /**
   * Pick the day and/or time of the selected notes by hand. Notes already in
   * the week move to their new column, in the same undo step.
   */
  setWhen(set: { day?: number; time?: number }) {
    this.editor.commit();
    const notes = this.selected().filter((it): it is NoteItem => it.type === "note");
    if (!notes.length) return;
    const ops: Op[] = notes.map((n) => ({ op: "patch", id: n.id, set }) as Op);
    const week = this.state.list().find((it) => it.type === "week");
    const inWeek = week ? new Set(this.weekNotes(week.id)) : new Set<string>();
    const moving = notes.filter((n) => inWeek.has(n.id)).map((n) => n.id);
    const back = this.commit(ops, { history: false });
    const plan = moving.length ? planTidy(this.state.list(), moving, () => this.newItemId()) : null;
    const back2 = plan ? this.commit(plan.ops, { history: false, motion: () => ({ kind: "spring", delay: 0 }) }) : [];
    this.remember([...back2, ...back], [...ops, ...(plan?.ops ?? [])]);
    this.chrome.onSelection();
  }

  /** After a drop into the week: say which day a note now belongs to. */
  announceDays(ops: Op[]) {
    const picked = ops.filter((op): op is Extract<Op, { op: "patch" }> => op.op === "patch" && "day" in op.set);
    if (!picked.length) return;
    const n = this.state.items.get(picked[0].id);
    if (!n || n.type !== "note") return;
    const day = noteDay(n);
    const weekOf = this.state.meta.weekOf;
    const when = day === null ? "any day" : weekOf ? `${DAY_NAMES[day]} ${dateOf(weekOf, day).getDate()} ${dateOf(weekOf, day).toLocaleString("en-GB", { month: "short" })}` : DAY_NAMES[day];
    this.chrome.toast(picked.length === 1 ? `Now on ${when}` : `${picked.length} notes moved to new days`);
  }

  setMeta(set: { client?: string; file?: string; weekOf?: string }) {
    this.commit([{ op: "meta", set }]);
  }

  react(kind: ReactionKind) {
    const at = this.pointer ?? this.cam.toWorld(this.cam.w / 2, this.cam.h / 2);
    this.people.react(kind, at[0], at[1], this.me.color);
    this.link.react(kind, at[0], at[1]);
  }

  /** Tidy the selection, or the whole board when nothing is selected. */
  tidy() {
    this.editor.commit();
    // A selection without notes would tidy nothing: then tidy the board.
    const targets = this.selected().some((it) => it.type === "note") ? [...this.sel] : null;
    const plan = planTidy(this.state.list(), targets, () => this.newItemId());
    if (!plan) {
      this.chrome.toast("Nothing to tidy: add a note that names a day, like “Flyers out Wed”.");
      return;
    }
    this.commit(plan.ops, { fx: plan.fx, motion: (id) => ({ kind: "spring", delay: plan.fx.delays[id] ?? 0 }) });
    this.setSelection([]);
    this.playTidy(plan.fx, true);
    // Leave room under the week for the closing line.
    const insets = this.insets();
    insets.bottom += this.cam.w < 700 ? 90 : 150;
    this.cam.glideTo(this.cam.fitView(plan.box, insets, 1), 900);
  }

  /** The parts of a tidy everyone sees: headers typing in, day words underlined, the closing line. */
  private playTidy(fx: Effect, mine: boolean) {
    const week = this.views.get(fx.week);
    week?.typeHeaders((col) => waveDelay(col, 0) + FLIGHT * 0.46);
    for (const [id, delay] of Object.entries(fx.delays)) {
      const v = this.views.get(id);
      if (v?.item.type === "note") v.markDay(delay + FLIGHT * 0.6);
    }
    const last = Math.max(0, ...Object.values(fx.delays));
    this.chrome.sorted(this.state.meta.file, fx.count, (last + FLIGHT) * 1000, mine);
  }

  // ------------------------------------------------------------------ views
  fitAll(animate = true) {
    const box = union(this.state.list().map(bounds));
    const view = box ? this.cam.fitView(box, this.insets(), 1) : { x: 0, y: 0, z: 1 };
    // On a phone a whole board can be too small to read: stay close enough to see notes.
    if (box && this.cam.w < 700 && view.z < 0.22) {
      view.z = 0.22;
      view.x = box.x0 + (this.cam.w / 2 - 12) / view.z;
    }
    if (animate) this.cam.glideTo(view);
    else this.cam.set(view);
  }

  zoomBy(factor: number) {
    this.cam.zoomAt(this.cam.w / 2, this.cam.h / 2, factor);
  }

  follow(pid: string | null) {
    this.following = pid;
    const s = pid ? this.people.all.get(pid) : null;
    if (s?.p.view) this.cam.chase = { x: s.p.view[0], y: s.p.view[1], z: s.p.view[2] };
    else if (!pid) this.cam.chase = null;
    this.chrome.onFollow();
  }

  setTool(tool: Tool) {
    if (tool !== "select") this.editor.commit();
    this.tool = tool;
    this.root.dataset.tool = tool;
    this.chrome.onTool();
  }

  setIdentity(name: string, color: string) {
    this.me.name = name;
    this.me.color = color;
    saveIdentity({ cid: this.me.cid, name, color });
    this.link.hello(name, color, this.me.cid);
    this.chrome.onPeople();
  }

  suggestColor() {
    return freeColor([...this.people.all.values()].map((p) => p.color));
  }

  // ------------------------------------------------------------------ frame
  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.cam.tick(now, dt);
    const view = `${this.cam.x.toFixed(2)},${this.cam.y.toFixed(2)},${this.cam.z.toFixed(4)},${this.cam.w},${this.cam.h}`;
    if (view !== this.lastView) {
      this.lastView = view;
      const tx = this.cam.w / 2 - this.cam.x * this.cam.z;
      const ty = this.cam.h / 2 - this.cam.y * this.cam.z;
      this.world.style.transform = `translate(${tx}px, ${ty}px) scale(${this.cam.z})`;
      this.world.style.setProperty("--z", String(this.cam.z));
      this.root.style.setProperty("--zoom", String(this.cam.z));
      this.grid.draw(this.cam);
      this.chrome.onCamera();
      this.selDirty = true;
      this.sendView();
    }
    this.drawSelections();
    this.people.tick(this.cam, now, dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  private viewTimer = 0;
  private sendView() {
    if (this.viewTimer) return;
    this.viewTimer = window.setTimeout(() => {
      this.viewTimer = 0;
      this.link.presence({ view: [Math.round(this.cam.x), Math.round(this.cam.y), Math.round(this.cam.z * 1000) / 1000] });
    }, 120);
  }

  /** Items under a world rectangle. */
  itemsIn(box: Box): string[] {
    const out: string[] = [];
    for (const it of this.state.items.values()) {
      const b = bounds(it);
      if (b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0) out.push(it.id);
    }
    return out;
  }

  /** The notes sitting in a week's columns, so dragging the week brings them along. */
  weekNotes(weekId: string): string[] {
    const w = this.state.items.get(weekId);
    if (!w || w.type !== "week") return [];
    const notes = this.state.list().filter((it): it is NoteItem => it.type === "note");
    return notesInWeek(w, notes).map((n) => n.id);
  }
}

function el(tag: string, cls: string) {
  const e = document.createElement(tag);
  e.className = cls;
  return e as HTMLDivElement;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
