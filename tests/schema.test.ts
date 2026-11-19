import { describe, expect, it } from "vitest";
import { cleanItem, cleanOp, cleanPresence, LIMITS } from "../src/shared/schema";
import { BoardState } from "../src/shared/state";

const typeOf = (known: Record<string, string>) => (id: string) => known[id] as never;

describe("cleanItem", () => {
  it("keeps a good note and fills defaults", () => {
    const it = cleanItem({ id: "abc", type: "note", x: 10, y: 20, text: "Hi Mon" });
    expect(it).toMatchObject({ id: "abc", type: "note", x: 10, y: 20, rot: 0, z: 0, text: "Hi Mon", color: "#FFE38A" });
  });
  it("drops what does not belong", () => {
    const it = cleanItem({ id: "abc", type: "note", x: 1, y: 2, text: "x", color: "red", evil: "<script>", rot: 400 }) as unknown as Record<string, unknown>;
    expect(it.evil).toBeUndefined();
    expect(it.color).toBe("#FFE38A");
    expect(it.rot).toBe(45);
  });
  it("refuses bad ids, types and positions", () => {
    expect(cleanItem({ id: "a b", type: "note", x: 0, y: 0 })).toBeNull();
    expect(cleanItem({ id: "ok", type: "iframe", x: 0, y: 0 })).toBeNull();
    expect(cleanItem({ id: "ok", type: "note", x: NaN, y: 0 })).toBeNull();
  });
  it("caps text", () => {
    const it = cleanItem({ id: "n", type: "note", x: 0, y: 0, text: "a".repeat(5000) });
    expect(it && it.type === "note" && it.text.length).toBe(LIMITS.text);
  });
});

describe("cleanOp", () => {
  it("only patches items that exist, with fields their type has", () => {
    const t = typeOf({ n1: "note" });
    expect(cleanOp({ op: "patch", id: "n1", set: { x: 5, pts: [1, 2] } }, t)).toEqual({ op: "patch", id: "n1", set: { x: 5 } });
    expect(cleanOp({ op: "patch", id: "nope", set: { x: 5 } }, t)).toBeNull();
    expect(cleanOp({ op: "patch", id: "n1", set: { id: "other", type: "label" } }, t)).toBeNull();
  });
  it("will not turn an item into another type", () => {
    const t = typeOf({ n1: "note" });
    expect(cleanOp({ op: "put", item: { id: "n1", type: "label", x: 0, y: 0 } }, t)).toBeNull();
  });
  it("votes only on notes", () => {
    const t = typeOf({ n1: "note", l1: "label" });
    expect(cleanOp({ op: "vote", id: "n1", who: "me", color: "#ffb38a", on: true }, t)).toEqual({ op: "vote", id: "n1", who: "me", color: "#FFB38A", on: true });
    expect(cleanOp({ op: "vote", id: "l1", who: "me", color: "#ffb38a", on: true }, t)).toBeNull();
  });
});

describe("cleanPresence", () => {
  it("rounds and clamps", () => {
    expect(cleanPresence({ c: [1.6, 2.4], view: [0, 0, 99], sel: ["a", "b c"] })).toEqual({ c: [2, 2], view: [0, 0, 8], sel: ["a"] });
  });
});

describe("BoardState", () => {
  it("undoes what it applies", () => {
    const s = new BoardState({ client: "", file: "", weekOf: "", template: "" });
    const ops = [
      { op: "put", item: { id: "a", type: "note", x: 0, y: 0, rot: 0, z: 1, color: "#FFE38A", text: "one" } },
      { op: "patch", id: "a", set: { x: 50, text: "two" } },
      { op: "vote", id: "a", who: "me", color: "#FFB38A", on: true },
      { op: "meta", set: { file: "Week" } },
    ] as const;
    const undo: unknown[] = [];
    for (const op of ops) {
      undo.unshift(...s.inverse(op as never));
      s.apply(op as never);
    }
    expect(s.items.get("a")).toMatchObject({ x: 50, text: "two", votes: { me: "#FFB38A" } });
    for (const op of undo) s.apply(op as never);
    expect(s.items.has("a")).toBe(false);
    expect(s.meta.file).toBe("");
  });
});
