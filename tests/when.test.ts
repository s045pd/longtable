import { describe, expect, it } from "vitest";
import { ANY, FROM_WORDS, NO_TIME, isFor, mondayOf, noteDate, noteDay, noteTime, noteWeek, whenLabel } from "../src/shared/days";
import { toMarkdown, weekEntries } from "../src/shared/exporter";
import { PITCH_X, PITCH_Y } from "../src/shared/geometry";
import { cleanItem, cleanOp } from "../src/shared/schema";
import { BoardState } from "../src/shared/state";
import { columnAt, planDrop, planTidy } from "../src/shared/tidy";
import type { Item, NoteItem, WeekItem } from "../src/shared/types";

let n = 0;
const id = () => `w${++n}`;
const note = (text: string, x = 0, y = 0, extra: Partial<NoteItem> = {}): NoteItem => ({ id: id(), type: "note", x, y, rot: 2, z: n, color: "#FFE38A", text, ...extra });
const META = { client: "Pell & Rye", file: "Opening week", weekOf: "2026-11-23", template: "" };

function run(items: Item[], ops: { op: string }[]) {
  const s = new BoardState(META, items);
  for (const op of ops) s.apply(op as never);
  return s;
}
const colOf = (s: BoardState, noteId: string) => {
  const week = s.list().find((it): it is WeekItem => it.type === "week")!;
  return Math.round((s.items.get(noteId)!.x - week.x) / PITCH_X);
};

describe("a day picked by hand", () => {
  it("wins over the words, and falls back to them when cleared", () => {
    expect(noteDay({ text: "Brass band Sat 10 am" })).toBe(5);
    expect(noteDay({ text: "Brass band Sat 10 am", day: 1 })).toBe(1);
    expect(noteDay({ text: "Brass band Sat 10 am", day: ANY })).toBeNull();
    expect(noteDay({ text: "Brass band Sat 10 am", day: FROM_WORDS })).toBe(5);
    expect(noteDay({ text: "Wedding cake", day: 3 })).toBe(3);
  });

  it("does the same for the time", () => {
    expect(noteTime({ text: "Brass band Sat 10 am" })).toBe(600);
    expect(noteTime({ text: "Brass band Sat 10 am", time: 14 * 60 + 30 })).toBe(870);
    expect(noteTime({ text: "Brass band Sat 10 am", time: NO_TIME })).toBeNull();
    expect(noteTime({ text: "Brass band Sat 10 am", time: FROM_WORDS })).toBe(600);
  });

  it("labels a note with its real date", () => {
    expect(whenLabel({ text: "Brass band Sat 10 am" }, "2026-11-23")).toBe("SAT 28 · 10:00");
    expect(whenLabel({ text: "Wedding cake" }, "2026-11-23")).toBe("ANY DAY");
    expect(whenLabel({ text: "Wedding cake", day: 0 }, "")).toBe("MON");
    expect(mondayOf("2026-11-28")).toBe("2026-11-23");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
  });

  it("is checked on the server: whole numbers in range only", () => {
    const ok = cleanItem({ id: "a", type: "note", x: 0, y: 0, text: "x", day: 3, time: 600 });
    expect(ok).toMatchObject({ day: 3, time: 600 });
    const bad = cleanItem({ id: "a", type: "note", x: 0, y: 0, text: "x", day: 9, time: 1.5 }) as NoteItem;
    expect(bad.day).toBeUndefined();
    expect(bad.time).toBeUndefined();
    const typeOf = () => "note" as const;
    expect(cleanOp({ op: "patch", id: "a", set: { day: -1, time: -2 } }, typeOf)).toEqual({ op: "patch", id: "a", set: { day: -1, time: -2 } });
    expect(cleanOp({ op: "patch", id: "a", set: { day: "sat" } }, typeOf)).toBeNull();
  });

  it("undoes back to reading from the words", () => {
    const a = note("Brass band Sat");
    const s = new BoardState(META, [a]);
    const op = { op: "patch", id: a.id, set: { day: 1 } } as const;
    const back = s.inverse(op);
    s.apply(op);
    expect(noteDay(s.items.get(a.id) as NoteItem)).toBe(1);
    for (const b of back) s.apply(b);
    expect(noteDay(s.items.get(a.id) as NoteItem)).toBe(5);
  });

  it("decides the tidy's column and the export", () => {
    const a = note("Brass band Sat 10 am", 0, 0, { day: 1, time: 9 * 60 });
    const b = note("Wedding cake", 300, 0, { day: 3 });
    const c = note("Hire barista Sat", 600, 0, { day: ANY });
    const s = run([a, b, c], planTidy([a, b, c], null, id)!.ops);
    expect(colOf(s, a.id)).toBe(1);
    expect(colOf(s, b.id)).toBe(3);
    expect(colOf(s, c.id)).toBe(7);
    const entries = weekEntries(s.list());
    expect(entries.map((e) => [e.text, e.day, e.time])).toEqual([
      ["Brass band Sat 10 am", 1, 540],
      ["Wedding cake", 3, null],
      ["Hire barista Sat", null, null],
    ]);
    expect(toMarkdown(META, s.list())).toContain("## Tuesday 24 Nov\n- [ ] 09:00 Brass band Sat 10 am");
  });
});

describe("dropping notes on the week", () => {
  function tidied() {
    const items = [note("Oven check Mon 6 am"), note("Flyers out Wed"), note("Taste panel Thu 4 pm"), note("Brass band Sat 10 am"), note("Loose idea", 900, 900)];
    const loose = items[4];
    const plan = planTidy(items, items.slice(0, 4).map((i) => i.id), id)!;
    const s = run(items, plan.ops);
    const week = s.list().find((it): it is WeekItem => it.type === "week")!;
    return { s, week, loose, items };
  }

  it("knows which column a point is over", () => {
    const { week } = tidied();
    expect(columnAt(week, 1, week.x, week.y)).toBe(0);
    expect(columnAt(week, 1, week.x + PITCH_X * 2 + 60, week.y + 40)).toBe(2);
    expect(columnAt(week, 1, week.x + PITCH_X * 2, week.y - 150)).toBe(2);
    expect(columnAt(week, 1, week.x - PITCH_X, week.y)).toBeNull();
    expect(columnAt(week, 1, week.x, week.y + PITCH_Y * 3)).toBeNull();
  });

  it("gives a note dropped into a column that day, and slots it in", () => {
    const { s, week, loose } = tidied();
    s.apply({ op: "patch", id: loose.id, set: { x: week.x + PITCH_X * 4 + 30, y: week.y + 20 } });
    const ops = planDrop(s.list(), [loose.id], [], id);
    for (const op of ops) s.apply(op);
    const after = s.items.get(loose.id) as NoteItem;
    expect(after.day).toBe(4);
    expect(after.x).toBe(week.x + PITCH_X * 4);
    expect(after.y).toBe(week.y);
  });

  it("moves a note to another day when dragged across, leaving no gap", () => {
    const { s, week, items } = tidied();
    const band = items[3];
    s.apply({ op: "patch", id: band.id, set: { x: week.x + PITCH_X * 6 - 20, y: week.y + 10 } });
    for (const op of planDrop(s.list(), [band.id], [band.id], id)) s.apply(op);
    const after = s.items.get(band.id) as NoteItem;
    expect(noteDay(after)).toBe(6);
    expect(after.x).toBe(week.x + PITCH_X * 6);
  });

  it("does not touch a note's day when it is dropped on its own day", () => {
    const { s, week, items } = tidied();
    const band = items[3];
    s.apply({ op: "patch", id: band.id, set: { x: week.x + PITCH_X * 5 + 15, y: week.y + 15 } });
    const ops = planDrop(s.list(), [band.id], [band.id], id);
    expect(ops.some((op) => op.op === "patch" && "day" in op.set)).toBe(false);
  });

  it("leaves notes dropped elsewhere alone", () => {
    const { s, loose } = tidied();
    s.apply({ op: "patch", id: loose.id, set: { x: 5000, y: 5000 } });
    expect(planDrop(s.list(), [loose.id], [], id)).toEqual([]);
  });
});

describe("a date of its own", () => {
  const weekOf = META.weekOf;
  const weeks = (s: BoardState) => s.list().filter((it): it is WeekItem => it.type === "week").sort((a, b) => a.y - b.y);

  it("wins over the board's week, and reads as that date", () => {
    const n = note("Taste test Sat", 0, 0, { date: "2026-11-19", time: 960 });
    expect(noteDay(n)).toBe(3);
    expect(noteDate(n, weekOf)).toBe("2026-11-19");
    expect(noteWeek(n, weekOf)).toBe("2026-11-16");
    expect(whenLabel(n, weekOf)).toBe("THU 19 NOV · 16:00");
    expect(whenLabel(note("Flyers Wed"), weekOf)).toBe("WED 25");
    expect(noteDate(note("Flyers Wed", 0, 0, { date: "" }), weekOf)).toBe("2026-11-25");
  });

  it("gives each week its own band, earlier weeks above", () => {
    const today = note("Call the printer", 0, 0, { date: "2026-11-19" });
    const wed = note("Flyers out Wed", 300, 0);
    const later = note("Review", 600, 0, { date: "2026-12-03", time: 600 });
    const anyDay = note("Fix the sign", 900, 0);
    const plan = planTidy([today, wed, later, anyDay], null, id, weekOf)!;
    expect(plan.fx.weeks).toHaveLength(3);
    const s = run([today, wed, later, anyDay], plan.ops);
    const [w1, w2, w3] = weeks(s);
    expect([w1.of, w2.of ?? "", w3.of]).toEqual(["2026-11-16", "", "2026-11-30"]);
    expect([w1.cols, w2.cols, w3.cols]).toEqual([7, 8, 7]);
    const at = (n: NoteItem) => s.items.get(n.id)!;
    expect(at(today).y).toBe(w1.y);
    expect(Math.round((at(today).x - w1.x) / PITCH_X)).toBe(3);
    expect(at(wed).y).toBe(w2.y);
    expect(Math.round((at(anyDay).x - w2.x) / PITCH_X)).toBe(7);
    expect(at(later).y).toBe(w3.y);
    expect(Math.round((at(later).x - w3.x) / PITCH_X)).toBe(3);
    expect(w2.y - w1.y).toBeGreaterThan(200 + 132 + 20);
  });

  it("drops a week that is left empty, and keeps the rest where they are", () => {
    const today = note("Call the printer", 0, 0, { date: "2026-11-19" });
    const wed = note("Flyers out Wed", 300, 0);
    const s = run([today, wed], planTidy([today, wed], null, id, weekOf)!.ops);
    const before = weeks(s);
    s.apply({ op: "patch", id: today.id, set: { date: "", day: 4 } });
    const again = planTidy(s.list(), null, id, weekOf)!;
    expect(again.ops.filter((op) => op.op === "del").map((op) => (op as { id: string }).id)).toEqual([before[0].id]);
    for (const op of again.ops) s.apply(op);
    expect(weeks(s)).toHaveLength(1);
    expect(weeks(s)[0].id).toBe(before[1].id);
  });

  it("dropping into another week's column gives the note that date", () => {
    const today = note("Call the printer", 0, 0, { date: "2026-11-19" });
    const wed = note("Flyers out Wed", 300, 0);
    const fri = note("Sign Fri", 600, 0);
    const s = run([today, wed, fri], planTidy([today, wed, fri], null, id, weekOf)!.ops);
    s.apply({ op: "patch", id: wed.id, set: { x: weeks(s)[0].x + PITCH_X * 5 + 10, y: weeks(s)[0].y + 20 } });
    for (const op of planDrop(s.list(), [wed.id], [wed.id], id, weekOf)) s.apply(op);
    expect((s.items.get(wed.id) as NoteItem).date).toBe("2026-11-21");
    const boardWeek = weeks(s)[1];
    s.apply({ op: "patch", id: today.id, set: { x: boardWeek.x + PITCH_X, y: boardWeek.y + 10 } });
    for (const op of planDrop(s.list(), [today.id], [today.id], id, weekOf)) s.apply(op);
    expect(s.items.get(today.id)).toMatchObject({ day: 1, date: "" });
  });

  it("survives the checks, and a name tag too", () => {
    const n = cleanItem({ id: "n1", type: "note", x: 0, y: 0, text: "x", date: "2026-11-19", who: "  Ana   Lee ", color: "#FFB38A" });
    expect(n).toMatchObject({ date: "2026-11-19", who: "Ana Lee" });
    expect(cleanItem({ id: "n2", type: "note", x: 0, y: 0, text: "x", date: "2026-13-40" })).not.toHaveProperty("date");
    expect(cleanOp({ op: "patch", id: "n1", set: { date: "", who: "" } }, () => "note")).toEqual({ op: "patch", id: "n1", set: { date: "", who: "" } });
    expect(cleanItem({ id: "w1", type: "week", x: 0, y: 0, cols: 7, of: "2026-11-16" })).toMatchObject({ of: "2026-11-16" });
  });

  it("knows whose a note is", () => {
    expect(isFor({ text: "Flyers", who: "Ana" }, "ana")).toBe(true);
    expect(isFor({ text: "Ask @Ana about it" }, "Ana")).toBe(true);
    expect(isFor({ text: "Ask @Anabel about it" }, "Ana")).toBe(false);
    expect(isFor({ text: "Flyers", who: "Bo" }, "Ana")).toBe(false);
  });
});
