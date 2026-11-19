// The demo: the story the Longtable film tells, played for real on a board
// that lives in this tab only. Ana writes the first note; Bo, Cy, Dee and Eli
// join; all five write, draw, drop photos, tick and vote at once while the
// camera chases the busiest corner; Ana and Bo grab the same note and pull
// until Ana peels off a copy instead; then Ana selects everything and presses
// Tidy up, and the mess turns out to have been a week all along.
//
// Every step goes through the board's own machinery (the same ops, views,
// cursors, selections and tidy that people use), so what you watch is the
// product, not a film of it. Nothing is saved and nobody else sees it.
import { CHECK, bounds, checkHeight, union, type Box } from "../shared/geometry";
import { DEMO_PEOPLE, makeTemplate } from "../shared/templates";
import type { CheckItem, Item, NoteItem, Op, ReactionKind, StrokeItem } from "../shared/types";
import { planTidy } from "../shared/tidy";
import type { Board } from "./app";

type Who = keyof typeof DEMO_PEOPLE;
type Style = "sprint" | "axis" | "jitter" | "slow" | "circle";

/** How each of the five moves, how fast (world units per ms) and how fast they type (ms per letter). */
const CAST: Record<Who, { style: Style; speed: number; key: number }> = {
  ana: { style: "sprint", speed: 2.9, key: 30 },
  bo: { style: "axis", speed: 1.9, key: 40 },
  cy: { style: "jitter", speed: 2.3, key: 34 },
  dee: { style: "slow", speed: 1.1, key: 48 },
  eli: { style: "circle", speed: 1.6, key: 38 },
};

/** What each person makes, in order. Ana's first note comes before everyone else arrives. */
const WORK: Record<Who, string[]> = {
  ana: ["s-people", "n-rota", "n-aprons", "n-staff", "n-print", "n-window"],
  bo: ["s-bake", "n-oven", "n-flour", "c-bake", "n-sour", "p-crois", "n-hire"],
  cy: ["n-test", "n-crois", "p-loaf", "k-arrow", "n-chalk", "n-count"],
  dee: ["n-double", "n-train", "n-thanks", "n-band", "p-shop"],
  eli: ["s-street", "n-bun", "n-flyers", "n-balloons", "n-kids", "n-panel"],
};

const CLUSTERS = {
  bake: ["s-bake", "n-oven", "n-flour", "n-test", "n-sour", "n-crois", "n-double", "c-bake", "p-loaf", "p-crois"],
  people: ["s-people", "n-rota", "n-train", "n-aprons", "n-panel", "n-staff", "n-hire", "n-thanks", "n-count"],
  street: ["s-street", "n-starts", "n-bun", "n-print", "n-chalk", "n-flyers", "n-window", "n-balloons", "n-band", "n-kids", "p-shop", "k-arrow"],
};

class Stopped extends Error {}

interface Actor {
  who: Who;
  pid: string;
  cid: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

const easeOutBack = (p: number) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;
const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const easeOut = (p: number) => 1 - (1 - p) ** 3;

export class Demo {
  playing = false;
  /** Whether it has started at least once (the button then says Replay). */
  played = false;
  /** Whether you have changed the board yourself since the demo handed it over. */
  edited = false;
  private run = 0;
  private actors = new Map<Who, Actor>();
  private seed = new Map<string, Item>();
  private marquee: HTMLDivElement | null = null;

  constructor(private board: Board) {}

  /** On arrival: play, unless the system asks for reduced motion; then show how it ends. */
  autoplay() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) this.showEnd();
    else this.start();
  }

  /** The ending at once, without the story: the example board, tidied into its week. */
  showEnd() {
    this.run++;
    this.reset();
    const b = this.board;
    const items = [...this.seed.values()];
    const sat = this.seed.get("n-double") as NoteItem;
    items.push({ ...sat, id: "n-double-sun", by: "Ana", text: sat.text.replace(/Sat$/, "Sun"), x: sat.x + 100, y: sat.y - 230, rot: 0 });
    b.commit(items.map((item) => ({ op: "put", item }) as Op), { history: false });
    const plan = planTidy(b.state.list(), null, () => b.newItemId(), b.state.meta.weekOf);
    if (plan) {
      b.commit(plan.ops, { history: false });
      b.cam.set(b.cam.fitView(plan.box, b.insets(), 1));
    }
    this.playing = false;
    this.edited = false;
    this.board.chrome.onDemo();
  }

  /** You changed something on the handed-over board: say it is only yours, and offer to make it real. */
  touch() {
    if (this.playing || this.edited) return;
    this.edited = true;
    this.board.chrome.onDemo();
  }

  start() {
    const run = ++this.run;
    this.reset();
    this.playing = true;
    this.played = true;
    this.board.chrome.onDemo();
    this.story(run).then(
      () => run === this.run && this.finish(false),
      (e) => {
        if (e instanceof Stopped) return;
        console.error(e);
        if (run === this.run) this.finish(true);
      },
    );
  }

  /** Stop where it is: the board stays as it is, now yours to try. */
  stop() {
    if (!this.playing) return;
    this.run++;
    this.finish(true);
  }

  private finish(early: boolean) {
    this.playing = false;
    this.cleanUp();
    if (early) for (const a of this.actors.values()) this.board.people.remove(a.pid);
    if (early) this.actors.clear();
    this.board.markSelectionsDirty();
    this.board.chrome.onPeople();
    this.board.chrome.onDemo();
  }

  private cleanUp() {
    this.marquee?.remove();
    this.marquee = null;
    this.board.root.querySelector(".tidy-pill")?.classList.remove("pressed");
    for (const v of this.board.views.values()) v.el.classList.remove("tugged", "snap", "lifted");
    for (const a of this.actors.values()) this.board.people.presence(a.pid, { sel: [], edit: null, pen: false });
  }

  private reset() {
    const b = this.board;
    this.cleanUp();
    for (const a of this.actors.values()) b.people.remove(a.pid);
    this.actors.clear();
    b.setSelection([]);
    const dels = b.state.list().map((it) => ({ op: "del", id: it.id }) as Op);
    if (dels.length) b.commit(dels, { history: false });
    b.clearHistory();
    b.chrome.clearSorted();
    this.edited = false;
    b.chrome.onPeople();
    this.seed = new Map(makeTemplate("pell-and-rye").items.map((it) => [it.id, it]));
  }

  // ------------------------------------------------------------- timing
  private check(run: number) {
    if (run !== this.run) throw new Stopped();
  }

  private wait(run: number, ms: number): Promise<void> {
    return new Promise((resolve, reject) =>
      setTimeout(() => (run === this.run ? resolve() : reject(new Stopped())), ms),
    );
  }

  /** Call `step` every frame for `ms` with progress 0 … 1 (1 exactly at the end). */
  private frames(run: number, ms: number, step: (p: number, now: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const tick = (now: number) => {
        if (run !== this.run) return reject(new Stopped());
        const p = Math.min(1, (now - t0) / ms);
        step(p, now);
        if (p >= 1) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // ------------------------------------------------------------- people
  private join(who: Who, x: number, y: number): Actor {
    const p = DEMO_PEOPLE[who];
    const a: Actor = { who, pid: `demo-${who}`, cid: `demo-${who}`, name: p.name, color: p.color, x, y };
    this.actors.set(who, a);
    this.board.people.upsert({ pid: a.pid, name: a.name, color: a.color }, { c: [Math.round(x), Math.round(y)] });
    this.board.chrome.onPeople();
    this.board.chrome.toast(`${a.name} joined`, a.color);
    return a;
  }

  private at(a: Actor, x: number, y: number) {
    a.x = x;
    a.y = y;
    this.board.people.presence(a.pid, { c: [Math.round(x), Math.round(y)] });
  }

  private show(a: Actor, p: { sel?: string[]; edit?: string | null; pen?: boolean }) {
    this.board.people.presence(a.pid, p);
    this.board.markSelectionsDirty();
  }

  /** Move a cursor in that person's own way. `carry` items ride along, as in a drag. */
  private move(run: number, a: Actor, tx: number, ty: number, opts: { carry?: string[]; ms?: number; style?: Style } = {}) {
    const style = opts.style ?? CAST[a.who].style;
    const fx = a.x;
    const fy = a.y;
    const d = Math.hypot(tx - fx, ty - fy);
    const ms = opts.ms ?? Math.max(260, Math.min(1500, d / CAST[a.who].speed));
    const carried = (opts.carry ?? []).map((id) => {
      const it = this.board.state.items.get(id)!;
      return { id, dx: it.x - fx, dy: it.y - fy };
    });
    return this.frames(run, ms, (p, now) => {
      let x: number;
      let y: number;
      switch (style) {
        case "sprint": {
          const e = easeOutBack(p);
          x = fx + (tx - fx) * e;
          y = fy + (ty - fy) * e;
          break;
        }
        case "axis": {
          x = fx + (tx - fx) * easeInOut(Math.min(1, p * 2));
          y = fy + (ty - fy) * easeInOut(Math.max(0, p * 2 - 1));
          break;
        }
        case "jitter": {
          const e = easeInOut(p);
          const k = 7 * (1 - p);
          x = fx + (tx - fx) * e + Math.sin(now / 31) * k;
          y = fy + (ty - fy) * e + Math.cos(now / 23) * k;
          break;
        }
        case "slow": {
          // A heavy arc: it sags, then settles.
          const e = easeInOut(p);
          x = fx + (tx - fx) * e;
          y = fy + (ty - fy) * e + Math.sin(Math.PI * p) * Math.min(90, d * 0.12);
          break;
        }
        case "circle": {
          const e = easeInOut(p);
          const r = Math.min(70, d * 0.18) * Math.sin(Math.PI * p);
          x = fx + (tx - fx) * e + Math.cos(now / 220) * r;
          y = fy + (ty - fy) * e + Math.sin(now / 220) * r;
          break;
        }
      }
      if (p >= 1) {
        x = tx;
        y = ty;
      }
      this.at(a, x, y);
      if (carried.length) {
        this.board.commit(
          carried.map((c) => ({ op: "patch", id: c.id, set: { x: Math.round(x + c.dx), y: Math.round(y + c.dy) } }) as Op),
          { history: false },
        );
      }
    });
  }

  private async doubleClick(run: number, a: Actor) {
    this.board.people.click(a.pid);
    await this.wait(run, 110);
    this.board.people.click(a.pid);
    await this.wait(run, 60);
  }

  private put(item: Item) {
    this.board.commit([{ op: "put", item: { ...item, z: this.board.topZ() } as Item }], { history: false });
  }

  private patch(id: string, set: Partial<Item>) {
    this.board.commit([{ op: "patch", id, set }], { history: false });
  }

  /** Type into a field letter by letter, with the small unevenness of real typing. */
  private async type(run: number, a: Actor, id: string, field: "text" | "caption" | "title", words: string, from = "") {
    this.show(a, { sel: [id], edit: id });
    let text = from;
    for (const ch of words) {
      text += ch;
      this.patch(id, { [field]: text } as Partial<Item>);
      await this.wait(run, CAST[a.who].key * (ch === "\n" ? 3 : 0.6 + Math.random() * 0.8));
    }
    this.show(a, { edit: null });
  }

  /** Make one of the example board's things the way a person would. */
  private async make(run: number, a: Actor, id: string) {
    const seed = this.seed.get(id)!;
    const b = bounds(seed);
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    switch (seed.type) {
      case "note":
      case "label": {
        await this.move(run, a, seed.x - 30, seed.y - 20);
        await this.doubleClick(run, a);
        this.put({ ...seed, text: "", ...(seed.type === "note" ? { votes: undefined } : {}) } as Item);
        // The cursor slides off the words while they are typed.
        await Promise.all([
          this.type(run, a, id, "text", seed.text),
          this.move(run, a, seed.type === "note" ? seed.x + 70 : b.x1 + 20, seed.type === "note" ? seed.y + 78 : seed.y + 10, { ms: 380, style: "slow" }),
        ]);
        break;
      }
      case "photo": {
        if (id === "p-shop") {
          // Dee drops the shopfront off to one side, then hauls it into place.
          this.put({ ...seed, x: seed.x + 230, y: seed.y - 150, caption: "" });
          await this.move(run, a, seed.x + 230, seed.y - 150);
          this.board.people.click(a.pid);
          this.show(a, { sel: [id] });
          this.board.views.get(id)?.el.classList.add("lifted");
          await this.move(run, a, seed.x, seed.y, { carry: [id], ms: 1300 });
          this.board.views.get(id)?.el.classList.remove("lifted");
          await this.type(run, a, id, "caption", seed.caption);
          break;
        }
        await this.move(run, a, cx, cy);
        this.board.people.click(a.pid);
        this.put({ ...seed, caption: "" });
        await this.wait(run, 200);
        await this.move(run, a, cx - 30, b.y1 - 28, { ms: 280 });
        await this.type(run, a, id, "caption", seed.caption);
        break;
      }
      case "check": {
        const list = seed as CheckItem;
        await this.move(run, a, list.x - 40, b.y0 + 40);
        await this.doubleClick(run, a);
        this.put({ ...list, title: "", rows: [] });
        await this.type(run, a, id, "title", list.title);
        const rows: CheckItem["rows"] = [];
        for (const row of list.rows) {
          rows.push({ text: "", done: false });
          let text = "";
          this.show(a, { edit: id });
          for (const ch of row.text) {
            text += ch;
            rows[rows.length - 1] = { text, done: false };
            this.patch(id, { rows: rows.map((r) => ({ ...r })) });
            await this.wait(run, CAST[a.who].key);
          }
        }
        this.show(a, { edit: null });
        // Tick off what is already done.
        const h = checkHeight(list.rows.length);
        for (let i = 0; i < list.rows.length; i++) {
          if (!list.rows[i].done) continue;
          await this.move(run, a, list.x - CHECK.w / 2 + 32, list.y - h / 2 + 66 + i * CHECK.row + 22, { ms: 300 });
          this.board.people.click(a.pid);
          rows[i] = { ...rows[i], done: true };
          this.patch(id, { rows: rows.map((r) => ({ ...r })) });
          await this.wait(run, 160);
        }
        break;
      }
      case "stroke": {
        const pen = seed as StrokeItem;
        const pts = pen.pts;
        await this.move(run, a, pen.x + pts[0], pen.y + pts[1]);
        this.show(a, { pen: true });
        this.put({ ...pen, pts: pts.slice(0, 2) });
        const n = pts.length / 2;
        await this.frames(run, 1000, (p) => {
          const k = Math.max(1, Math.round(p * n));
          this.patch(id, { pts: pts.slice(0, k * 2) });
          this.at(a, pen.x + pts[k * 2 - 2], pen.y + pts[k * 2 - 1]);
        });
        this.show(a, { pen: false });
        break;
      }
      default:
        break;
    }
    this.show(a, { sel: [] });
  }

  private async work(run: number, a: Actor, ids: string[], gap: number) {
    for (const id of ids) {
      await this.make(run, a, id);
      await this.wait(run, gap * (0.7 + Math.random() * 0.6));
    }
  }

  // ------------------------------------------------------------- camera
  private box(ids: string[]): Box {
    return union(ids.map((id) => bounds(this.board.state.items.get(id) ?? this.seed.get(id)!)))!;
  }

  private look(box: Box, ms = 900, maxZoom = 0.9) {
    const cam = this.board.cam;
    cam.glideTo(cam.fitView(box, this.board.insets(), maxZoom, 40), ms);
  }

  // ------------------------------------------------------------- the story
  private async story(run: number) {
    const b = this.board;
    const cam = b.cam;
    const all = union([...this.seed.values()].map(bounds))!;
    const phone = cam.w < 700;

    // 1. First note. Close on the spot where Ana will write.
    const first = this.seed.get("n-starts") as NoteItem;
    cam.set({ x: first.x + 40, y: first.y - 20, z: phone ? 0.85 : 1 });
    await this.wait(run, 700);
    const view = cam.visible();
    const ana = this.join("ana", view.x0 - 60, first.y + 160);
    await this.wait(run, 300);
    await this.move(run, ana, first.x - 30, first.y - 20);
    await this.doubleClick(run, ana);
    this.put({ ...first, text: "" });
    await Promise.all([
      this.type(run, ana, first.id, "text", first.text),
      this.move(run, ana, first.x + 70, first.y + 78, { ms: 420, style: "slow" }),
    ]);
    this.show(ana, { sel: [] });
    await this.wait(run, 350);

    // 2. Everyone joins, from every side, and the camera pulls back to see them.
    this.look(all, 1100, 0.6);
    await this.wait(run, 250);
    const w = cam.visible();
    const bo = this.join("bo", w.x0 - 40, (w.y0 + w.y1) / 2 - 200);
    await this.wait(run, 180);
    const cy = this.join("cy", (w.x0 + w.x1) / 2 - 300, w.y1 + 40);
    await this.wait(run, 160);
    const dee = this.join("dee", w.x1 + 40, (w.y0 + w.y1) / 2 + 100);
    await this.wait(run, 140);
    const eli = this.join("eli", (w.x0 + w.x1) / 2 + 200, w.y0 - 40);
    await this.wait(run, 300);

    // 3. The chase: all five at work at once; the camera goes where it is busiest.
    const crew: [Actor, Who][] = [
      [ana, "ana"],
      [bo, "bo"],
      [cy, "cy"],
      [dee, "dee"],
      [eli, "eli"],
    ];
    let busy = true;
    const working = Promise.all(crew.map(([a, who], i) => this.wait(run, i * 90).then(() => this.work(run, a, WORK[who], who === "dee" ? 260 : 160)))).finally(() => (busy = false));
    const camera = (async () => {
      const shots: (keyof typeof CLUSTERS | "all")[] = ["bake", "people", "street", "bake", "people", "street"];
      await this.wait(run, 1300);
      for (const shot of shots) {
        if (!busy) return;
        this.look(shot === "all" ? all : this.box(CLUSTERS[shot]), 800, phone ? 0.5 : 0.78);
        await this.wait(run, 2500);
      }
    })();
    await working;
    await camera.catch((e) => {
      if (e instanceof Stopped) throw e;
    });
    this.check(run);

    // Votes and cheers on the brass band.
    const band = "n-band";
    this.look(this.box(CLUSTERS.street), 800, phone ? 0.5 : 0.8);
    const bandBox = bounds(b.state.items.get(band)!);
    const voters: [Actor, ReactionKind | null, number][] = [
      [eli, "heart", 0],
      [ana, null, 260],
      [cy, "star", 520],
    ];
    await Promise.all(
      voters.map(async ([a, cheer, delay], i) => {
        await this.wait(run, delay);
        await this.move(run, a, bandBox.x0 + 50 + i * 50, bandBox.y0 + 120 + (i % 2) * 20);
        this.board.people.click(a.pid);
        b.commit([{ op: "vote", id: band, who: a.cid, color: a.color, on: true }], { history: false });
        if (cheer) this.board.people.react(cheer, a.x, a.y - 30, a.color);
      }),
    );
    await this.wait(run, 700);

    // 4. Tug of war: Ana and Bo take the same note and pull.
    const tugged = "n-double";
    const note = b.state.items.get(tugged)!;
    this.look({ x0: note.x - 520, y0: note.y - 420, x1: note.x + 420, y1: note.y + 260 }, 900, phone ? 0.6 : 1);
    await Promise.all([this.move(run, ana, note.x - 40, note.y + 10), this.move(run, bo, note.x + 50, note.y - 10)]);
    this.board.people.click(ana.pid);
    this.board.people.click(bo.pid);
    this.show(ana, { sel: [tugged] });
    this.show(bo, { sel: [tugged] });
    const view0 = b.views.get(tugged)!;
    view0.el.classList.add("tugged");
    await this.frames(run, 900, (p, now) => {
      const pull = easeOut(p) * 70;
      view0.el.style.setProperty("--tug", (1 + easeOut(p) * 0.32 + Math.sin(now / 45) * 0.02).toFixed(3));
      view0.el.style.setProperty("--tug-skew", `${(Math.sin(now / 70) * 3).toFixed(2)}deg`);
      this.at(ana, note.x - 40 - pull, note.y + 10 + Math.sin(now / 50) * 3);
      this.at(bo, note.x + 50 + pull, note.y - 10 + Math.cos(now / 55) * 3);
    });
    // Snap.
    view0.el.classList.remove("tugged");
    view0.el.style.removeProperty("--tug");
    view0.el.style.removeProperty("--tug-skew");
    view0.el.classList.add("snap");
    this.show(bo, { sel: [] });
    await Promise.all([this.move(run, ana, note.x - 150, note.y + 40, { ms: 220, style: "sprint" }), this.move(run, bo, note.x + 170, note.y - 30, { ms: 220, style: "sprint" })]);
    view0.el.classList.remove("snap");
    await this.wait(run, 250);
    // Ana takes a copy instead (Option-drag), and Bo squares the original up.
    await this.move(run, ana, note.x - 20, note.y + 20, { ms: 300 });
    const copy = { ...(note as NoteItem), id: "n-double-sun", by: "Ana", rot: 0, votes: undefined };
    this.put(copy);
    this.show(ana, { sel: [copy.id] });
    b.views.get(copy.id)?.el.classList.add("lifted");
    const squaring = (async () => {
      await this.move(run, bo, note.x + 90, note.y + 60);
      this.board.people.click(bo.pid);
      this.patch(tugged, { rot: 0 });
      this.show(bo, { sel: [tugged] });
    })();
    await this.move(run, ana, note.x + 120 - 20, note.y - 250 + 20, { carry: [copy.id] });
    b.views.get(copy.id)?.el.classList.remove("lifted");
    await squaring;
    this.show(bo, { sel: [] });
    // Saturday becomes Sunday.
    this.show(ana, { edit: copy.id });
    let text = copy.text;
    for (let i = 0; i < 3; i++) {
      text = text.slice(0, -1);
      this.patch(copy.id, { text });
      await this.wait(run, 90);
    }
    await this.type(run, ana, copy.id, "text", "Sun", text);
    this.show(ana, { sel: [] });
    await this.wait(run, 500);

    // 5. Tidy up: Ana selects everything and presses the button.
    const everything = union(b.state.list().map(bounds))!;
    this.look(everything, 900, 0.6);
    await this.wait(run, 950);
    for (const [a] of crew) if (a !== ana) this.move(run, a, a.x + (Math.random() - 0.5) * 200, a.y + (Math.random() - 0.5) * 160).catch(() => {});
    const start: [number, number] = [everything.x0 - 70, everything.y0 - 70];
    await this.move(run, ana, start[0], start[1]);
    this.board.people.click(ana.pid);
    const rect = document.createElement("div");
    rect.className = "demo-marquee";
    rect.style.setProperty("--c", ana.color);
    b.world.append(rect);
    this.marquee = rect;
    const end: [number, number] = [everything.x1 + 70, everything.y1 + 70];
    // The box grows behind her cursor and takes in what it covers.
    await this.frames(run, 1200, (p) => {
      const e = easeInOut(p);
      const x = start[0] + (end[0] - start[0]) * e;
      const y = start[1] + (end[1] - start[1]) * e;
      this.at(ana, x, y);
      const box = { x0: start[0], y0: start[1], x1: x, y1: y };
      rect.style.cssText = `--c:${ana.color};left:${box.x0}px;top:${box.y0}px;width:${box.x1 - box.x0}px;height:${box.y1 - box.y0}px`;
      const inside = b.state.list().filter((it) => {
        const ib = bounds(it);
        return ib.x0 >= box.x0 && ib.y0 >= box.y0 && ib.x1 <= box.x1 && ib.y1 <= box.y1;
      });
      this.show(ana, { sel: inside.map((it) => it.id) });
    });
    await this.wait(run, 120);
    rect.remove();
    this.marquee = null;
    await this.wait(run, 250);
    const pill = b.root.querySelector<HTMLElement>(".tidy-pill")!;
    const r = pill.getBoundingClientRect();
    const stage = b.stage.getBoundingClientRect();
    const [px, py] = cam.toWorld(r.left + r.width * 0.3 - stage.left, r.top + r.height * 0.5 - stage.top);
    await this.move(run, ana, px, py);
    this.board.people.click(ana.pid);
    pill.classList.add("pressed");
    await this.wait(run, 170);
    pill.classList.remove("pressed");
    this.show(ana, { sel: [] });
    b.tidy();

    // 6. Sorted. Everyone drifts up over the week to look, then the others
    // go; Ana stays by her board.
    await this.wait(run, 600);
    const week = b.state.list().find((it) => it.type === "week");
    const wk = week ? this.box([week.id]) : everything;
    crew.forEach(([a], i) => this.move(run, a, wk.x0 + 140 + i * 300, wk.y0 - 170 - (i % 2) * 50).catch(() => {}));
    await this.wait(run, 3400);
    for (const [a] of crew) {
      if (a === ana) continue;
      this.board.people.remove(a.pid);
      this.actors.delete(a.who);
      this.board.chrome.onPeople();
      await this.wait(run, 220);
    }
    const weekNotes = union(b.state.list().filter((it) => it.type === "note").map(bounds))!;
    await this.move(run, ana, weekNotes.x1 + 70, weekNotes.y0 + 60);
  }
}
