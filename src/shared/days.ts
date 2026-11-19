// Which day a note is about, and at what time. A note goes to the column of
// the first weekday it names: "Flyers out Wed 8 am" is Wednesday at 08:00.
// English (Mon, Tues, Thursday …) and Chinese (周一, 星期三, 礼拜天 …) both work.

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const DAY_HEADERS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const ANY_DAY = "ANY DAY";

const ENGLISH: RegExp[] = [
  /\bmon(?:day)?\b/i,
  /\btue(?:s|sday)?\b/i,
  /\bwed(?:s|nesday)?\b/i,
  /\bthu(?:r|rs|rsday)?\b/i,
  /\bfri(?:day)?\b/i,
  /\bsat(?:urday)?\b/i,
  /\bsun(?:day)?\b/i,
];
const CHINESE = /(?:周|星期|礼拜|禮拜)([一二三四五六日天])/;
const CHINESE_DAY: Record<string, number> = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 };

export interface DayMatch {
  /** 0 = Monday … 6 = Sunday. */
  day: number;
  /** Where the day word sits in the text. */
  index: number;
  length: number;
}

/** The first weekday named in the text, or null. */
export function findDay(text: string): DayMatch | null {
  let best: DayMatch | null = null;
  ENGLISH.forEach((re, day) => {
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) best = { day, index: m.index, length: m[0].length };
  });
  const zh = CHINESE.exec(text);
  if (zh && (!best || zh.index < (best as DayMatch).index)) best = { day: CHINESE_DAY[zh[1]], index: zh.index, length: zh[0].length };
  return best;
}

/** Minutes after midnight of the first time of day named in the text, or null. */
export function findTime(text: string): number | null {
  const twelve = /\b(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)/i.exec(text);
  const clock = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  const zh = /(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})\s*(?:点|點|:|：)\s*(半|\d{2})?/.exec(text);
  const found: { at: number; minutes: number }[] = [];
  if (twelve) {
    let h = Number(twelve[1]) % 12;
    if (twelve[3].toLowerCase().startsWith("p")) h += 12;
    found.push({ at: twelve.index, minutes: h * 60 + Number(twelve[2] ?? 0) });
  }
  if (clock) found.push({ at: clock.index, minutes: Number(clock[1]) * 60 + Number(clock[2]) });
  if (zh) {
    let h = Number(zh[2]);
    const part = zh[1] ?? "";
    if (h <= 12 && /下午|傍晚|晚上/.test(part) && h < 12) h += 12;
    if (part === "中午" && h < 11) h += 12;
    const m = zh[3] === "半" ? 30 : Number(zh[3] ?? 0);
    if (h < 24) found.push({ at: zh.index, minutes: h * 60 + m });
  }
  if (!found.length) return null;
  found.sort((a, b) => a.at - b.at);
  return found[0].minutes;
}

export const formatTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** The Monday on or after a date, as YYYY-MM-DD (local calendar). */
export function nextMonday(from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const shift = (8 - d.getDay()) % 7;
  d.setDate(d.getDate() + shift);
  return isoDate(d);
}

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The date of day `day` (0 = Monday) in the week that starts on `weekOf`. */
export function dateOf(weekOf: string, day: number): Date {
  const [y, m, d] = weekOf.split("-").map(Number);
  return new Date(y, m - 1, d + day);
}

/** A YYYY-MM-DD date as a local Date at midnight. */
export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** YYYY-MM-DD, n days later (or earlier). */
export const addDays = (iso: string, n: number) => {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

/** 0 = Monday … 6 = Sunday, for a YYYY-MM-DD date. */
export const weekdayOf = (iso: string) => (parseIso(iso).getDay() + 6) % 7;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The Monday of the week a date falls in, as YYYY-MM-DD. */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return isoDate(date);
}

// A note's day and time can also be picked by hand, and then win over its
// words. `day`: 0 = Monday … 6 = Sunday, 7 = "any day"; -1 (or no field)
// means read it from the words. `time`: minutes after midnight; -2 = no
// time; -1 (or no field) means read it from the words.
export const ANY = 7;
export const FROM_WORDS = -1;
export const NO_TIME = -2;

interface Whenable {
  text: string;
  day?: number;
  time?: number;
  date?: string;
}

/** True when the note has a date of its own (picked by hand or read from a chat), which wins over everything else. */
export const datePicked = (n: Whenable) => typeof n.date === "string" && ISO_DATE.test(n.date);
export const dayPicked = (n: Whenable) => datePicked(n) || (n.day !== undefined && n.day >= 0);
export const timePicked = (n: Whenable) => n.time !== undefined && n.time !== FROM_WORDS;

/** The weekday a note is for (0 = Monday … 6 = Sunday), or null for any day. */
export function noteDay(n: Whenable): number | null {
  if (datePicked(n)) return weekdayOf(n.date!);
  if (dayPicked(n)) return n.day! >= ANY ? null : n.day!;
  return findDay(n.text)?.day ?? null;
}

/**
 * The Monday of the week a note belongs in: its own date's week, or else the
 * board's week (a weekday named in the words, picked in the board's week, or
 * no day at all). "" when the board has no week and the note no date.
 */
export function noteWeek(n: Whenable, weekOf: string): string {
  return datePicked(n) ? mondayOf(n.date!) : weekOf;
}

/** The date a note is for, YYYY-MM-DD, or null for any day (or a weekday on a board with no week). */
export function noteDate(n: Whenable, weekOf: string): string | null {
  if (datePicked(n)) return n.date!;
  const day = noteDay(n);
  return day === null || !weekOf ? null : isoDate(dateOf(weekOf, day));
}

/** The time a note is at, in minutes after midnight, or null. */
export function noteTime(n: Whenable): number | null {
  if (timePicked(n)) return n.time! < 0 ? null : n.time!;
  return findTime(n.text);
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "SAT 28" ("SAT" without a week; "WED 3 DEC" outside the board's week), "ANY DAY", plus " · 10:00" when timed. */
export function whenLabel(n: Whenable, weekOf: string): string {
  const day = noteDay(n);
  const time = noteTime(n);
  const date = noteDate(n, weekOf);
  let d = day === null ? ANY_DAY : DAY_HEADERS[day];
  if (date) {
    const at = parseIso(date);
    d += ` ${at.getDate()}`;
    if (mondayOf(date) !== weekOf) d += ` ${MONTHS[at.getMonth()]}`;
  }
  return time === null ? d : `${d} · ${formatTime(time)}`;
}

/** The person a note is for, if it names one. */
export const noteWho = (n: { who?: string }) => (n.who ?? "").trim();

/** True when a note is for this person: its tag names them, or its words @-mention them. */
export function isFor(n: { text: string; who?: string }, name: string): boolean {
  const me = name.trim().toLowerCase();
  if (!me) return false;
  if (noteWho(n).toLowerCase() === me) return true;
  const at = n.text.toLowerCase().indexOf(`@${me}`);
  if (at < 0) return false;
  const after = n.text.charAt(at + me.length + 1);
  return !after || !/[\p{L}\p{N}_]/u.test(after);
}
