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
