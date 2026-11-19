// Everyone else on the board: their cursor, the name flag that trails it, the
// streak a quick move leaves, and the reactions they drop. Positions arrive
// a few times a second and are eased between, so a cursor glides instead of
// stepping; the flag eases slower still, so it lags like a flag should.
import type { Person, Presence, ReactionKind } from "../shared/types";
import type { Camera } from "./camera";

const POINTER = "M0 0L0 25.5L6.2 19.8L11.2 30.6L15.9 28.4L10.9 17.9L19.4 17.9Z";
const PEN = "M0 0L-5.5 -10L-5.5 -34L5.5 -34L5.5 -10Z";

const REACTION_SVG: Record<ReactionKind, string> = {
  heart: '<path d="M0 12C-20-2-11-15 0-5C11-15 20-2 0 12Z"/>',
  star: `<path d="${Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 6 : 14;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${i ? "L" : "M"}${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  }).join("")}Z"/>`,
  bang: '<rect x="-8.6" y="-13" width="5.2" height="16" rx="2.6"/><circle cx="-6" cy="9.5" r="3"/><rect x="3.4" y="-13" width="5.2" height="16" rx="2.6"/><circle cx="6" cy="9.5" r="3"/>',
  clap: '<path d="M-9 10c-6-6-6-14-2-20l3 2c-2 4-2 8 0 11l7-12 3 2-6 11 9-9 2 3-9 9 9-6 2 3-12 8c-3 2-4 1-6-2z"/>',
};

export const reactionIcon = (kind: ReactionKind, color = "currentColor") =>
  `<svg viewBox="-16 -16 32 32" width="22" height="22" fill="${color}" aria-hidden="true">${REACTION_SVG[kind]}</svg>`;

export interface Someone extends Person {
  p: Presence;
  /** Shown position (screen px), eased toward the target. */
  sx: number;
  sy: number;
  fx: number;
  fy: number;
  seen: boolean;
  trail: [number, number][];
  lastMove: number;
  el: HTMLDivElement;
  cursor: SVGPathElement;
  flag: HTMLDivElement;
  ribbon: SVGPathElement;
}

export class People {
  all = new Map<string, Someone>();
  private layer: HTMLDivElement;
  private reactions: { x: number; y: number; t0: number; el: HTMLDivElement }[] = [];

  constructor(parent: HTMLElement) {
    this.layer = document.createElement("div");
    this.layer.className = "people";
    parent.append(this.layer);
  }

  upsert(person: Person, p?: Presence): Someone {
    let s = this.all.get(person.pid);
    if (!s) {
      const el = document.createElement("div");
      el.className = "someone";
      el.innerHTML = `<svg class="ribbon-layer" width="1" height="1"><path class="ribbon"/></svg><svg class="cursor" width="44" height="80" viewBox="-10 -40 44 80"><path/></svg><div class="flag"></div>`;
      this.layer.append(el);
      s = {
        ...person,
        p: {},
        sx: 0,
        sy: 0,
        fx: 0,
        fy: 0,
        seen: false,
        trail: [],
        lastMove: 0,
        el,
        cursor: el.querySelector(".cursor path") as SVGPathElement,
        flag: el.querySelector(".flag") as HTMLDivElement,
        ribbon: el.querySelector(".ribbon") as SVGPathElement,
      };
      this.all.set(person.pid, s);
    }
    s.name = person.name;
    s.color = person.color;
    s.flag.textContent = person.name;
    s.el.style.setProperty("--c", person.color);
    if (p) this.presence(person.pid, p);
    return s;
  }

  presence(pid: string, p: Presence) {
    const s = this.all.get(pid);
    if (!s) return;
    s.p = { ...s.p, ...p };
    if (p.c !== undefined) s.lastMove = performance.now();
  }

  /** A click: a ring that opens out from someone's cursor (the demo's double-clicks and presses). */
  click(pid: string) {
    const s = this.all.get(pid);
    if (!s || !s.seen) return;
    const ring = document.createElement("div");
    ring.className = "click-ring";
    ring.style.setProperty("--c", s.color);
    ring.style.left = `${s.sx}px`;
    ring.style.top = `${s.sy}px`;
    this.layer.append(ring);
    setTimeout(() => ring.remove(), 600);
  }

  remove(pid: string) {
    const s = this.all.get(pid);
    if (!s) return;
    s.el.classList.add("leaving");
    setTimeout(() => s.el.remove(), 300);
    this.all.delete(pid);
  }

  react(kind: ReactionKind, x: number, y: number, color: string) {
    const el = document.createElement("div");
    el.className = "reaction";
    el.style.setProperty("--c", color);
    el.innerHTML = reactionIcon(kind, color);
    this.layer.append(el);
    this.reactions.push({ x, y, t0: performance.now(), el });
  }

  /** Move everything toward where it should be. Called every frame. */
  tick(cam: Camera, now: number, dt: number) {
    const k = 1 - Math.exp(-dt * 22);
    const kf = 1 - Math.exp(-dt * 9);
    for (const s of this.all.values()) {
      const c = s.p.c;
      const idle = now - s.lastMove > 60_000;
      if (!c || idle) {
        s.el.classList.add("away");
        s.seen = false;
        continue;
      }
      const [tx, ty] = cam.toScreen(c[0], c[1]);
      if (!s.seen) {
        s.sx = s.fx = tx;
        s.sy = s.fy = ty;
        s.seen = true;
        s.trail = [];
      }
      s.el.classList.remove("away");
      s.sx += (tx - s.sx) * k;
      s.sy += (ty - s.sy) * k;
      s.fx += (s.sx - s.fx) * kf;
      s.fy += (s.sy - s.fy) * kf;
      s.cursor.setAttribute("d", s.p.pen ? PEN : POINTER);
      s.cursor.setAttribute("transform", s.p.pen ? "rotate(35.5)" : "");
      s.cursor.parentElement!.classList.toggle("pen", !!s.p.pen);
      (s.cursor.parentElement as unknown as SVGElement).style.transform = `translate(${s.sx - 10}px, ${s.sy - 40}px)`;
      s.flag.style.transform = `translate(${s.fx + 16}px, ${s.fy + 30}px)`;
      // The streak: the last tenth of a second of movement, tapering.
      s.trail.unshift([s.sx, s.sy]);
      if (s.trail.length > 7) s.trail.length = 7;
      this.ribbon(s);
    }
    this.reactions = this.reactions.filter((r) => {
      const p = (now - r.t0) / 1700;
      if (p >= 1) {
        r.el.remove();
        return false;
      }
      const [x, y] = cam.toScreen(r.x, r.y);
      const pop = p < 0.18 ? 1 - (1 - p / 0.18) ** 3 * 1.0 : 1;
      const scale = p < 0.18 ? 0.3 + pop * 0.85 : 1.15 - Math.min(0.15, (p - 0.18) * 0.6);
      const rise = (1 - (1 - p) ** 3) * 70;
      r.el.style.transform = `translate(${x + Math.sin(p * 9) * 6 - 24}px, ${y - 40 - rise}px) scale(${scale.toFixed(3)})`;
      r.el.style.opacity = String(p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1);
      return true;
    });
  }

  private ribbon(s: Someone) {
    const pts = s.trail;
    let length = 0;
    for (let i = 0; i < pts.length - 1; i++) length += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (length < 14 || pts.length < 3) {
      s.ribbon.setAttribute("d", "");
      return;
    }
    const n = pts.length - 1;
    const left: string[] = [];
    const right: string[] = [];
    for (let i = 0; i <= n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n, i + 1)];
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const d = Math.hypot(dx, dy) || 1;
      const half = 5 * (1 - i / n) ** 1.3 + 0.3;
      left.push(`${(pts[i][0] - (dy / d) * half).toFixed(1)} ${(pts[i][1] + (dx / d) * half).toFixed(1)}`);
      right.unshift(`${(pts[i][0] + (dy / d) * half).toFixed(1)} ${(pts[i][1] - (dx / d) * half).toFixed(1)}`);
    }
    s.ribbon.setAttribute("d", `M${left.join("L")}L${right.join("L")}Z`);
    s.ribbon.style.opacity = String(Math.min(0.55, (length - 14) / 60));
  }
}
