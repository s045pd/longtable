// The tidy: every note goes to the column of the day it names, in a grid of
// seven weekday columns (and an ANY DAY column when some notes name no day).
// Within a day, notes without a time come first, then the timed ones in
// order. Anything else that was tidied (photos, checklists, labels, pen
// strokes) lines up in a row under the week. A board that already has a week
// keeps it: the notes already in it are sorted again together with the new.
// A day or time picked by hand on a note wins over the words on it.
import { ANY, noteDay, noteTime } from "./days";
import { NOTE, PITCH_X, PITCH_Y, HEADER_GAP, bounds, union, type Box } from "./geometry";
import type { Effect, Item, NoteItem, Op, WeekItem } from "./types";

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

export function planTidy(board: Item[], targetIds: string[] | null, newId: () => string): TidyPlan | null {
  const chosen = targetIds ? new Set(targetIds) : null;
  const targets = chosen ? board.filter((it) => chosen.has(it.id)) : board.slice();
  const allNotes = board.filter((it): it is NoteItem => it.type === "note");
  const week = (targets.find((it) => it.type === "week") ?? board.find((it) => it.type === "week")) as WeekItem | undefined;

  const noteIds = new Set(targets.filter((it) => it.type === "note").map((it) => it.id));
  if (week) for (const n of notesInWeek(week, allNotes)) noteIds.add(n.id);
  const notes = allNotes.filter((n) => noteIds.has(n.id));
  if (!notes.length) return null;
  const others = targets.filter((it) => it.type !== "note" && it.type !== "week");

  // Columns: Monday … Sunday, then ANY DAY.
  const columns: NoteItem[][] = Array.from({ length: 8 }, () => []);
  for (const n of notes) columns[noteDay(n) ?? 7].push(n);
  const cols = columns[7].length ? 8 : 7;
  for (const column of columns) {
    column.sort((a, b) => {
      const ta = noteTime(a);
      const tb = noteTime(b);
      if (ta === null && tb === null) return readingOrder(a, b);
      if (ta === null) return -1;
      if (tb === null) return 1;
      return ta - tb || readingOrder(a, b);
    });
  }

  // Where the week sits: an existing week stays put; a new one takes the
  // top-left corner of what is being tidied.
  let origin: { x: number; y: number };
  const ops: Op[] = [];
  let weekId: string;
  if (week) {
    origin = { x: week.x, y: week.y };
    weekId = week.id;
    if (week.cols !== cols) ops.push({ op: "patch", id: week.id, set: { cols } });
  } else {
    // Tidying everything: the week takes the board's top-left corner, since
    // everything moves anyway. Tidying a few: it goes under the board, clear
    // of what stays where it is.
    const all = union(board.map(bounds))!;
    const partial = targets.length < board.length;
    origin = partial
      ? { x: Math.round(all.x0 + NOTE / 2), y: Math.round(all.y1 + 160 + HEADER_GAP) }
      : { x: Math.round(all.x0 + NOTE / 2), y: Math.round(all.y0 + HEADER_GAP + 40) };
    weekId = newId();
    const minZ = Math.min(0, ...board.map((it) => it.z));
    ops.push({ op: "put", item: { id: weekId, type: "week", x: origin.x, y: origin.y, rot: 0, z: minZ - 1, cols } });
  }

  const delays: Record<string, number> = {};
  let rows = 0;
  let last = 0;
  columns.slice(0, cols).forEach((column, col) => {
    rows = Math.max(rows, column.length);
    column.forEach((n, row) => {
      const x = origin.x + col * PITCH_X;
      const y = origin.y + row * PITCH_Y;
      delays[n.id] = waveDelay(col, row);
      last = Math.max(last, delays[n.id]);
      if (n.x !== x || n.y !== y || n.rot !== 0) ops.push({ op: "patch", id: n.id, set: { x, y, rot: 0 } });
    });
  });

  // Everything else lines up under the week, wrapping at its width.
  const kinds = ["photo", "check", "label", "stroke"];
  others.sort((a, b) => kinds.indexOf(a.type) - kinds.indexOf(b.type) || readingOrder(a, b));
  const left = origin.x - NOTE / 2;
  const width = (cols - 1) * PITCH_X + NOTE;
  let cursorX = left;
  let rowTop = origin.y + Math.max(1, rows) * PITCH_Y - PITCH_Y / 2 + 60;
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
    const dx = cursorX - b.x0;
    const dy = rowTop - b.y0;
    const x = Math.round(it.x + dx);
    const y = Math.round(it.y + dy);
    cursorX += w + 40;
    rowHeight = Math.max(rowHeight, h);
    delays[it.id] = last + 0.08 + i * 0.03;
    if (x !== it.x || y !== it.y || it.rot !== 0) ops.push({ op: "patch", id: it.id, set: { x, y, ...(it.type === "stroke" ? {} : { rot: 0 }) } });
  });

  const after = new Map(board.map((it) => [it.id, it]));
  for (const op of ops) {
    if (op.op === "put") after.set(op.item.id, op.item);
    else if (op.op === "patch") after.set(op.id, { ...after.get(op.id)!, ...op.set } as Item);
  }
  const moved = [weekId, ...notes.map((n) => n.id), ...others.map((o) => o.id)];
  const box = union(moved.map((id) => bounds(after.get(id)!)))!;
  return { ops, fx: { kind: "tidy", delays, week: weekId, count: notes.length }, box, count: notes.length };
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
 * Notes let go of after a drag. Each one that lands in a column of the week
 * takes that column's day (picked by hand from then on), and the week sorts
 * itself again so they slot in and the gaps they left close up. `leaving`
 * are the notes that sat in the week when the drag began.
 */
export function planDrop(board: Item[], dropped: string[], leaving: string[], newId: () => string): Op[] {
  const week = board.find((it): it is WeekItem => it.type === "week");
  if (!week) return [];
  const moving = new Set(dropped);
  const notes = board.filter((it): it is NoteItem => it.type === "note");
  const rows = weekRows(week, notes.filter((n) => !moving.has(n.id)));
  const ops: Op[] = [];
  const landed: string[] = [];
  const after = new Map(board.map((it) => [it.id, it]));
  for (const id of dropped) {
    const n = after.get(id);
    if (!n || n.type !== "note") continue;
    const col = columnAt(week, rows, n.x, n.y);
    if (col === null) continue;
    landed.push(id);
    const want = col >= 7 ? null : col;
    if (noteDay(n) !== want) {
      const set = { day: want === null ? ANY : want };
      ops.push({ op: "patch", id, set });
      after.set(id, { ...n, ...set });
    }
  }
  if (!landed.length && !leaving.some((id) => moving.has(id))) return [];
  const plan = planTidy([...after.values()], landed, newId);
  return plan ? [...ops, ...plan.ops] : ops;
}
