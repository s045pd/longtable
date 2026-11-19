// A pasted chat, meeting notes or to-do list, turned into notes. The room
// asks Workers AI to pick out what needs doing, with the day, time and who
// (planMessages, readPlan). Where AI is not set up, is used up for the day or
// fails, the board falls back to reading the text line by line (linesToNotes):
// one note per line, chat names and timestamps taken off, small talk left out,
// and the day and time read from the words as for any note.
import { DAY_KEYS, DAY_NAMES, findDay, findTime } from "./days";
import type { PlanNote } from "./types";

/** The most text one ask may carry (a long group chat is a few thousand characters). */
export const PLAN_MAX_CHARS = 8000;
/** The most notes one ask adds. */
export const PLAN_MAX_NOTES = 40;
/** Pasted text this long, or with this many lines, opens the plan dialog instead of becoming notes at once. */
export const PLAN_PASTE_CHARS = 280;
export const PLAN_PASTE_LINES = 6;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The date as YYYY-MM-DD, in this clock's own time zone. */
export const localIso = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return DAY_NAMES[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

function plusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** What the model is told, and the chat. */
export function planMessages(text: string, weekOf: string, today: string): { role: "system" | "user"; content: string }[] {
  const day = ISO.test(today) ? today : new Date().toISOString().slice(0, 10);
  const week = ISO.test(weekOf) ? `the week from Monday ${weekOf} to Sunday ${plusDays(weekOf, 6)}` : "one week, Monday to Sunday";
  const when = `Today is ${weekdayOf(day)} ${day}, so tomorrow (明天) is ${weekdayOf(plusDays(day, 1))} ${plusDays(day, 1)} and the day after (后天) is ${weekdayOf(plusDays(day, 2))} ${plusDays(day, 2)}. The board plans ${week}.`;
  const system = [
    "You turn a pasted group chat, meeting notes or to-do list into sticky notes for a shared weekly planning board.",
    "",
    "Reply with JSON only, in this shape:",
    '{"notes":[{"text":"Flyers out","day":"wed","time":"08:00","who":"Bo"}]}',
    "",
    "Rules:",
    "- One note for each task, event, deadline or decision someone has to act on. One message can hold several tasks: give each its own note. Leave out greetings, small talk, thanks, jokes, reactions and questions that were answered. When the chat changes its mind (a new day, a new time, someone else), keep only the final version. When someone asks for something and another person takes it on (\u201ccan someone call the printer?\u201d, \u201cI'll call them tomorrow\u201d), that is one note: the task, with the person who took it and the day and time they gave. No duplicates.",
    '- "text": what to do, short like a sticky note (at most 8 words, or 12 Chinese characters), in the words of the message it comes from, and clear on its own: \u201cCall the printer\u201d, not \u201cCall them\u201d. Never translate: a Chinese message gives a Chinese note even when the rest of the chat is English, and the other way round. Leave the day, time and person out of it.',
    `- "day": the weekday it happens or is due: "mon", "tue", "wed", "thu", "fri", "sat" or "sun"; null if the chat gives none. ${when} Turn words like "tomorrow", "this Friday", "明天", "后天", "下周三" and dates like "11/25" into the weekday they fall on.`,
    '- "time": the clock time, 24-hour "HH:MM" ("下午4点" is "16:00", "8 am" is "08:00"); null if none.',
    '- "who": the person who will do it, written as in the chat, when the chat says so; otherwise null.',
    `- At most ${PLAN_MAX_NOTES} notes, in the order they happen.`,
    "",
    'For example, the message "小李：周五上午10点开会，我来订会议室" holds two notes:',
    '{"text":"开会","day":"fri","time":"10:00","who":null} and {"text":"订会议室","day":null,"time":null,"who":"小李"}.',
    "Only notes from the chat below go in your answer.",
  ].join("\n");
  // Qwen 3 thinks before it answers: a few seconds more, and it is what catches
  // "actually Friday instead" and the task someone else took on.
  return [
    { role: "system", content: system },
    { role: "user", content: `The chat:\n"""\n${text.slice(0, PLAN_MAX_CHARS)}\n"""` },
  ];
}

/** The words of a model's answer, whatever shape the model gives it in. */
function answerText(raw: unknown): unknown {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.notes)) return r;
  if (r.response !== undefined) return answerText(r.response);
  const choice = Array.isArray(r.choices) ? (r.choices[0] as Record<string, unknown> | undefined) : undefined;
  const message = choice?.message as Record<string, unknown> | undefined;
  if (message?.content !== undefined) return answerText(message.content);
  if (typeof choice?.text === "string") return choice.text;
  return null;
}

function parseJson(text: string): unknown {
  const s = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const start = s.search(/[[{]/);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

const NOBODY = /^(null|none|n\/?a|unknown|anyone|everyone|all|nobody|team|大家|所有人|全体|无|未知|待定)$/i;

function cleanDay(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 6) return v;
  if (typeof v !== "string" || !v.trim()) return null;
  const k = v.trim().toLowerCase().slice(0, 3);
  const i = (DAY_KEYS as readonly string[]).indexOf(k);
  if (i >= 0) return i;
  return findDay(v)?.day ?? null;
}

function cleanTime(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const m = /^(\d{1,2})[:：.](\d{2})$/.exec(v.trim());
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  return findTime(v);
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The notes in a model's answer, checked and trimmed: null when the answer
 * isn't the JSON asked for, [] when it is but holds no notes.
 */
export function readPlan(raw: unknown): PlanNote[] | null {
  const answer = answerText(raw);
  const data = typeof answer === "string" ? parseJson(answer) : answer;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const list = Array.isArray(data) ? data : Array.isArray(d.notes) ? d.notes : Array.isArray(d.items) ? d.items : Array.isArray(d.tasks) ? d.tasks : null;
  if (!list) return null;
  const out: PlanNote[] = [];
  const seen = new Set<string>();
  for (const n of list) {
    if (out.length >= PLAN_MAX_NOTES) break;
    if (!n || typeof n !== "object") continue;
    const o = n as Record<string, unknown>;
    const said = typeof o.text === "string" ? oneLine(o.text).slice(0, 140) : "";
    const text = said.replace(/^[a-z]/, (c) => c.toUpperCase());
    if (!text) continue;
    const day = cleanDay(o.day);
    const time = cleanTime(o.time);
    const whoRaw = typeof o.who === "string" ? oneLine(o.who).replace(/^@/, "").slice(0, 32) : "";
    const who = whoRaw && !NOBODY.test(whoRaw) ? whoRaw : null;
    const key = `${text.toLowerCase()}|${day}|${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, day, time, who });
  }
  return out;
}

// ------------------------------------------------------------------ by lines

/** A timestamp in front of a message: "[19/11 12:03]", "19/11/2026, 12:03 - ", "2026-11-19 12:03:44 ". */
const STAMP = /^(?:\[[^\]]{3,40}\]\s*|\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?\s*(?:[-–—]\s*)?)/;
/** A sender in front of a message: "Ana: …", "小王：…". */
const SENDER = /^([^\s:：]{1,20}(?: [^\s:：]{1,20})?)(?:[:：]\s+|：\s*)(?=\S)/;
/** A line that is only a sender and a time, above their message (Slack, Telegram, WeChat). */
const HEADER = [
  /^\S.{0,30}?,?\s+\[[^\]]*\d{1,2}:\d{2}[^\]]*\]$/,
  /^\S.{0,30}?\s+\d{1,2}:\d{2}\s?[AaPp]\.?[Mm]\.?$/,
  /^\S.{0,30}?\s+\d{2,4}[/.-]\d{1,2}[/.-]\d{1,4}\s+\d{1,2}:\d{2}(?::\d{2})?$/,
  /^\S{1,20}\s+\d{1,2}:\d{2}(?::\d{2})?$/,
];
/** Small talk that is never a task. */
const CHATTER =
  /^(?:ok(?:ay)?|k|yes|yep|yeah|no|nope|sure|cool|nice|great|done|thanks?|thank you|thx|ty|lol|haha+|hah|hh+|good|got it|noted|on it|\+1|好的?|好滴|好嘞|嗯+|恩+|收到|可以|行|没问题|谢谢|感谢|辛苦了?|哈+|呵呵|对|是的?|ok👌)[\s!！.。~～,，?？]*$/i;
const ONLY_SYMBOLS = /^[\p{P}\p{S}\p{Emoji_Presentation}\s]+$/u;

/** One note per line that says something, with chat names and timestamps taken off. */
export function linesToNotes(text: string, max = 30): PlanNote[] {
  const out: PlanNote[] = [];
  const seen = new Set<string>();
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || HEADER.some((re) => re.test(line))) continue;
    line = line.replace(STAMP, "").replace(SENDER, "").replace(/^[-*•·]\s+|^\d{1,2}[.)、]\s*|^\[[ xX]\]\s+/, "").trim();
    if (line.length < 2 || CHATTER.test(line) || ONLY_SYMBOLS.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: line.slice(0, 400), day: null, time: null, who: null });
    if (out.length >= max) break;
  }
  return out;
}

/** True for pasted text big enough to read as a chat rather than drop straight onto the board. */
export const looksLikeAChat = (text: string) => text.length >= PLAN_PASTE_CHARS || text.split(/\r?\n/).filter((l) => l.trim()).length >= PLAN_PASTE_LINES;
