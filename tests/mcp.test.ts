import { describe, expect, it } from "vitest";
import { cleanEffect, cleanOp } from "../src/shared/schema";
import { BoardState } from "../src/shared/state";
import type { Effect, Item, NoteItem, Op } from "../src/shared/types";
import { MCP_VERSIONS, TOOLS, answer, handleMcp, type McpBoard } from "../worker/mcp";

const META = { client: "Pell & Rye", file: "Opening week", weekOf: "2026-11-23", template: "" };

/** A board the way the room gives it to the MCP server, with what it was sent. */
function fakeBoard(items: Item[] = [], picture: McpBoard["picture"] = async () => ({ ok: false, why: "off" })) {
  const state = new BoardState({ ...META }, items);
  const sent: { ops: Op[]; fx?: Effect }[] = [];
  const board: McpBoard = {
    id: "abcdefghij",
    origin: "https://longtable.example",
    cal: "c".repeat(26),
    meta: () => state.meta,
    items: () => state.list(),
    commit(ops, fx) {
      const applied: Op[] = [];
      for (const raw of ops) {
        const op = cleanOp(raw, state.typeOf);
        if (op && state.apply(op)) applied.push(op);
      }
      sent.push({ ops: applied, fx: cleanEffect(fx) });
      return applied;
    },
    picture,
  };
  return { state, sent, board };
}

let seq = 0;
const call = async (board: McpBoard, name: string, args: Record<string, unknown> = {}) => {
  const out = (await answer({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }, board)) as {
    result: { content: { type: string; text?: string; data?: string; mimeType?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  };
  return out.result;
};
const note = (id: string, text: string, extra: Partial<NoteItem> = {}): NoteItem => ({ id, type: "note", x: 0, y: 0, rot: 0, z: 1, color: "#FFE38A", text, ...extra });

describe("the MCP server", () => {
  it("introduces itself in the client's protocol version and lists its tools", async () => {
    const { board } = fakeBoard();
    const init = (await answer({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }, board)) as {
      result: { protocolVersion: string; capabilities: { tools: object }; serverInfo: { name: string }; instructions: string };
    };
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toBeTruthy();
    expect(init.result.serverInfo.name).toBe("longtable");
    expect(init.result.instructions).toMatch(/YYYY-MM-DD/);
    const odd = (await answer({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, board)) as { result: { protocolVersion: string } };
    expect(MCP_VERSIONS).toContain(odd.result.protocolVersion);
    const list = (await answer({ jsonrpc: "2.0", id: 3, method: "tools/list" }, board)) as { result: { tools: { name: string; inputSchema: { type: string } }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(list.result.tools.every((t) => t.inputSchema.type === "object")).toBe(true);
  });

  it("answers notifications with nothing, and unknown methods with an error", async () => {
    const { board } = fakeBoard();
    expect(await answer({ jsonrpc: "2.0", method: "notifications/initialized" }, board)).toBeNull();
    expect(await answer({ jsonrpc: "2.0", id: 9, method: "sampling/whatever" }, board)).toMatchObject({ error: { code: -32601 } });
    expect(await answer({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "drop_tables" } }, board)).toMatchObject({ error: { code: -32602 } });
    expect(await answer({ id: 11, method: "ping" }, board)).toMatchObject({ error: { code: -32600 } });
    expect(await answer({ jsonrpc: "2.0", id: 12, method: "ping" }, board)).toEqual({ jsonrpc: "2.0", id: 12, result: {} });
  });

  it("speaks HTTP: JSON in and out, 202 for a notification, 405 for a stream, CORS for browsers", async () => {
    const { board } = fakeBoard();
    const post = (body: unknown, type = "application/json") =>
      handleMcp(new Request("https://x/mcp", { method: "POST", headers: { "content-type": type, accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }), board);
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const batch = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }]);
    expect(((await batch.json()) as unknown[]).length).toBe(2);
    expect((await post("{", "text/plain")).status).toBe(415);
    expect((await handleMcp(new Request("https://x/mcp", { method: "GET" }), board)).status).toBe(405);
    expect((await handleMcp(new Request("https://x/mcp", { method: "OPTIONS" }), board)).status).toBe(204);
    const bad = await handleMcp(new Request("https://x/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" }), board);
    expect(bad.status).toBe(400);
  });

  it("reads the board: notes in date order with their ids, dates, times and people", async () => {
    const { board } = fakeBoard([
      note("n1", "Flyers out", { date: "2026-11-25", time: 480, who: "Cy" }),
      note("n2", "Call the printer", { date: "2026-11-19", who: "Ana" }),
      note("n3", "Count the till Sun"),
      note("n4", "Someday"),
    ]);
    const read = await call(board, "read_board");
    const notes = read.structuredContent!.notes as { id: string; date: string | null; weekday: string | null; time: string | null; who: string | null }[];
    expect(notes.map((n) => n.id)).toEqual(["n2", "n1", "n3", "n4"]);
    expect(notes[1]).toMatchObject({ date: "2026-11-25", weekday: "Wednesday", time: "08:00", who: "Cy" });
    expect(notes[2]).toMatchObject({ date: "2026-11-29", weekday: "Sunday", time: null, who: null });
    expect(notes[3]).toMatchObject({ date: null, weekday: null });
    expect(read.structuredContent).toMatchObject({ board: "Pell & Rye · Opening week", weekOf: "2026-11-23" });
    expect(JSON.parse(read.content[0].text!).notes).toHaveLength(4);
    const ana = await call(board, "read_board", { who: "Ana" });
    expect((ana.structuredContent!.notes as unknown[]).length).toBe(1);
    const text = await call(board, "week_as_text", { who: "Cy" });
    expect(text.content[0].text).toMatch(/Flyers out/);
    expect(text.content[0].text).not.toMatch(/printer/);
  });

  it("adds notes with real dates into weeks of their own, tidied for everyone", async () => {
    const { board, sent, state } = fakeBoard([note("old", "Oven check Mon 6 am")]);
    const out = await call(board, "add_notes", {
      notes: [
        { text: "Call the printer", date: "2026-11-19", who: "@Ana" },
        { text: "Flyers out", date: "2026-11-25", time: "08:00", who: "Cy" },
        { text: "试吃", date: "2026-11-19", time: "下午4点" },
      ],
    });
    expect(out.isError).toBeUndefined();
    const added = out.structuredContent!.added as { id: string; date: string; time: string | null; who: string | null }[];
    // Told back in date order.
    expect(added.map((a) => [a.date, a.time, a.who])).toEqual([
      ["2026-11-19", null, "Ana"],
      ["2026-11-19", "16:00", null],
      ["2026-11-25", "08:00", "Cy"],
    ]);
    // One change everyone sees, with the tidy's wave; two weeks: 16 Nov and the board's own.
    expect(sent).toHaveLength(1);
    expect(sent[0].fx?.kind).toBe("tidy");
    const weeks = state.list().filter((it) => it.type === "week");
    expect(weeks).toHaveLength(2);
    const notes = state.list().filter((it): it is NoteItem => it.type === "note");
    expect(notes.find((n) => n.text === "Call the printer")).toMatchObject({ who: "Ana", by: "AI", text: "Call the printer" });
    expect(notes.find((n) => n.text === "Call the printer")!.y).toBeLessThan(notes.find((n) => n.text === "Flyers out")!.y);
  });

  it("says what was wrong instead of guessing", async () => {
    const { board, sent } = fakeBoard();
    const bad = await call(board, "add_notes", { notes: [{ text: "Party", date: "next Friday" }] });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/real date/);
    expect((await call(board, "add_notes", { notes: [{ text: "Party", date: "2026-02-30" }] })).isError).toBe(true);
    expect((await call(board, "add_notes", { notes: [{ text: "Party", time: "teatime" }] })).isError).toBe(true);
    expect((await call(board, "add_notes", { notes: [] })).isError).toBe(true);
    expect((await call(board, "update_note", { id: "nope", text: "x" })).isError).toBe(true);
    expect((await call(board, "delete_notes", { ids: ["nope"] })).isError).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("changes, clears and removes notes, and the weeks follow", async () => {
    const { board, state } = fakeBoard();
    await call(board, "add_notes", { notes: [{ text: "Flyers out", date: "2026-11-25", time: "08:00", who: "Cy" }, { text: "Cake", date: "2026-11-24" }] });
    const [flyers, cake] = state.list().filter((it): it is NoteItem => it.type === "note");
    await call(board, "update_note", { id: flyers.id, date: "2026-11-19", time: "", who: "" });
    expect(state.items.get(flyers.id)).toMatchObject({ date: "2026-11-19", time: -2, who: "" });
    // 19 Nov has a week of its own above the board's.
    expect(state.list().filter((it) => it.type === "week")).toHaveLength(2);
    await call(board, "update_note", { id: flyers.id, date: "" });
    expect(state.items.get(flyers.id)).toMatchObject({ date: "" });
    await call(board, "delete_notes", { ids: [cake.id] });
    expect(state.items.has(cake.id)).toBe(false);
    const tidy = await call(board, "tidy_up");
    expect(tidy.content[0].text).toMatch(/Tidied 1 note/);
  });

  it("hands out the calendar, for everyone or one person", async () => {
    const { board } = fakeBoard();
    const all = await call(board, "calendar_link");
    expect(all.structuredContent!.feed).toBe(`https://longtable.example/api/boards/abcdefghij/cal/${"c".repeat(26)}.ics`);
    const cy = await call(board, "calendar_link", { who: "Cy", tz: "Asia/Shanghai" });
    expect(cy.structuredContent!.feed).toMatch(/\?tz=Asia%2FShanghai&who=Cy$/);
    expect(cy.structuredContent!.apple).toMatch(/^webcal:\/\//);
    expect(cy.structuredContent!.google).toMatch(/^https:\/\/calendar\.google\.com/);
  });

  it("returns the picture as an image, or the week as text when it can't draw", async () => {
    const off = fakeBoard([note("n1", "Flyers out Wed")]);
    const none = await call(off.board, "week_picture");
    expect(none.isError).toBe(false);
    expect(none.content[0].text).toMatch(/Browser Rendering/);
    expect(none.content[1].text).toMatch(/Flyers out/);
    let asked = "";
    const on = fakeBoard([note("n1", "Flyers out Wed", { who: "Cy" })], async (who) => {
      asked = who;
      return { ok: true, png: "iVBORw0KGgo=" };
    });
    const pic = await call(on.board, "week_picture", { who: "Cy" });
    expect(asked).toBe("Cy");
    expect(pic.content[0]).toEqual({ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" });
    expect(pic.content[1].text).toMatch(/1 note by day/);
  });
});
