import { describe, expect, it } from "vitest";
import { attachFor, refit, stackOrder, withStrokes } from "../src/shared/attach";
import { BoardState } from "../src/shared/state";
import { planTidy } from "../src/shared/tidy";
import type { Item, NoteItem, StrokeItem } from "../src/shared/types";

const META = { client: "", file: "", weekOf: "2026-11-23", template: "" };
const note = (id: string, text: string, x: number, y: number, z = 1): NoteItem => ({ id, type: "note", x, y, rot: 0, z, color: "#FFE38A", text });
/** A stroke through these absolute points. */
const pen = (id: string, abs: [number, number][], extra: Partial<StrokeItem> = {}): StrokeItem => {
  const [ox, oy] = abs[0];
  return { id, type: "stroke", x: ox, y: oy, rot: 0, z: 9, color: "#9DF0C4", width: 6, pts: abs.flatMap(([x, y]) => [x - ox, y - oy]), ...extra };
};
const ring = (cx: number, cy: number, r: number, n = 24): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * 2 * Math.PI) * r, cy + Math.sin((i / n) * 2 * Math.PI) * r]);
const ends = (s: StrokeItem) => [s.x + s.pts[0], s.y + s.pts[1], s.x + s.pts.at(-2)!, s.y + s.pts.at(-1)!].map(Math.round);
function run(state: BoardState, ops: Parameters<typeof withStrokes>[1]) {
  for (const op of withStrokes(state.items, ops)) state.apply(op);
}

describe("strokes on cards", () => {
  const a = note("a", "Flyers Tue", 0, 0);
  const b = note("b", "Hand out Wed", 600, 0);
  const board = [a, b];

  it("knows what a stroke was drawn on", () => {
    // A tick on the note, a ring round it, an arrow from one to the other, a line off one, a doodle in the open.
    expect(attachFor(board, pen("s", [[-40, 10], [0, 40], [60, -30]]))).toEqual({ on: "a", from: "", to: "" });
    expect(attachFor(board, pen("s", ring(0, 0, 130)))).toEqual({ on: "a", from: "", to: "" });
    expect(attachFor(board, pen("s", [[60, 0], [300, -80], [540, 0]]))).toEqual({ on: "", from: "a", to: "b" });
    // An arrow whose head's barbs stop short of the card still points at it.
    const shaft: [number, number][] = Array.from({ length: 20 }, (_, i) => [60 + i * 25, -Math.sin((Math.PI * i) / 19) * 80]);
    expect(attachFor(board, pen("s", [...shaft, [520, -14], [535, 0], [470, 12]]))).toEqual({ on: "", from: "a", to: "b" });
    expect(attachFor(board, pen("s", [[90, 20], [300, 300]]))).toEqual({ on: "a", from: "", to: "" });
    expect(attachFor(board, pen("s", [[200, 400], [400, 420]]))).toEqual({ on: "", from: "", to: "" });
    // A ring much bigger than the card around it is not about that card.
    expect(attachFor(board, pen("s", ring(0, 0, 400))).on).toBe("");
  });

  it("moves, and goes, with its card", () => {
    const s = new BoardState(META, [a, b, pen("tick", [[-40, 10], [60, -30]], { on: "a" })]);
    run(s, [{ op: "patch", id: "a", set: { x: 100, y: 50 } }]);
    expect(ends(s.items.get("tick") as StrokeItem)).toEqual([60, 60, 160, 20]);
    run(s, [{ op: "del", id: "a" }]);
    expect(s.items.has("tick")).toBe(false);
  });

  it("keeps a line's ends on both cards as they move, shape and all", () => {
    const line = pen("arrow", [[60, 0], [300, -80], [540, 0]], { from: "a", to: "b" });
    const s = new BoardState(META, [a, b, line]);
    run(s, [{ op: "patch", id: "b", set: { x: 0, y: 600 } }]);
    const after = s.items.get("arrow") as StrokeItem;
    // Start stays on a; the end keeps its spot on b (60 px left of its centre).
    expect(ends(after)).toEqual([60, 0, -60, 600]);
    // Still as many points, the bow turned with it.
    expect(after.pts.length).toBe(line.pts.length);
    // Both moving the same way: it just moves.
    run(s, [{ op: "patch", id: "a", set: { x: 10, y: 10 } }, { op: "patch", id: "b", set: { x: 10, y: 610 } }]);
    expect(ends(s.items.get("arrow") as StrokeItem)).toEqual([70, 10, -50, 610]);
    // A card goes: so does the line.
    run(s, [{ op: "del", id: "b" }]);
    expect(s.items.has("arrow")).toBe(false);
  });

  it("leaves strokes the change already moves to it", () => {
    const s = new BoardState(META, [a, pen("tick", [[0, 0], [20, 20]], { on: "a" })]);
    const ops = withStrokes(s.items, [
      { op: "patch", id: "a", set: { x: 50 } },
      { op: "patch", id: "tick", set: { x: 999 } },
    ]);
    expect(ops).toHaveLength(2);
  });

  it("refits about the ends without drifting when the cards come back", () => {
    const line = pen("l", [[0, 0], [100, -40], [200, 0]]);
    const there = refit(line, { x: 0, y: 0 }, { x: -200, y: 200 });
    const back = refit({ ...line, ...there }, { x: 0, y: 0 }, { x: 200, y: -200 });
    expect(ends({ ...line, ...back })).toEqual(ends(line));
  });

  it("stacks what is drawn on a card right after it when lifting", () => {
    const s = new BoardState(META, [{ ...a, z: 5 }, { ...b, z: 1 }, pen("tick", [[0, 0], [5, 5]], { on: "a", z: 2 })]);
    expect(stackOrder(s.items, ["a", "b", "tick"]).map((it) => it.id)).toEqual(["b", "a", "tick"]);
  });

  it("goes with the cards through a tidy instead of into the line-up", () => {
    const items: Item[] = [
      note("t", "Flyers to print Tue", 0, 0),
      note("w", "Flyers out Wed", 900, 500),
      pen("ring", ring(0, 0, 125), { on: "t" }),
      pen("arrow", [[60, 0], [500, 300], [860, 500]], { from: "t", to: "w" }),
      pen("doodle", [[2000, 2000], [2100, 2050]]),
    ];
    const s = new BoardState(META, items);
    const plan = planTidy(s.list(), null, () => "wk", META.weekOf)!;
    run(s, plan.ops);
    const t = s.items.get("t")!;
    const w = s.items.get("w")!;
    const r = s.items.get("ring") as StrokeItem;
    // The ring sits round the note where it landed.
    expect([r.x - t.x, r.y - t.y]).toEqual([125, 0]);
    // The arrow still runs from Tuesday's note to Wednesday's.
    expect(ends(s.items.get("arrow") as StrokeItem)).toEqual([t.x + 60, t.y, w.x - 40, w.y]);
    // The doodle lines up under the week, as before.
    const d = s.items.get("doodle")!;
    expect(d.y).toBeGreaterThan(t.y + 100);
  });
});
