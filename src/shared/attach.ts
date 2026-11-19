// Pen strokes and the cards they are drawn on. A card is a note, checklist,
// photo or heading.
//
// - Drawn on a card, or ringed around one: the stroke belongs to it (`on`).
//   It moves with the card (a drag, a tidy, a drop into the week, an
//   assistant's change), stays on top of it, is copied with it and goes when
//   it goes.
// - Drawn from one card to another (an arrow): a link (`from`, `to`). When
//   either card moves, the line is turned and stretched so its ends stay on
//   the same spots of both cards, hand-drawn shape and all. It goes when
//   either card goes.
// - Starting or ending on one card, the other end in the open: it belongs to
//   that card, like the first kind.
// - Touching no card: free, as before (a tidy lines it up under the week).
import { bounds, type Box } from "./geometry";
import type { Item, Op, StrokeItem } from "./types";

const CARDS = new Set<Item["type"]>(["note", "check", "photo", "label"]);
/** How far a stroke on a card may run over its edge and still be on it. */
const EDGE = 24;
/** How close to a card an end of a line must start or stop to be on it. */
const END = 16;
/** How much of a line, from each end, may reach a card for that end to be on it (an arrowhead's barbs often stop short). */
const END_SHARE = 0.25;
/** How much a ring around a card must share with it (overlap over union). */
const AROUND = 0.4;

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
function overlap(a: Box, b: Box): number {
  const i = area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
  const u = area(a) + area(b) - i;
  return u > 0 ? i / u : 0;
}
const isCard = (it: Item | undefined): it is Item => !!it && CARDS.has(it.type);

/** The card a stroke belongs to (drawn on or around it), if it is still on the board. */
export function cardOf(items: Map<string, Item>, it: Item | undefined): string | null {
  if (!it || it.type !== "stroke" || !it.on) return null;
  return isCard(items.get(it.on)) ? it.on : null;
}

/** The two cards a line links, if both are still on the board. */
export function linkOf(items: Map<string, Item>, it: Item | undefined): [string, string] | null {
  if (!it || it.type !== "stroke" || !it.from || !it.to) return null;
  return isCard(items.get(it.from)) && isCard(items.get(it.to)) ? [it.from, it.to] : null;
}

/** The cards a stroke hangs on: its card, or the two it links; none when free. */
export function anchorsOf(items: Map<string, Item>, it: Item | undefined): string[] {
  const card = cardOf(items, it);
  return card ? [card] : (linkOf(items, it) ?? []);
}

/** The strokes that belong to any of these cards (not the lines between cards). */
export function strokesOn(items: Iterable<Item>, cards: Set<string>): StrokeItem[] {
  const out: StrokeItem[] = [];
  for (const it of items) if (it.type === "stroke" && it.on && cards.has(it.on)) out.push(it);
  return out;
}

/** Lines with an end on any of these cards. */
export function linesTo(items: Iterable<Item>, cards: Set<string>): StrokeItem[] {
  const out: StrokeItem[] = [];
  for (const it of items) if (it.type === "stroke" && it.from && it.to && (cards.has(it.from) || cards.has(it.to))) out.push(it);
  return out;
}

function cardAt(items: Item[], x: number, y: number, skip: string): Item | null {
  let best: Item | null = null;
  for (const it of items) {
    if (!isCard(it) || it.id === skip) continue;
    const c = bounds(it);
    if (x >= c.x0 - END && x <= c.x1 + END && y >= c.y0 - END && y <= c.y1 + END && (!best || it.z > best.z)) best = it;
  }
  return best;
}

/**
 * What a stroke hangs on, from where it is drawn (see the top of this file),
 * as the fields to set on it; "" clears one.
 */
export function attachFor(board: Iterable<Item>, stroke: StrokeItem): { on: string; from: string; to: string } {
  const items = [...board];
  const s = bounds(stroke);
  let ringed: Item | null = null;
  for (const it of items) {
    if (!isCard(it) || it.id === stroke.id) continue;
    const c = bounds(it);
    const on = s.x0 >= c.x0 - EDGE && s.x1 <= c.x1 + EDGE && s.y0 >= c.y0 - EDGE && s.y1 <= c.y1 + EDGE;
    if ((on || overlap(s, c) >= AROUND) && (!ringed || it.z > ringed.z)) ringed = it;
  }
  if (ringed) return { on: ringed.id, from: "", to: "" };
  const p = stroke.pts;
  const n = p.length / 2;
  if (n < 1) return { on: "", from: "", to: "" };
  // The first card the line touches from each end, within the end part of it.
  const look = Math.max(1, Math.ceil(n * END_SHARE));
  const reach = (fromEnd: boolean) => {
    for (let k = 0; k < look; k++) {
      const i = fromEnd ? n - 1 - k : k;
      const card = cardAt(items, stroke.x + p[2 * i], stroke.y + p[2 * i + 1], stroke.id);
      if (card) return card;
    }
    return null;
  };
  const a = reach(false);
  const b = reach(true);
  if (a && b && a.id !== b.id) return { on: "", from: a.id, to: b.id };
  const one = a ?? b;
  return { on: one ? one.id : "", from: "", to: "" };
}

/**
 * The line moved so its first point follows card A (by `da`) and its last
 * follows card B (by `db`): turned and stretched about its ends, its drawn
 * shape kept.
 */
export function refit(stroke: StrokeItem, da: { x: number; y: number }, db: { x: number; y: number }): { x: number; y: number; pts: number[] } {
  const p = stroke.pts;
  const n = p.length;
  const sx = stroke.x + p[0];
  const sy = stroke.y + p[1];
  const ex = stroke.x + p[n - 2];
  const ey = stroke.y + p[n - 1];
  const nsx = sx + da.x;
  const nsy = sy + da.y;
  const nex = ex + db.x;
  const ney = ey + db.y;
  const len = Math.hypot(ex - sx, ey - sy);
  const x = Math.round(nsx);
  const y = Math.round(nsy);
  const out: number[] = [];
  if (len < 1) {
    // No length to turn about: just follow, halfway between the two moves.
    const mx = (da.x + db.x) / 2;
    const my = (da.y + db.y) / 2;
    for (let i = 0; i < n; i += 2) out.push(Math.round((stroke.x + p[i] + mx - x) * 10) / 10, Math.round((stroke.y + p[i + 1] + my - y) * 10) / 10);
    return { x, y, pts: out };
  }
  const k = Math.min(20, Math.max(0.05, Math.hypot(nex - nsx, ney - nsy) / len));
  const turn = Math.atan2(ney - nsy, nex - nsx) - Math.atan2(ey - sy, ex - sx);
  const c = Math.cos(turn) * k;
  const s = Math.sin(turn) * k;
  for (let i = 0; i < n; i += 2) {
    const dx = stroke.x + p[i] - sx;
    const dy = stroke.y + p[i + 1] - sy;
    out.push(Math.round((nsx + dx * c - dy * s - x) * 10) / 10, Math.round((nsy + dx * s + dy * c - y) * 10) / 10);
  }
  return { x, y, pts: out };
}

/**
 * These changes, plus what they mean for the strokes on the cards they touch:
 * a card that moves takes its strokes the same way and drags the ends of its
 * lines; a card that goes takes both along. Strokes the changes already move
 * or remove are left to them. `items` is the board before the changes.
 */
export function withStrokes(items: Map<string, Item>, ops: Op[]): Op[] {
  const touched = new Set<string>();
  const moved = new Map<string, { x: number; y: number }>();
  const gone = new Set<string>();
  for (const op of ops) {
    if (op.op === "put") touched.add(op.item.id);
    else if (op.op === "patch" || op.op === "del" || op.op === "vote") touched.add(op.id);
    if (op.op === "patch" && (op.set.x !== undefined || op.set.y !== undefined)) {
      const was = moved.get(op.id) ?? items.get(op.id);
      if (was) moved.set(op.id, { x: op.set.x ?? was.x, y: op.set.y ?? was.y });
    } else if (op.op === "del") gone.add(op.id);
  }
  if (!moved.size && !gone.size) return ops;
  const shift = (id: string) => {
    const card = items.get(id)!;
    const to = moved.get(id);
    return to ? { x: to.x - card.x, y: to.y - card.y } : { x: 0, y: 0 };
  };
  const extra: Op[] = [];
  for (const it of items.values()) {
    if (it.type !== "stroke" || touched.has(it.id)) continue;
    const anchors = anchorsOf(items, it);
    if (!anchors.length) continue;
    if (anchors.some((a) => gone.has(a))) {
      extra.push({ op: "del", id: it.id });
      continue;
    }
    if (!anchors.some((a) => moved.has(a))) continue;
    if (anchors.length === 1) {
      const d = shift(anchors[0]);
      if (d.x || d.y) extra.push({ op: "patch", id: it.id, set: { x: Math.round(it.x + d.x), y: Math.round(it.y + d.y) } });
    } else {
      const da = shift(anchors[0]);
      const db = shift(anchors[1]);
      if (da.x === db.x && da.y === db.y) {
        if (da.x || da.y) extra.push({ op: "patch", id: it.id, set: { x: Math.round(it.x + da.x), y: Math.round(it.y + da.y) } });
      } else extra.push({ op: "patch", id: it.id, set: refit(it, da, db) });
    }
  }
  return extra.length ? [...ops, ...extra] : ops;
}

/**
 * Stacking for raising these items to the top together: each card's strokes
 * and lines right after it, so a lifted card never covers what is drawn on it.
 */
export function stackOrder(items: Map<string, Item>, ids: string[]): Item[] {
  const chosen = new Set(ids);
  const key = (it: Item) => {
    const mine = anchorsOf(items, it).filter((a) => chosen.has(a));
    return mine.length ? Math.max(...mine.map((a) => items.get(a)!.z)) + 0.5 + it.z * 1e-9 : it.z;
  };
  return ids
    .map((id) => items.get(id))
    .filter((it): it is Item => !!it && it.type !== "week")
    .sort((a, b) => key(a) - key(b));
}
