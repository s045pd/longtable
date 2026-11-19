// The week, out of the board: as text (Markdown), as a spreadsheet (CSV) and
// as a calendar (iCalendar). Notes are grouped by the day they name and
// ordered like the tidy orders them; notes that name a time become timed
// events, the rest all-day ones.
import { DAY_NAMES, dateOf, findDay, findTime, formatTime } from "./days";
import type { CheckItem, Item, Meta, NoteItem } from "./types";

export interface WeekEntry {
  id: string;
  day: number | null;
  /** Minutes after midnight, or null for all day. */
  time: number | null;
  /** The note's words on one line. */
  text: string;
  by: string;
  votes: number;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();

export function weekEntries(items: Item[]): WeekEntry[] {
  const notes = items.filter((it): it is NoteItem => it.type === "note" && it.text.trim() !== "");
  const entries = notes.map((n) => ({
    id: n.id,
    day: findDay(n.text)?.day ?? null,
    time: findTime(n.text),
    text: oneLine(n.text),
    by: n.by ?? "",
    votes: Object.keys(n.votes ?? {}).length,
    y: n.y,
    x: n.x,
  }));
  entries.sort((a, b) => {
    const da = a.day ?? 7;
    const db = b.day ?? 7;
    if (da !== db) return da - db;
    if (a.time === null && b.time !== null) return -1;
    if (b.time === null && a.time !== null) return 1;
    if (a.time !== null && b.time !== null && a.time !== b.time) return a.time - b.time;
    return Math.abs(a.y - b.y) > 60 ? a.y - b.y : a.x - b.x;
  });
  return entries.map(({ x: _x, y: _y, ...e }) => e);
}

const dayTitle = (weekOf: string, day: number) => {
  const d = dateOf(weekOf, day);
  return `${DAY_NAMES[day]} ${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
};

export const boardTitle = (meta: Meta) => [meta.client, meta.file].filter((s) => s.trim()).join(" · ") || "Longtable board";

export function toMarkdown(meta: Meta, items: Item[]): string {
  const entries = weekEntries(items);
  const out = [`# ${boardTitle(meta)}`, ""];
  if (meta.weekOf) out.push(`Week of ${dayTitle(meta.weekOf, 0)}`, "");
  for (let day = 0; day < 8; day++) {
    const list = entries.filter((e) => (e.day ?? 7) === day);
    if (!list.length) continue;
    out.push(`## ${day < 7 ? (meta.weekOf ? dayTitle(meta.weekOf, day) : DAY_NAMES[day]) : "Any day"}`);
    for (const e of list) out.push(`- [ ] ${e.time !== null ? `${formatTime(e.time)} ` : ""}${e.text}${e.votes ? ` (${e.votes} ${e.votes === 1 ? "vote" : "votes"})` : ""}`);
    out.push("");
  }
  const lists = items.filter((it): it is CheckItem => it.type === "check");
  for (const list of lists) {
    out.push(`## ${list.title || "Checklist"}`);
    for (const r of list.rows) out.push(`- [${r.done ? "x" : " "}] ${r.text}`);
    out.push("");
  }
  if (!entries.length && !lists.length) out.push("_Nothing on the board yet._", "");
  return out.join("\n").trimEnd() + "\n";
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(meta: Meta, items: Item[]): string {
  const rows = [["day", "date", "time", "note", "by", "votes"]];
  for (const e of weekEntries(items)) {
    const date = e.day !== null && meta.weekOf ? isoOf(dateOf(meta.weekOf, e.day)) : "";
    rows.push([e.day !== null ? DAY_NAMES[e.day] : "Any day", date, e.time !== null ? formatTime(e.time) : "", e.text, e.by, String(e.votes)]);
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

/**
 * A calendar file with one event per note that names a day. Times are local
 * ("floating"), so they mean the same wall-clock time wherever it is opened.
 */
export function toIcs(meta: Meta, items: Item[], boardId: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Longtable//Week export//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(boardTitle(meta))}`];
  for (const e of weekEntries(items)) {
    if (e.day === null || !meta.weekOf) continue;
    const date = dateOf(meta.weekOf, e.day);
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
    lines.push(`SUMMARY:${icsText(e.text)}`);
    if (e.by) lines.push(`DESCRIPTION:${icsText(`From ${boardTitle(meta)}, added by ${e.by}.`)}`);
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
