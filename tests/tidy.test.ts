import { describe, expect, it } from "vitest";
import { BoardState } from "../src/shared/state";
import { makeTemplate } from "../src/shared/templates";
import { planTidy, waveDelay } from "../src/shared/tidy";
import { PITCH_X, PITCH_Y } from "../src/shared/geometry";
import type { Item, NoteItem } from "../src/shared/types";

let n = 0;
const id = () => `t${++n}`;
const note = (text: string, x = 0, y = 0): NoteItem => ({ id: id(), type: "note", x, y, rot: 3, z: n, color: "#FFE38A", text });

function apply(items: Item[], plan: NonNullable<ReturnType<typeof planTidy>>) {
  const s = new BoardState({ client: "", file: "", weekOf: "", template: "" }, items);
  for (const op of plan.ops) s.apply(op);
  return s;
}

describe("planTidy", () => {
  it("puts every example note in the column of its day", () => {
    const seed = makeTemplate("pell-and-rye", new Date(2026, 10, 18));
    const plan = planTidy(seed.items, null, id)!;
    const s = apply(seed.items, plan);
    const week = s.list().find((it) => it.type === "week")!;
    expect(week.type === "week" && week.cols).toBe(7);
    const notes = s.list().filter((it): it is NoteItem => it.type === "note");
    expect(plan.count).toBe(notes.length);
    for (const n of notes) {
      const col = Math.round((n.x - week.x) / PITCH_X);
      const row = (n.y - week.y) / PITCH_Y;
      expect(Number.isInteger(row)).toBe(true);
      expect(n.rot).toBe(0);
      const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][col];
      expect(n.text.toLowerCase()).toContain(day.toLowerCase());
    }
  });

  it("orders a day: no time first, then by time", () => {
    const items = [note("Taste Thu 4 pm", 0, 0), note("Aprons Thu", 300, 0), note("Bake Thu 6 am", 600, 0)];
    const s = apply(items, planTidy(items, null, id)!);
    const byRow = s.list().filter((it): it is NoteItem => it.type === "note").sort((a, b) => a.y - b.y).map((n) => n.text);
    expect(byRow).toEqual(["Aprons Thu", "Bake Thu 6 am", "Taste Thu 4 pm"]);
  });

  it("adds an ANY DAY column for notes without a day", () => {
    const items = [note("Fix the sign"), note("Hire Sat")];
    const plan = planTidy(items, null, id)!;
    const s = apply(items, plan);
    const week = s.list().find((it) => it.type === "week");
    expect(week && week.type === "week" && week.cols).toBe(8);
    const sign = s.list().find((it) => it.type === "note" && it.text === "Fix the sign")!;
    expect(Math.round((sign.x - week!.x) / PITCH_X)).toBe(7);
  });

  it("runs the wave left to right, then down", () => {
    expect(waveDelay(1, 0)).toBeGreaterThan(waveDelay(0, 0));
    expect(waveDelay(0, 1)).toBeGreaterThan(waveDelay(0, 0));
    const items = [note("a Mon"), note("b Sun")];
    const plan = planTidy(items, null, id)!;
    expect(plan.fx.delays[items[1].id]).toBeGreaterThan(plan.fx.delays[items[0].id]);
  });

  it("reuses an existing week and re-sorts what is already in it", () => {
    const items = [note("Mon one", 0, 0), note("Tue one", 300, 0)];
    const first = apply(items, planTidy(items, null, id)!);
    const week = first.list().find((it) => it.type === "week")!;
    const extra = note("Mon zero 5 am", 2000, 2000);
    const board = [...first.list(), extra];
    const plan = planTidy(board, [extra.id], id)!;
    expect(plan.ops.some((op) => op.op === "put")).toBe(false);
    const s = apply(board, plan);
    const mon = s.list().filter((it): it is NoteItem => it.type === "note" && it.text.startsWith("Mon")).sort((a, b) => a.y - b.y);
    expect(mon.map((n) => n.text)).toEqual(["Mon one", "Mon zero 5 am"]);
    expect(mon.every((n) => n.x === week.x)).toBe(true);
  });

  it("puts a partial tidy's new week under the board, clear of the rest", () => {
    const keep = note("Stays put Mon", 0, 0);
    const go = note("Moves Tue", 400, 0);
    const plan = planTidy([keep, go], [go.id], id)!;
    const s = apply([keep, go], plan);
    expect(s.items.get(keep.id)).toEqual(keep);
    expect(s.items.get(go.id)!.y).toBeGreaterThan(keep.y + 200);
  });

  it("lines the other things up under the week", () => {
    const seed = makeTemplate("pell-and-rye");
    const s = apply(seed.items, planTidy(seed.items, null, id)!);
    const lowestNote = Math.max(...s.list().filter((it) => it.type === "note").map((it) => it.y));
    for (const it of s.list()) if (it.type === "photo" || it.type === "check") expect(it.y).toBeGreaterThan(lowestNote);
  });

  it("returns nothing when there is no note", () => {
    expect(planTidy([], null, id)).toBeNull();
  });
});
