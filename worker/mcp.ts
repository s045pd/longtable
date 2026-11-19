// A board as an MCP server, so an AI assistant (Claude, ChatGPT, Cursor or
// anything else that speaks the Model Context Protocol) can plan on it: read
// the week, add notes with their dates, times and people, change and remove
// them, tidy up, hand out the calendar, and draw the week as a picture.
//
// Streamable HTTP without sessions: every request is a JSON-RPC POST and is
// answered with JSON. The board's own MCP key, in the address, lets the
// assistant in; it can change the board like the edit link, and new links or
// a new password switch it off.
import { ANY, DAY_NAMES, FROM_WORDS, ISO_DATE, NO_TIME, findTime, formatTime, isoDate, parseIso } from "../src/shared/days";
import { PALETTE } from "../src/shared/colors";
import { boardTitle, toMarkdown, weekEntries } from "../src/shared/exporter";
import { NOTE, bounds, union } from "../src/shared/geometry";
import { randomId } from "../src/shared/ids";
import { LIMITS } from "../src/shared/schema";
import { planTidy, weeksOn } from "../src/shared/tidy";
import type { CheckItem, Effect, Item, LabelItem, Meta, NoteItem, Op } from "../src/shared/types";

/** What the MCP server needs from the board's room. */
export interface McpBoard {
  id: string;
  /** This Longtable's address, for links. */
  origin: string;
  meta(): Meta;
  items(): Item[];
  /** The calendar feed's key. */
  cal: string;
  /** Apply changes as the assistant; everyone with the board open sees them. Returns what was applied. */
  commit(ops: Op[], fx?: Effect): Op[];
  /** The week as a PNG (base64), or why there is none. */
  picture(who: string): Promise<{ ok: true; png: string } | { ok: false; why: "off" | "busy" | "failed"; wait?: number }>;
}

/** Protocol versions this server speaks; it answers in the client's when it can. */
export const MCP_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const VERSION = "0.1.0";
/** The most notes one call may add. */
const ADD_MAX = 40;
/** Who notes added over MCP are by. */
const BY = "AI";

const INSTRUCTIONS = `This is one Longtable board: a shared planning board of sticky notes that a team edits live. Notes are tasks or events; each can have a date (YYYY-MM-DD), a time (HH:MM, 24-hour) and who it is for (a first name, shown as a tag on the note). The board has a week of its own (weekOf, a Monday): a note that names only a weekday falls in that week, while a note with a date of its own goes in its date's week, so this week's and next week's plans can sit on one board. Read the board first (read_board) to see the notes, their ids and the dates. Always give real dates: work out "tomorrow", "next Wednesday" and so on from today's date. Add notes with add_notes; they are tidied into day columns for everyone watching. Write notes the way people do: short, in the language they were asked in, without the date, time or name in the words (those go in their own fields).`;

type Json = Record<string, unknown>;
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

const WHO = { type: "string", description: "Only the notes for this person (tagged with the name, or saying “@name”). Leave out for everyone's." };

export const TOOLS: Tool[] = [
  {
    name: "read_board",
    title: "Read the board",
    description:
      "The board's title, its week, today's date, and every note with its id, date, weekday, time and who it is for, in date order; then the checklists and headings. Use it before changing anything, to find the ids.",
    inputSchema: { type: "object", properties: { who: WHO }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "week_as_text",
    title: "The week as text",
    description: "The plan as a Markdown checklist, a heading for each day, ready to paste into a chat or a document.",
    inputSchema: { type: "object", properties: { who: WHO }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "week_picture",
    title: "The week as a picture",
    description: "Draws the week as a PNG: a row of day columns for each week, every note as a card with its time and name tag, and the board's photos and checklists underneath. Show it to the user or pass it on.",
    inputSchema: { type: "object", properties: { who: WHO }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "add_notes",
    title: "Add notes",
    description:
      "Adds notes to the board, one per task or event, and (unless tidy is false) tidies them into their days for everyone watching. Give each note a real date when it has one. Keep the words short and leave the date, time and name out of them.",
    inputSchema: {
      type: "object",
      properties: {
        notes: {
          type: "array",
          minItems: 1,
          maxItems: ADD_MAX,
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "What to do, in a few words." },
              date: { type: "string", description: "The day, YYYY-MM-DD." },
              time: { type: "string", description: "The time, HH:MM (24-hour)." },
              who: { type: "string", description: "Who it is for: a name." },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
        tidy: { type: "boolean", description: "Tidy the new notes into their days (default true)." },
      },
      required: ["notes"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "update_note",
    title: "Change a note",
    description:
      "Changes a note's words, date, time or who it is for. An empty string clears that field: no date of its own (the note goes back to the weekday its words name, if any), no time, nobody in particular. A note that moves day moves column too.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The note's id, from read_board." },
        text: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD, or \"\" to clear." },
        time: { type: "string", description: "HH:MM (24-hour), or \"\" for no time." },
        who: { type: "string", description: "A name, or \"\" for nobody in particular." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "delete_notes",
    title: "Remove notes",
    description: "Removes notes from the board. The people on the board can undo it only by writing them again, so check the ids with read_board first.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 } },
      required: ["ids"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "tidy_up",
    title: "Tidy up the board",
    description: "Sorts every note into the column of its day, a row of columns for each week, and lines up everything else underneath. Everyone with the board open sees the notes fly into place.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "calendar_link",
    title: "Calendar subscription",
    description:
      "Links that subscribe Google Calendar, Apple Calendar or Outlook to the board (or to one person's notes), so the plan shows up in their calendar and follows every change.",
    inputSchema: {
      type: "object",
      properties: { who: WHO, tz: { type: "string", description: "An IANA time zone for the times, such as Europe/London or Asia/Shanghai." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

// ------------------------------------------------------------- JSON-RPC
interface Rpc {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });

const text = (t: string) => ({ type: "text", text: t });
const failed = (t: string) => ({ content: [text(t)], isError: true });
const ok = (t: string, structured?: Json) => ({ content: [text(t)], ...(structured ? { structuredContent: structured } : {}) });

/** One JSON-RPC message in, its answer out (null for a notification). */
export async function answer(msg: Rpc, board: McpBoard): Promise<object | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return rpcError(null, -32600, "Invalid request");
  // A response from the client (we never ask it anything): nothing to say.
  if (msg.method === undefined && ("result" in msg || "error" in msg)) return null;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg.id, -32600, "Invalid request");
  const note = msg.id === undefined;
  const id = msg.id;
  if (!note && typeof id !== "string" && typeof id !== "number") return rpcError(null, -32600, "Invalid request id");
  const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Json;
  let out: object | null;
  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      out = rpcResult(id, {
        protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "longtable", title: `Longtable · ${boardTitle(board.meta())}`, version: VERSION },
        instructions: INSTRUCTIONS,
      });
      break;
    }
    case "ping":
      out = rpcResult(id, {});
      break;
    case "tools/list":
      out = rpcResult(id, { tools: TOOLS });
      break;
    case "tools/call": {
      const name = params.name;
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Json) : {};
      if (typeof name !== "string" || !TOOLS.some((t) => t.name === name)) {
        out = rpcError(id, -32602, `No tool called ${String(name)}`);
        break;
      }
      try {
        out = rpcResult(id, await callTool(name, args, board));
      } catch (e) {
        out = rpcResult(id, failed(e instanceof Problem ? e.message : "Something went wrong on the board. Try again."));
        if (!(e instanceof Problem)) console.warn("mcp: tool failed:", name, String((e as Error)?.message ?? e).slice(0, 200));
      }
      break;
    }
    case "resources/list":
      out = rpcResult(id, { resources: [] });
      break;
    case "resources/templates/list":
      out = rpcResult(id, { resourceTemplates: [] });
      break;
    case "prompts/list":
      out = rpcResult(id, { prompts: [] });
      break;
    default:
      out = msg.method.startsWith("notifications/") ? null : rpcError(id, -32601, `Unknown method ${msg.method}`);
  }
  return note ? null : out;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-protocol-version",
  "access-control-max-age": "86400",
};
const HEADERS = { ...CORS, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
/** The most a request may carry. */
const MAX_BODY = 256 * 1024;

/** The answer to a browser-based client's preflight. */
export const preflight = () => new Response(null, { status: 204, headers: CORS });

export const mcpResponse = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...HEADERS, ...(body === null ? {} : { "content-type": "application/json; charset=utf-8" }) } });

/** An HTTP request to the board's MCP address, answered. */
export async function handleMcp(request: Request, board: McpBoard): Promise<Response> {
  if (request.method === "OPTIONS") return preflight();
  // No server-to-client stream and no sessions: the answer to every request comes back with it.
  if (request.method !== "POST") return new Response("Send MCP requests as POST.\n", { status: 405, headers: { ...HEADERS, allow: "POST, OPTIONS" } });
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return mcpResponse(rpcError(null, -32700, "Send JSON (content-type: application/json)"), 415);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return mcpResponse(rpcError(null, -32600, "Request too large"), 413);
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return mcpResponse(rpcError(null, -32700, "Parse error"), 400);
  }
  if (Array.isArray(msg)) {
    if (!msg.length) return mcpResponse(rpcError(null, -32600, "Empty batch"), 400);
    const out: object[] = [];
    for (const m of msg.slice(0, 20)) {
      const a = await answer(m as Rpc, board);
      if (a) out.push(a);
    }
    return out.length ? mcpResponse(out) : mcpResponse(null, 202);
  }
  const a = await answer(msg as Rpc, board);
  return a ? mcpResponse(a) : mcpResponse(null, 202);
}

// ----------------------------------------------------------------- tools
/** A mistake in what the assistant asked for, told back to it in words. */
class Problem extends Error {}

function str(v: unknown, field: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Problem(`${field} should be a string.`);
  return v.slice(0, max);
}

const cleanWho = (v: string) => v.replace(/^@/, "").replace(/\s+/g, " ").trim().slice(0, LIMITS.name);

function cleanDate(v: string, field = "date"): string {
  const d = v.trim();
  if (!ISO_DATE.test(d) || isoDate(parseIso(d)) !== d) throw new Problem(`${field} should be a real date like 2026-11-25, not “${v}”.`);
  return d;
}

function cleanTime(v: string): number {
  const t = v.trim();
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const read = findTime(t);
  if (read === null) throw new Problem(`time should look like 16:00, not “${v}”.`);
  return read;
}

const hash = (s: string) => [...s.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const colorFor = (who: string) => (who ? PALETTE[hash(who) % PALETTE.length] : "#FFE38A");
const newId = () => randomId(12);

function when(e: { date: string | null; day: number | null; time: number | null }) {
  const day = e.day === null ? null : e.day === ANY ? "any day" : DAY_NAMES[e.day];
  return { date: e.date, weekday: day, time: e.time === null ? null : formatTime(e.time) };
}

/** The board as the assistant reads it. */
export function readBoard(board: McpBoard, who: string, today = new Date()) {
  const meta = board.meta();
  const items = board.items();
  const notes = weekEntries(items, meta.weekOf, who ? { who } : {}).map((e) => ({
    id: e.id,
    text: e.text,
    ...when(e),
    who: e.who || null,
    by: e.by || null,
    ...(e.votes ? { votes: e.votes } : {}),
  }));
  const checklists = items
    .filter((it): it is CheckItem => it.type === "check")
    .map((c) => ({ id: c.id, title: c.title, rows: c.rows.map((r) => ({ text: r.text, done: r.done })) }));
  const headings = items.filter((it): it is LabelItem => it.type === "label").map((l) => l.text);
  return {
    board: boardTitle(meta),
    weekOf: meta.weekOf || null,
    today: today.toISOString().slice(0, 10),
    ...(who ? { onlyFor: who } : {}),
    notes,
    ...(checklists.length ? { checklists } : {}),
    ...(headings.length ? { headings } : {}),
    weeksLaidOut: weeksOn(items).length,
    link: `${board.origin}/b/${board.id}`,
  };
}

/** Changes to the board, with the tidy laid over them when asked. */
function withTidy(board: McpBoard, ops: Op[], targets: string[] | null): { ops: Op[]; fx?: Effect } {
  const after = new Map(board.items().map((it) => [it.id, it]));
  for (const op of ops) {
    if (op.op === "put") after.set(op.item.id, op.item);
    else if (op.op === "patch" && after.has(op.id)) after.set(op.id, { ...after.get(op.id)!, ...op.set } as Item);
    else if (op.op === "del") after.delete(op.id);
  }
  const plan = planTidy([...after.values()], targets, newId, board.meta().weekOf);
  return plan ? { ops: [...ops, ...plan.ops], fx: plan.fx } : { ops };
}

export async function callTool(name: string, args: Json, board: McpBoard): Promise<object> {
  const who = cleanWho(str(args.who, "who", 64) ?? "");
  const meta = board.meta();
  switch (name) {
    case "read_board": {
      const read = readBoard(board, who);
      return ok(JSON.stringify(read, null, 1), read);
    }

    case "week_as_text":
      return ok(toMarkdown(meta, board.items(), who ? { who } : {}));

    case "week_picture": {
      const pic = await board.picture(who);
      if (pic.ok) {
        const n = weekEntries(board.items(), meta.weekOf, who ? { who } : {}).filter((e) => e.date || e.day !== null).length;
        return { content: [{ type: "image", data: pic.png, mimeType: "image/png" }, text(`${boardTitle(meta)}${who ? ` · ${who}` : ""}: ${n} note${n === 1 ? "" : "s"} by day.`)] };
      }
      const why =
        pic.why === "off"
          ? "This Longtable can’t draw pictures: it needs Cloudflare Browser Rendering (see DEPLOY.md). Here is the week as text instead."
          : pic.why === "busy"
            ? `No picture right now (too many lately); try again ${(pic.wait ?? 60) <= 60 ? "in a minute" : `in ${Math.ceil((pic.wait ?? 60) / 60)} minutes`}. Here is the week as text instead.`
            : "The picture didn’t work this time. Here is the week as text instead.";
      return { content: [text(why), text(toMarkdown(meta, board.items(), who ? { who } : {}))], isError: pic.why !== "off" };
    }

    case "calendar_link": {
      const tz = str(args.tz, "tz", 40)?.trim();
      const q = new URLSearchParams();
      if (tz) q.set("tz", tz);
      if (who) q.set("who", who);
      const feed = `${board.origin}/api/boards/${board.id}/cal/${board.cal}.ics${q.size ? `?${q}` : ""}`;
      const webcal = feed.replace(/^https?:/, "webcal:");
      const links = {
        feed,
        apple: webcal,
        google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
        outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=${encodeURIComponent(`${boardTitle(meta)}${who ? ` · ${who}` : ""}`)}`,
      };
      return ok(
        [
          `Subscribe once and the calendar follows the board${who ? ` (only ${who}’s notes)` : ""}:`,
          `- Google Calendar: ${links.google}`,
          `- Apple Calendar: ${links.apple}`,
          `- Outlook: ${links.outlook}`,
          `- Any other calendar app (subscribe by URL): ${links.feed}`,
          "",
          "Anyone with these links can read the notes that name a day. Calendars check for changes on their own clock: Apple and Outlook within hours, Google sometimes once a day.",
        ].join("\n"),
        links,
      );
    }

    case "add_notes": {
      if (!Array.isArray(args.notes) || !args.notes.length) throw new Problem("notes should be a list of at least one note.");
      if (args.notes.length > ADD_MAX) throw new Problem(`At most ${ADD_MAX} notes at a time.`);
      const items = board.items();
      if (items.length + args.notes.length > LIMITS.items) throw new Problem("The board is full.");
      const box = union(items.map(bounds));
      const left = box ? Math.round(box.x0 + NOTE / 2) : 0;
      const top = box ? Math.round(box.y1 + 160 + NOTE / 2) : 0;
      let z = Math.max(0, ...items.map((it) => it.z));
      const puts: Op[] = args.notes.map((raw, i) => {
        if (!raw || typeof raw !== "object") throw new Problem(`Note ${i + 1} should be an object with a text.`);
        const n = raw as Json;
        const words = (str(n.text, `notes[${i}].text`, 400) ?? "").trim();
        if (!words) throw new Problem(`Note ${i + 1} has no text.`);
        const date = str(n.date, "date", 20)?.trim();
        const time = str(n.time, "time", 20)?.trim();
        const name = cleanWho(str(n.who, "who", 64) ?? "");
        const item: NoteItem = {
          id: newId(),
          type: "note",
          x: left + (i % 6) * 232,
          y: top + Math.floor(i / 6) * 224,
          rot: 0,
          z: ++z,
          by: BY,
          color: colorFor(name),
          text: words,
          ...(date ? { date: cleanDate(date, `Note ${i + 1}'s date`) } : {}),
          ...(time ? { time: cleanTime(time) } : {}),
          ...(name ? { who: name } : {}),
        };
        return { op: "put", item };
      });
      const ids = puts.map((op) => (op.op === "put" ? op.item.id : ""));
      const tidy = args.tidy !== false;
      const change = tidy ? withTidy(board, puts, ids) : { ops: puts };
      board.commit(change.ops, change.fx);
      const after = new Map(board.items().map((it) => [it.id, it]));
      const added = weekEntries(ids.map((id) => after.get(id)).filter((it): it is Item => !!it), board.meta().weekOf).map((e) => ({ id: e.id, text: e.text, ...when(e), who: e.who || null }));
      return ok(`Added ${added.length} note${added.length === 1 ? "" : "s"}${tidy ? ", tidied into their days" : ""}:\n${JSON.stringify(added, null, 1)}`, { added });
    }

    case "update_note": {
      const id = str(args.id, "id", 40) ?? "";
      const note = board.items().find((it): it is NoteItem => it.id === id && it.type === "note");
      if (!note) throw new Problem(`No note with the id “${id}”. Use read_board for the ids.`);
      const set: Partial<NoteItem> = {};
      const words = str(args.text, "text", 400);
      if (words !== undefined) {
        if (!words.trim()) throw new Problem("A note needs some words; use delete_notes to remove it.");
        set.text = words.trim();
      }
      const date = str(args.date, "date", 20);
      if (date !== undefined) Object.assign(set, date.trim() ? { date: cleanDate(date) } : { date: "", ...(note.day === ANY ? {} : { day: FROM_WORDS }) });
      const time = str(args.time, "time", 20);
      if (time !== undefined) set.time = time.trim() ? cleanTime(time) : NO_TIME;
      const name = str(args.who, "who", 64);
      if (name !== undefined) set.who = cleanWho(name);
      if (!Object.keys(set).length) throw new Problem("Nothing to change: give text, date, time or who.");
      const ops: Op[] = [{ op: "patch", id, set }];
      const moves = date !== undefined || time !== undefined;
      const change = moves && weeksOn(board.items()).length ? withTidy(board, ops, [id]) : { ops };
      board.commit(change.ops, change.fx);
      const now = board.items().find((it) => it.id === id) as NoteItem | undefined;
      const [e] = now ? weekEntries([now], board.meta().weekOf) : [];
      return ok(`Changed: ${JSON.stringify(e ? { id, text: e.text, ...when(e), who: e.who || null } : { id })}`);
    }

    case "delete_notes": {
      if (!Array.isArray(args.ids) || !args.ids.length) throw new Problem("ids should be a list of note ids.");
      const notes = new Set(board.items().filter((it) => it.type === "note").map((it) => it.id));
      const ids = [...new Set(args.ids.filter((x): x is string => typeof x === "string" && notes.has(x)))].slice(0, 100);
      if (!ids.length) throw new Problem("None of those ids is a note on this board. Use read_board for the ids.");
      const dels: Op[] = ids.map((id) => ({ op: "del", id }));
      // The weeks close up the gaps left behind.
      const change = weeksOn(board.items()).length ? withTidy(board, dels, []) : { ops: dels };
      board.commit(change.ops, change.fx);
      return ok(`Removed ${ids.length} note${ids.length === 1 ? "" : "s"}.`);
    }

    case "tidy_up": {
      const plan = planTidy(board.items(), null, newId, meta.weekOf);
      if (!plan) return ok("There are no notes to tidy.");
      board.commit(plan.ops, plan.fx);
      return ok(`Tidied ${plan.count} note${plan.count === 1 ? "" : "s"} into their days.`);
    }
  }
  throw new Problem(`No tool called ${name}.`);
}
