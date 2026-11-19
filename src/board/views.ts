// The DOM for each board item. Every item is a zero-size anchor at its centre,
// moved and tilted with one transform; its shape hangs off that point. Items
// move instantly for your own changes, glide for other people's, and spring
// in a wave when someone tidies.
import { ANY_DAY, DAY_HEADERS, dateOf, dayPicked, findDay, noteDay, timePicked, whenLabel } from "../shared/days";
import { CHECK, HEADER_GAP, LABEL_SIZE, NOTE, PHOTO, PITCH_X, bounds, checkHeight } from "../shared/geometry";
import { tones } from "../shared/colors";
import type { CheckItem, Item, LabelItem, NoteItem, PhotoItem, StrokeItem, WeekItem } from "../shared/types";
import { artSvg } from "./art";
import { fitNote } from "./fit";

export type Motion = { kind: "now" } | { kind: "glide" } | { kind: "spring"; delay: number };

/** A spring that overshoots a little and settles, as a CSS easing. */
export const SPRING = (() => {
  const zeta = 0.6;
  const omega = 13;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const T = 0.7;
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * T;
    const v = 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    pts.push((i === 40 ? 1 : v).toFixed(4));
  }
  const linear = `linear(${pts.join(", ")})`;
  return typeof CSS !== "undefined" && CSS.supports?.("transition-timing-function", linear) ? linear : "cubic-bezier(.3,1.45,.55,1)";
})();

/** The board's week (its Monday), so notes and the week can show real dates. */
let weekOf = "";
export const setWeekOf = (iso: string) => (weekOf = iso);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A cheap stable hash, for per-item quirks such as which notes have a curled corner. */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A smooth path through pen points: straight segments between their midpoints, curved at the points. */
export function strokePath(pts: number[], dx = 0, dy = 0): string {
  const n = pts.length / 2;
  if (n === 0) return "";
  const P = (i: number) => [pts[i * 2] + dx, pts[i * 2 + 1] + dy];
  if (n === 1) {
    const [x, y] = P(0);
    return `M${x} ${y}l0.01 0`;
  }
  let d = `M${P(0)[0].toFixed(1)} ${P(0)[1].toFixed(1)}`;
  for (let i = 1; i < n - 1; i++) {
    const [x, y] = P(i);
    const [nx, ny] = P(i + 1);
    d += `Q${x.toFixed(1)} ${y.toFixed(1)} ${((x + nx) / 2).toFixed(1)} ${((y + ny) / 2).toFixed(1)}`;
  }
  const [lx, ly] = P(n - 1);
  return d + `L${lx.toFixed(1)} ${ly.toFixed(1)}`;
}

function noteWords(it: NoteItem): string {
  const fit = fitNote(it.text);
  // Underline the day word only while it is what decides the day.
  const named = findDay(it.text);
  const day = named && named.day === noteDay(it) ? named : null;
  let marked = false;
  const lines = fit.lines.map((line) => {
    if (!marked && day) {
      const m = findDay(line);
      if (m && m.day === day.day) {
        marked = true;
        return `${esc(line.slice(0, m.index))}<span class="day-word">${esc(line.slice(m.index, m.index + m.length))}</span>${esc(line.slice(m.index + m.length))}`;
      }
    }
    return esc(line) || "&nbsp;";
  });
  return `<div class="words" style="font-size:${fit.size}px">${lines.map((l) => `<div>${l}</div>`).join("")}</div>`;
}

function voteDots(it: NoteItem): string {
  const votes = Object.entries(it.votes ?? {});
  if (!votes.length) return "";
  const shown = votes.slice(0, 7);
  return `<div class="votes">${shown.map(([, c]) => `<i style="--v:${c}"></i>`).join("")}${votes.length > 7 ? `<b>+${votes.length - 7}</b>` : ""}</div>`;
}

export class ItemView {
  el: HTMLDivElement;
  shape: HTMLDivElement;
  item: Item;
  private settle = 0;
  /** Set while its words are being typed into; the view then leaves them alone. */
  editing = false;

  constructor(item: Item, born: boolean) {
    this.item = item;
    this.el = document.createElement("div");
    this.el.className = `item ${item.type}`;
    this.el.dataset.id = item.id;
    this.shape = document.createElement("div");
    this.shape.className = "shape";
    this.el.append(this.shape);
    this.paint();
    this.place("now");
    if (born) {
      this.shape.classList.add("born");
      this.shape.addEventListener("animationend", () => this.shape.classList.remove("born"), { once: true });
    }
  }

  update(next: Item, motion: Motion) {
    const prev = this.item;
    this.item = next;
    if (this.contentChanged(prev, next)) this.paint();
    if (prev.x !== next.x || prev.y !== next.y || prev.rot !== next.rot || prev.z !== next.z) this.place(motion.kind, motion.kind === "spring" ? motion.delay : 0);
  }

  private contentChanged(a: Item, b: Item) {
    for (const key of Object.keys(b) as (keyof Item)[]) {
      if (key === "x" || key === "y" || key === "rot" || key === "z") continue;
      if (a[key] !== b[key]) return true;
    }
    return false;
  }

  place(kind: Motion["kind"], delay = 0) {
    const { x, y, rot, z } = this.item;
    const s = this.el.style;
    clearTimeout(this.settle);
    if (kind === "now") s.transition = "";
    else if (kind === "glide") s.transition = "transform 120ms linear";
    else s.transition = `transform 700ms ${SPRING} ${delay.toFixed(3)}s`;
    s.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
    s.zIndex = String(Math.round(z));
    if (kind !== "now") this.settle = window.setTimeout(() => (s.transition = ""), (kind === "spring" ? 720 + delay * 1000 : 140));
    if (kind === "spring") {
      this.el.classList.add("flying");
      window.setTimeout(() => this.el.classList.remove("flying"), 760 + delay * 1000);
    }
  }

  paint() {
    if (this.editing) return;
    const it = this.item;
    switch (it.type) {
      case "note":
        return this.paintNote(it);
      case "label":
        return this.paintLabel(it);
      case "check":
        return this.paintCheck(it);
      case "photo":
        return this.paintPhoto(it);
      case "stroke":
        return this.paintStroke(it);
      case "week":
        return this.paintWeek(it);
    }
  }

  private paintNote(it: NoteItem) {
    const t = tones(it.color);
    const curl = hash(it.id) % 4 === 0;
    const picked = dayPicked(it) || timePicked(it);
    this.shape.style.cssText = `width:${NOTE}px;height:${NOTE}px;left:${-NOTE / 2}px;top:${-NOTE / 2}px;--c:${t.base};--c-light:${t.light};--c-dark:${t.dark}`;
    this.shape.innerHTML =
      `<div class="shadow"></div><div class="paper${curl ? " curl" : ""}"></div>${curl ? '<div class="fold"></div>' : ""}` +
      noteWords(it) +
      voteDots(it) +
      `<button class="day-tag${picked ? " picked" : ""}" title="Pick the day · D" aria-label="Day: ${esc(whenLabel(it, weekOf))}. Pick the day">${esc(whenLabel(it, weekOf))}</button>`;
    this.shape.title = it.by ? `${it.by}` : "";
  }

  private paintLabel(it: LabelItem) {
    const b = bounds(it);
    const w = b.x1 - b.x0;
    this.shape.style.cssText = `left:${-w / 2}px;top:${-LABEL_SIZE * 0.72}px;width:${w}px;height:${LABEL_SIZE * 1.22}px;--c:${it.color}`;
    this.shape.innerHTML = `<div class="label-text">${esc(it.text) || "&nbsp;"}</div>`;
  }

  private paintCheck(it: CheckItem) {
    const h = checkHeight(it.rows.length);
    this.shape.style.cssText = `width:${CHECK.w}px;height:${h}px;left:${-CHECK.w / 2}px;top:${-h / 2}px;--c:${it.color}`;
    this.shape.innerHTML =
      `<div class="shadow"></div><div class="card"></div><div class="band"></div>` +
      `<div class="check-title">${esc(it.title) || "&nbsp;"}</div>` +
      `<div class="rows">${it.rows
        .map(
          (r, i) =>
            `<div class="row${r.done ? " done" : ""}"><button class="tick" data-row="${i}" aria-label="${r.done ? "Untick" : "Tick"} ${esc(r.text)}" aria-pressed="${r.done}"></button><span>${esc(r.text) || "&nbsp;"}</span></div>`,
        )
        .join("")}</div>`;
  }

  private paintPhoto(it: PhotoItem) {
    this.shape.style.cssText = `width:${PHOTO.w}px;height:${PHOTO.h}px;left:${-PHOTO.w / 2}px;top:${-PHOTO.h / 2}px`;
    this.shape.innerHTML = `<div class="shadow"></div><div class="card"></div><div class="art">${artSvg(it.art)}</div><div class="caption">${esc(it.caption) || "&nbsp;"}</div>`;
  }

  private paintStroke(it: StrokeItem) {
    const b = bounds(it);
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    const ox = b.x0 - it.x;
    const oy = b.y0 - it.y;
    this.shape.style.cssText = `left:${ox}px;top:${oy}px;width:${w}px;height:${h}px`;
    const d = strokePath(it.pts, -ox, -oy);
    this.shape.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path class="hit" d="${d}" stroke-width="${Math.max(22, it.width + 16)}"/><path class="ink" d="${d}" stroke="${it.color}" stroke-width="${it.width}"/></svg>`;
  }

  private paintWeek(it: WeekItem) {
    const w = (it.cols - 1) * PITCH_X + NOTE;
    this.shape.style.cssText = `left:${-NOTE / 2}px;top:${-HEADER_GAP - 34}px;width:${w}px;height:56px`;
    const heads = [...DAY_HEADERS, ANY_DAY].slice(0, it.cols);
    const date = (i: number) => {
      if (!weekOf || i > 6) return "";
      const d = dateOf(weekOf, i);
      return `<b>${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" }).toUpperCase()}</b>`;
    };
    this.shape.innerHTML = heads
      .map((h, i) => `<div class="day-head" data-col="${i}" style="left:${i * PITCH_X}px"><span>${h}</span>${date(i)}<i></i></div>`)
      .join("");
  }

  /** Type the day headers in, column by column, as the tidy's wave reaches them. */
  typeHeaders(startOf: (col: number) => number) {
    if (this.item.type !== "week") return;
    this.shape.querySelectorAll<HTMLElement>(".day-head").forEach((el) => {
      const col = Number(el.dataset.col);
      el.classList.remove("typing");
      void el.offsetWidth;
      el.style.setProperty("--at", `${startOf(col).toFixed(3)}s`);
      el.classList.add("typing");
    });
  }

  /** Underline the day word, as the tidy does when a note lands. */
  markDay(delay: number) {
    const el = this.shape.querySelector<HTMLElement>(".day-word");
    if (!el) return;
    el.classList.remove("marked");
    void el.offsetWidth;
    el.style.setProperty("--at", `${delay.toFixed(3)}s`);
    el.classList.add("marked");
  }

  remove() {
    this.el.remove();
  }
}
