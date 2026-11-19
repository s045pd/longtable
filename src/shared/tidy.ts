// The tidy: every note goes to the column of the day it names, in a grid of
// seven weekday columns (and an ANY DAY column when some notes name no day),
// one grid for each week that notes with a date of their own fall in.
// Within a day, notes without a time come first, then the timed ones in
// order. Anything else that was tidied (photos, checklists, labels, pen
// strokes) lines up in a row under the week. A board that already has a week
// keeps it: the notes already in it are sorted again together with the new.
// A day or time picked by hand on a note wins over the words on it.
import { ANY, ISO_DATE, addDays, noteDay, noteTime, noteWeek } from "./days";
import { NOTE, PITCH_X, PITCH_Y, HEADER_GAP, bounds, union, type Box } from "./geometry";
import type { Effect, Item, NoteItem, Op, WeekItem } from "./types";
import { anchorsOf } from "./attach";

export interface TidyPlan {
  ops: Op[];
  fx: Effect;
  /** Where everything ends up, for the camera. */
  box: Box;
  /** How many notes went into the week. */
  count: number;
}

/** Seconds each column and row waits: the wave runs left to right, then down. */
export const waveDelay = (col: number, row: number) => col * 0.068 + row * 0.034;
/** How long one item's flight lasts. */
export const FLIGHT = 0.7;

/** Notes sitting in a week's cells (give or take), so a second tidy re-sorts them too. */
export function notesInWeek(week: WeekItem, notes: NoteItem[]): NoteItem[] {
  const out: NoteItem[] = [];
  for (const n of notes) {
    const col = (n.x - week.x) / PITCH_X;
    const row = (n.y - week.y) / PITCH_Y;
    const c = Math.round(col);
    const r = Math.round(row);
    if (c < 0 || c >= week.cols || r < 0 || r > 40) continue;
    if (Math.abs(n.x - (week.x + c * PITCH_X)) < 70 && Math.abs(n.y - (week.y + r * PITCH_Y)) < 70) out.push(n);
  }
  return out;
}

const readingOrder = (a: Item, b: Item) => (Math.abs(a.y - b.y) > 60 ? a.y - b.y : a.x - b.x);

/** The Monday a week shows: its own, or the board's week. */
export const weekStart = (w: WeekItem, weekOf: string) => (w.of && ISO_DATE.test(w.of) ? w.of : weekOf);

/** From the last row of one week down to the first row of the next: room for the next week's headers. */
const WEEK_GAP = NOTE / 2 + 96 + HEADER_GAP + 34;

/** Every week on the board, top to bottom. */
export const weeksOn = (board: Item[]) => board.filter((it): it is WeekItem => it.type === "week").sort((a, b) => a.y - b.y);

const byTime = (a: NoteItem, b: NoteItem) => {
  const ta = noteTime(a);
  const tb = noteTime(b);
  if (ta === null && tb === null) return readingOrder(a, b);
  if (ta === null) return -1;
  if (tb === null) return 1;
  return ta - tb || readingOrder(a, b);
};

/**
 * Lay notes out by day. The board's own week (meta.weekOf) takes the notes
 * that name a weekday or no day; a note with a date of its own goes to its
 * date's week, so "today" and "next Wednesday" can both be right. Each week
 * is a band of seven columns (eight when the board's week has an ANY DAY
 * column), one under the other in date order.
 */
export function planTidy(board: Item[], targetIds: string[] | null, newId: () => string, weekOf = ""): TidyPlan | null {
  const chosen = targetIds ? new Set(targetIds) : null;
  const targets = chosen ? board.filter((it) => chosen.has(it.id)) : board.slice();
  const allNotes = board.filter((it): it is NoteItem => it.type === "note");
  const existing = weeksOn(board);

  const noteIds = new Set(targets.filter((it) => it.type === "note").map((it) => it.id));
  for (const w of existing) for (const n of notesInWeek(w, allNotes)) noteIds.add(n.id);
  const notes = allNotes.filter((n) => noteIds.has(n.id));
  if (!notes.length) return null;
  // Strokes on a card, and lines between cards, follow the cards (withStrokes), not into the line-up.
  const items = new Map(board.map((it) => [it.id, it]));
  const others = targets.filter((it) => it.type !== "note" && it.type !== "week" && !anchorsOf(items, it).length);

  // Group by week, then by day: Monday … Sunday, and ANY DAY in the board's week.
  const groups = new Map<string, NoteItem[][]>();
  for (const n of notes) {
    const key = noteWeek(n, weekOf);
    if (!groups.has(key)) groups.set(key, Array.from({ length: 8 }, () => []));
    groups.get(key)![noteDay(n) ?? 7].push(n);
  }
  for (const columns of groups.values()) for (const column of columns) column.sort(byTime);
  const keys = [...groups.keys()].sort();

  // Where the weeks sit: the topmost existing week stays put; a board without
  // one takes the top-left corner of what is tidied (or goes under the board
  // when only a few things are tidied, clear of what stays where it is).
  let origin: { x: number; y: number };
  if (existing.length) origin = { x: existing[0].x, y: existing[0].y };
  else {
    const all = union(board.map(bounds))!;
    const partial = targets.length < board.length;
    origin = partial
      ? { x: Math.round(all.x0 + NOTE / 2), y: Math.round(all.y1 + 160 + HEADER_GAP) }
      : { x: Math.round(all.x0 + NOTE / 2), y: Math.round(all.y0 + HEADER_GAP + 40) };
  }

  const ops: Op[] = [];
  const delays: Record<string, number> = {};
  const unused = new Set(existing.map((w) => w.id));
  const weekIds: string[] = [];
  const minZ = Math.min(0, ...board.map((it) => it.z));
  let y = origin.y;
  let rowBase = 0;
  let last = 0;
  let maxCols = 7;
  for (const key of keys) {
    const columns = groups.get(key)!;
    const cols = columns[7].length ? 8 : 7;
    maxCols = Math.max(maxCols, cols);
    const of = key === weekOf ? "" : key;
    // Reuse a week already showing this one, if there is one.
    const reuse = existing.find((w) => unused.has(w.id) && weekStart(w, weekOf) === key);
    let id: string;
    if (reuse) {
      unused.delete(reuse.id);
      id = reuse.id;
      const set: Partial<WeekItem> = {};
      if (reuse.cols !== cols) set.cols = cols;
      if (reuse.x !== origin.x || reuse.y !== y) Object.assign(set, { x: origin.x, y });
      if ((reuse.of ?? "") !== of) set.of = of;
      if (Object.keys(set).length) ops.push({ op: "patch", id, set });
    } else {
      id = newId();
      ops.push({ op: "put", item: { id, type: "week", x: origin.x, y, rot: 0, z: minZ - 1, cols, ...(of ? { of } : {}) } });
    }
    weekIds.push(id);
    let rows = 0;
    columns.slice(0, cols).forEach((column, col) => {
      rows = Math.max(rows, column.length);
      column.forEach((n, row) => {
        const x = origin.x + col * PITCH_X;
        const ny = y + row * PITCH_Y;
        delays[n.id] = waveDelay(col, rowBase + row);
        last = Math.max(last, delays[n.id]);
        if (n.x !== x || n.y !== ny || n.rot !== 0) ops.push({ op: "patch", id: n.id, set: { x, y: ny, rot: 0 } });
      });
    });
    rows = Math.max(1, rows);
    rowBase += rows + 1;
    y += (rows - 1) * PITCH_Y + WEEK_GAP;
  }
  // Weeks left empty go.
  for (const id of unused) ops.push({ op: "del", id });

  // Everything else lines up under the last week, wrapping at its width.
  const kinds = ["photo", "check", "label", "stroke"];
  others.sort((a, b) => kinds.indexOf(a.type) - kinds.indexOf(b.type) || readingOrder(a, b));
  const left = origin.x - NOTE / 2;
  const width = (maxCols - 1) * PITCH_X + NOTE;
  let cursorX = left;
  let rowTop = y - WEEK_GAP + PITCH_Y / 2 + 60;
  let rowHeight = 0;
  others.forEach((it, i) => {
    const b = bounds(it);
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    if (cursorX > left && cursorX + w > left + width) {
      cursorX = left;
      rowTop += rowHeight + 40;
      rowHeight = 0;
    }
    const x = Math.round(it.x + cursorX - b.x0);
    const oy = Math.round(it.y + rowTop - b.y0);
    cursorX += w + 40;
    rowHeight = Math.max(rowHeight, h);
    delays[it.id] = last + 0.08 + i * 0.03;
    if (x !== it.x || oy !== it.y || it.rot !== 0) ops.push({ op: "patch", id: it.id, set: { x, y: oy, ...(it.type === "stroke" ? {} : { rot: 0 }) } });
  });

  const after = new Map(board.map((it) => [it.id, it]));
  for (const op of ops) {
    if (op.op === "put") after.set(op.item.id, op.item);
    else if (op.op === "patch") after.set(op.id, { ...after.get(op.id)!, ...op.set } as Item);
    else if (op.op === "del") after.delete(op.id);
  }
  const moved = [...weekIds, ...notes.map((n) => n.id), ...others.map((o) => o.id)];
  const box = union(moved.map((id) => bounds(after.get(id)!)))!;
  const fx: Effect = { kind: "tidy", delays, week: weekIds[0], count: notes.length, ...(weekIds.length > 1 ? { weeks: weekIds } : {}) };
  return { ops, fx, box, count: notes.length };
}

/** How many rows the week's fullest column has. */
function weekRows(week: WeekItem, notes: NoteItem[]): number {
  const counts = new Map<number, number>();
  for (const n of notesInWeek(week, notes)) {
    const col = Math.round((n.x - week.x) / PITCH_X);
    counts.set(col, (counts.get(col) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

/** The column of a week that a point is over (headers included, plus a row's room below), or null. */
export function columnAt(week: WeekItem, rows: number, x: number, y: number): number | null {
  const col = Math.round((x - week.x) / PITCH_X);
  if (col < 0 || col >= week.cols) return null;
  const top = week.y - PITCH_Y / 2 - HEADER_GAP;
  const bottom = week.y + Math.max(1, rows) * PITCH_Y + PITCH_Y / 2;
  return y >= top && y <= bottom ? col : null;
}

/**
 * Notes let go of after a drag. Each one that lands in a column of a week
 * takes that column's day (picked by hand from then on: a weekday in the
 * board's week, a date in any other), and the weeks sort themselves again so
 * they slot in and the gaps they left close up. `leaving` are the notes that
 * sat in a week when the drag began.
 */
export function planDrop(board: Item[], dropped: string[], leaving: string[], newId: () => string, weekOf = ""): Op[] {
  const weeks = weeksOn(board);
  if (!weeks.length) return [];
  const moving = new Set(dropped);
  const notes = board.filter((it): it is NoteItem => it.type === "note");
  const still = notes.filter((n) => !moving.has(n.id));
  const rows = new Map(weeks.map((w) => [w.id, weekRows(w, still)]));
  const ops: Op[] = [];
  const landed: string[] = [];
  const after = new Map(board.map((it) => [it.id, it]));
  for (const id of dropped) {
    const n = after.get(id);
    if (!n || n.type !== "note") continue;
    let hit: { week: WeekItem; col: number } | null = null;
    for (const w of weeks) {
      const col = columnAt(w, rows.get(w.id)!, n.x, n.y);
      if (col !== null) hit = { week: w, col };
    }
    if (!hit) continue;
    landed.push(id);
    const start = weekStart(hit.week, weekOf);
    const day = hit.col >= 7 ? null : hit.col;
    const week = day === null ? weekOf : start;
    if (noteDay(n) !== day || noteWeek(n, weekOf) !== week) {
      const set: Partial<NoteItem> = day === null ? { day: ANY, date: "" } : week === weekOf ? { day, date: "" } : { date: addDays(week, day) };
      ops.push({ op: "patch", id, set });
      after.set(id, { ...n, ...set } as NoteItem);
    }
  }
  if (!landed.length && !leaving.some((id) => moving.has(id))) return [];
  const plan = planTidy([...after.values()], landed, newId, weekOf);
  return plan ? [...ops, ...plan.ops] : ops;
}
