// The week, out of the board: as text (Markdown), as a spreadsheet (CSV) and
// as a calendar (iCalendar). Notes are grouped by their date (a date of their
// own, or the board's week and the day picked or named in the words) and
// ordered like the tidy orders them; notes with a time become timed events,
// the rest all-day ones. Any of them can be narrowed to one person's notes.
import { DAY_NAMES, formatTime, isFor, noteDate, noteDay, noteTime, noteWho, parseIso } from "./days";
import type { CheckItem, Item, Meta, NoteItem } from "./types";

export interface WeekEntry {
  id: string;
  /** YYYY-MM-DD, or null for any day (or a weekday on a board with no week). */
  date: string | null;
  day: number | null;
  /** Minutes after midnight, or null for all day. */
  time: number | null;
  /** The note's words on one line. */
  text: string;
  /** Whose it is, or "". */
  who: string;
  by: string;
  votes: number;
}

/** What to export: everything, or only the notes for one person (by their tag, or an @mention). */
export interface ExportOptions {
  who?: string;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();

/** The items an export covers: with `who`, only that person's notes. */
export function itemsFor(items: Item[], opts: ExportOptions = {}): Item[] {
  const who = opts.who?.trim();
  return who ? items.filter((it) => it.type === "note" && isFor(it, who)) : items;
}

export function weekEntries(items: Item[], weekOf = "", opts: ExportOptions = {}): WeekEntry[] {
  const notes = itemsFor(items, opts).filter((it): it is NoteItem => it.type === "note" && it.text.trim() !== "");
  const entries = notes.map((n) => ({
    id: n.id,
    date: noteDate(n, weekOf),
    day: noteDay(n),
    time: noteTime(n),
    text: oneLine(n.text),
    who: noteWho(n),
    by: n.by ?? "",
    votes: Object.keys(n.votes ?? {}).length,
    y: n.y,
    x: n.x,
  }));
  const key = (e: { date: string | null; day: number | null }) => e.date ?? (e.day !== null ? `~${e.day}` : "~~");
  entries.sort((a, b) => {
    const da = key(a);
    const db = key(b);
    if (da !== db) return da < db ? -1 : 1;
    if (a.time === null && b.time !== null) return -1;
    if (b.time === null && a.time !== null) return 1;
    if (a.time !== null && b.time !== null && a.time !== b.time) return a.time - b.time;
    return Math.abs(a.y - b.y) > 60 ? a.y - b.y : a.x - b.x;
  });
  return entries.map(({ x: _x, y: _y, ...e }) => e);
}

const dayTitle = (iso: string) => {
  const d = parseIso(iso);
  return `${DAY_NAMES[(d.getDay() + 6) % 7]} ${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
};

export const boardTitle = (meta: Meta) => [meta.client, meta.file].filter((s) => s.trim()).join(" · ") || "Longtable board";

export function toMarkdown(meta: Meta, items: Item[], opts: ExportOptions = {}): string {
  const entries = weekEntries(items, meta.weekOf, opts);
  const who = opts.who?.trim();
  const out = [`# ${boardTitle(meta)}${who ? ` · ${who}` : ""}`, ""];
  if (meta.weekOf) out.push(`Week of ${dayTitle(meta.weekOf)}`, "");
  let heading = "";
  for (const e of entries) {
    const h = e.date ? dayTitle(e.date) : e.day !== null ? DAY_NAMES[e.day] : "Any day";
    if (h !== heading) {
      if (heading) out.push("");
      out.push(`## ${h}`);
      heading = h;
    }
    const tail = `${e.who && !who ? ` · ${e.who}` : ""}${e.votes ? ` (${e.votes} ${e.votes === 1 ? "vote" : "votes"})` : ""}`;
    out.push(`- [ ] ${e.time !== null ? `${formatTime(e.time)} ` : ""}${e.text}${tail}`);
  }
  if (heading) out.push("");
  const lists = who ? [] : items.filter((it): it is CheckItem => it.type === "check");
  for (const list of lists) {
    out.push(`## ${list.title || "Checklist"}`);
    for (const r of list.rows) out.push(`- [${r.done ? "x" : " "}] ${r.text}`);
    out.push("");
  }
  if (!entries.length && !lists.length) out.push(who ? `_Nothing for ${who} on the board yet._` : "_Nothing on the board yet._", "");
  return out.join("\n").trimEnd() + "\n";
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(meta: Meta, items: Item[], opts: ExportOptions = {}): string {
  const rows = [["day", "date", "time", "note", "who", "by", "votes"]];
  for (const e of weekEntries(items, meta.weekOf, opts)) {
    rows.push([e.day !== null ? DAY_NAMES[e.day] : "Any day", e.date ?? "", e.time !== null ? formatTime(e.time) : "", e.text, e.who, e.by, String(e.votes)]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const icsDate = (d: Date) => isoOf(d).replace(/-/g, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** Fold a content line at 75 octets, as RFC 5545 asks. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** For a calendar app that subscribes: how often to look again, and the time zone the times are in. */
export interface FeedOptions {
  /** An IANA time zone ("Asia/Tokyo") for the calendar's floating times; Google reads it, Apple and Outlook use the device's own. */
  tz?: string;
}

/**
 * A calendar with one event per note that names a day. Times are local
 * ("floating"), so they mean the same wall-clock time wherever it is opened.
 * Each event keeps its note's id, so a calendar that subscribes to the feed
 * moves and renames events as the board changes instead of adding new ones.
 */
export function toIcs(meta: Meta, items: Item[], boardId: string, now = new Date(), feed?: FeedOptions, opts: ExportOptions = {}): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const who = opts.who?.trim();
  const name = `${boardTitle(meta)}${who ? ` · ${who}` : ""}`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//Longtable//${feed ? "Week feed" : "Week export"}//EN`, "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(name)}`];
  if (feed) {
    lines.push("METHOD:PUBLISH", `X-WR-CALDESC:${icsText(`${who ? `${who}'s notes on` : "The week on"} the Longtable board ${boardTitle(meta)}. It follows the board as it changes.`)}`);
    lines.push("REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H");
    if (feed.tz) lines.push(`X-WR-TIMEZONE:${feed.tz}`);
  }
  for (const e of weekEntries(items, meta.weekOf, opts)) {
    if (!e.date) continue;
    const date = parseIso(e.date);
    lines.push("BEGIN:VEVENT", `UID:${e.id}.${boardId}@longtable`, `DTSTAMP:${stamp}`);
    if (e.time === null) {
      const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${icsDate(date)}`, `DTEND;VALUE=DATE:${icsDate(next)}`);
    } else {
      const hh = String(Math.floor(e.time / 60)).padStart(2, "0");
      const mm = String(e.time % 60).padStart(2, "0");
      const end = e.time + 60;
      const endDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + Math.floor(end / 1440));
      const eh = String(Math.floor((end % 1440) / 60)).padStart(2, "0");
      const em = String(end % 60).padStart(2, "0");
      lines.push(`DTSTART:${icsDate(date)}T${hh}${mm}00`, `DTEND:${icsDate(endDate)}T${eh}${em}00`);
    }
    lines.push(`SUMMARY:${icsText(e.who && !who ? `${e.text} · ${e.who}` : e.text)}`);
    const about = [e.who ? `For ${e.who}.` : "", `From ${boardTitle(meta)}${e.by ? `, added by ${e.by}` : ""}.`].filter(Boolean).join(" ");
    lines.push(`DESCRIPTION:${icsText(about)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export const fileStem = (meta: Meta) =>
  boardTitle(meta)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "") || "longtable-week";
