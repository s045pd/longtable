// Sample teammates: four made-up people who wander the example board so one
// person can see what planning together looks like. They live only in this
// tab: they move cursors, point at notes, start typing and drop reactions,
// but they never change the board, and nobody else sees them.
import { DEMO_PEOPLE } from "../shared/templates";
import { bounds } from "../shared/geometry";
import type { Item, ReactionKind } from "../shared/types";
import type { Board } from "./app";

type Style = "sprint" | "axis" | "jitter" | "slow" | "circle";

interface Bot {
  pid: string;
  name: string;
  color: string;
  style: Style;
  x: number;
  y: number;
  from: [number, number];
  to: [number, number];
  t0: number;
  dur: number;
  rest: number;
  target: string | null;
  typing: number;
}

const STYLES: Style[] = ["sprint", "axis", "jitter", "slow", "circle"];
const easeOutBack = (p: number) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;
const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

export class SampleTeam {
  private bots: Bot[] = [];
  private raf = 0;
  private stopAt = 0;
  active = false;

  constructor(private board: Board) {}

  start(minutes = 2) {
    if (this.active) return;
    this.active = true;
    const taken = this.board.me.name.toLowerCase();
    const people = Object.values(DEMO_PEOPLE).filter((p) => p.name.toLowerCase() !== taken).slice(0, 4);
    const center = this.board.cam.toWorld(this.board.cam.w / 2, this.board.cam.h / 2);
    this.bots = people.map((p, i) => ({
      pid: `sample-${p.name.toLowerCase()}`,
      name: p.name,
      color: p.color,
      style: STYLES[Object.values(DEMO_PEOPLE).indexOf(p)] ?? STYLES[i],
      x: center[0] + (i - 1.5) * 260,
      y: center[1] + 300,
      from: [center[0], center[1]],
      to: [center[0], center[1]],
      t0: performance.now() + i * 600,
      dur: 1,
      rest: 0,
      target: null,
      typing: 0,
    }));
    this.bots.forEach((b, i) => setTimeout(() => this.active && this.join(b), 300 + i * 700));
    this.stopAt = performance.now() + minutes * 60_000;
    const loop = (now: number) => {
      if (!this.active) return;
      if (now > this.stopAt) return this.stop();
      for (const b of this.bots) this.step(b, now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.board.chrome.onSampleTeam();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    for (const b of this.bots) this.board.people.remove(b.pid);
    this.bots = [];
    this.board.chrome.onPeople();
    this.board.chrome.onSampleTeam();
    this.board.markSelectionsDirty();
  }

  private join(b: Bot) {
    this.board.people.upsert({ pid: b.pid, name: b.name, color: b.color }, { c: [Math.round(b.x), Math.round(b.y)] });
    this.board.chrome.onPeople();
    this.board.chrome.toast(`${b.name} joined (sample teammate)`, b.color);
  }

  private pickTarget(): Item | null {
    const items = this.board.state.list().filter((it) => it.type === "note" || it.type === "photo" || it.type === "check");
    if (!items.length) return null;
    // Prefer things near what you are looking at, so the action stays on screen.
    const view = this.board.cam.visible();
    const near = items.filter((it) => it.x > view.x0 && it.x < view.x1 && it.y > view.y0 && it.y < view.y1);
    const pool = near.length >= 3 ? near : items;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private step(b: Bot, now: number) {
    if (now < b.t0) return;
    const p = Math.min(1, (now - b.t0) / b.dur);
    let x: number;
    let y: number;
    const [fx, fy] = b.from;
    const [tx, ty] = b.to;
    switch (b.style) {
      case "sprint": {
        const e = easeOutBack(p);
        x = fx + (tx - fx) * e;
        y = fy + (ty - fy) * e;
        break;
      }
      case "axis": {
        const a = easeInOut(Math.min(1, p * 2));
        const c = easeInOut(Math.max(0, p * 2 - 1));
        x = fx + (tx - fx) * a;
        y = fy + (ty - fy) * c;
        break;
      }
      case "jitter": {
        const e = easeInOut(p);
        x = fx + (tx - fx) * e + Math.sin(now / 37) * 6 * (1 - p * 0.7);
        y = fy + (ty - fy) * e + Math.cos(now / 29) * 6 * (1 - p * 0.7);
        break;
      }
      case "slow": {
        const e = easeInOut(p);
        x = fx + (tx - fx) * e;
        y = fy + (ty - fy) * e;
        break;
      }
      case "circle": {
        const e = easeInOut(p);
        const r = 60 * Math.sin(Math.PI * p);
        x = fx + (tx - fx) * e + Math.cos(now / 260) * r;
        y = fy + (ty - fy) * e + Math.sin(now / 260) * r;
        break;
      }
    }
    b.x = x;
    b.y = y;
    const pres: { c: [number, number]; view: [number, number, number]; sel?: string[]; edit?: string | null } = {
      c: [Math.round(x), Math.round(y)],
      view: [Math.round(x), Math.round(y), 0.7],
    };
    if (p >= 1) {
      // Arrived: hang about, perhaps point at it, type into it or react.
      if (!b.rest) {
        b.rest = now + 900 + Math.random() * 2200;
        if (b.target) {
          const roll = Math.random();
          if (roll < 0.45) pres.sel = [b.target];
          else if (roll < 0.6 && b.style !== "circle") {
            pres.edit = b.target;
            b.typing = now + 2200;
          }
          if (b.style === "circle" || Math.random() < 0.15) {
            const kinds: ReactionKind[] = ["heart", "star", "bang", "clap"];
            this.board.people.react(kinds[Math.floor(Math.random() * kinds.length)], x, y - 20, b.color);
          }
        }
        this.board.markSelectionsDirty();
      }
      if (b.typing && now > b.typing) {
        b.typing = 0;
        pres.edit = null;
        this.board.markSelectionsDirty();
      }
      if (now > b.rest) {
        const next = this.pickTarget();
        if (next) {
          const box = bounds(next);
          b.from = [x, y];
          b.to = [box.x0 + (box.x1 - box.x0) * (0.3 + Math.random() * 0.5), box.y0 + (box.y1 - box.y0) * (0.3 + Math.random() * 0.5)];
          b.target = next.id;
          const d = Math.hypot(b.to[0] - x, b.to[1] - y);
          const speed = b.style === "sprint" ? 2.6 : b.style === "slow" ? 0.6 : b.style === "jitter" ? 1.8 : 1.2;
          b.dur = Math.max(450, (d / speed) * 1.1);
          b.t0 = now;
          b.rest = 0;
          if (b.typing) {
            b.typing = 0;
            pres.edit = null;
          }
          pres.sel = [];
          this.board.markSelectionsDirty();
        }
      }
    }
    this.board.people.presence(b.pid, pres);
    if (this.board.following === b.pid) this.board.cam.chase = { x: pres.view[0], y: pres.view[1], z: Math.min(this.board.cam.z, 0.7) };
  }
}
