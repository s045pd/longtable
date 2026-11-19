// Checks for everything that arrives from a browser. The server trusts none of
// it: each item, change, presence and effect is rebuilt field by field from
// what is allowed, and anything else is dropped.
import type { CheckRow, Effect, Item, Meta, Op, PhotoArt, Presence, ReactionKind } from "./types";

export const LIMITS = {
  items: 2000,
  text: 400,
  label: 80,
  name: 32,
  meta: 60,
  rows: 12,
  row: 80,
  strokePoints: 4000,
  opsPerMessage: 400,
  coordinate: 200_000,
};

export const PHOTO_ARTS: PhotoArt[] = ["loaf", "croissant", "shop", "cup", "tray", "flag"];
export const REACTIONS: ReactionKind[] = ["heart", "star", "bang", "clap"];

const HEX = /^#[0-9a-fA-F]{6}$/;
const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** A date (YYYY-MM-DD) or "" for none. */
const isoOrNone = (v: unknown): string | undefined => (v === "" || (typeof v === "string" && ISO_DAY.test(v)) ? v : undefined);
const ID = /^[A-Za-z0-9_-]{1,40}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
const coord = (v: unknown) => num(v, -LIMITS.coordinate, LIMITS.coordinate);
const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, max) : undefined;
const int = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
const color = (v: unknown): string | undefined => (typeof v === "string" && HEX.test(v) ? v.toUpperCase() : undefined);
export const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
/** An item's id, or "" for none. */
const idOrNone = (v: unknown): string | undefined => (v === "" || isId(v) ? v : undefined);

function rows(v: unknown): CheckRow[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.slice(0, LIMITS.rows).map((r) => ({
    text: (isObj(r) && str(r.text, LIMITS.row)) || "",
    done: isObj(r) && r.done === true,
  }));
}

function points(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: number[] = [];
  for (const n of v.slice(0, LIMITS.strokePoints * 2)) {
    const c = num(n, -20000, 20000);
    if (c === undefined) return undefined;
    out.push(Math.round(c * 10) / 10);
  }
  return out.length % 2 === 0 ? out : out.slice(0, -1);
}

function votes(v: unknown): Record<string, string> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, c] of Object.entries(v).slice(0, 40)) {
    const col = color(c);
    if (isId(k) && col) out[k] = col;
  }
  return out;
}

/**
 * The fields each kind of item may carry, with their checks. A patch may set
 * any of them except id and type; a put must give the required ones.
 */
const FIELDS: Record<Item["type"], Record<string, (v: unknown) => unknown>> = {
  note: {
    text: (v) => str(v, LIMITS.text),
    color,
    votes,
    day: (v) => int(v, -1, 7),
    time: (v) => int(v, -2, 1439),
    date: isoOrNone,
    who: (v) => (typeof v === "string" ? str(v, LIMITS.name)!.replace(/\s+/g, " ").trim() : undefined),
  },
  label: { text: (v) => str(v, LIMITS.label), color },
  check: { title: (v) => str(v, LIMITS.row), rows, color },
  photo: { art: (v) => (PHOTO_ARTS.includes(v as PhotoArt) ? v : undefined), caption: (v) => str(v, LIMITS.row) },
  stroke: { color, width: (v) => num(v, 1, 40), pts: points, on: idOrNone, from: idOrNone, to: idOrNone },
  week: { cols: (v) => (v === 7 || v === 8 ? v : undefined), of: isoOrNone },
};
const COMMON: Record<string, (v: unknown) => unknown> = {
  x: coord,
  y: coord,
  rot: (v) => num(v, -45, 45),
  z: (v) => num(v, -1e9, 1e9),
  by: (v) => str(v, LIMITS.name),
};
const DEFAULTS: { [K in Item["type"]]: Omit<Extract<Item, { type: K }>, keyof import("./types").BaseItem | "type"> } = {
  note: { text: "", color: "#FFE38A" },
  label: { text: "", color: "#ECE9E2" },
  check: { title: "", rows: [], color: "#C9B6FF" },
  photo: { art: "loaf", caption: "" },
  stroke: { color: "#9DF0C4", width: 6, pts: [] },
  week: { cols: 7 },
};

export function cleanItem(raw: unknown): Item | null {
  if (!isObj(raw) || !isId(raw.id) || typeof raw.type !== "string" || !(raw.type in FIELDS)) return null;
  const type = raw.type as Item["type"];
  const x = coord(raw.x);
  const y = coord(raw.y);
  if (x === undefined || y === undefined) return null;
  const out: Record<string, unknown> = { id: raw.id, type, x, y, rot: num(raw.rot, -45, 45) ?? 0, z: num(raw.z, -1e9, 1e9) ?? 0 };
  const by = str(raw.by, LIMITS.name);
  if (by) out.by = by;
  const defaults = DEFAULTS[type] as Record<string, unknown>;
  for (const [key, check] of Object.entries(FIELDS[type])) {
    const v = check(raw[key]);
    if (v !== undefined) out[key] = v;
    else if (key in defaults) out[key] = structuredClone(defaults[key]);
  }
  return out as unknown as Item;
}

export function cleanPatch(type: Item["type"], raw: unknown): Partial<Item> | null {
  if (!isObj(raw)) return null;
  const out: Record<string, unknown> = {};
  const fields = { ...COMMON, ...FIELDS[type] };
  for (const [key, value] of Object.entries(raw)) {
    const check = fields[key];
    if (!check) continue;
    const v = check(value);
    if (v !== undefined) out[key] = v;
  }
  return Object.keys(out).length ? (out as Partial<Item>) : null;
}

export function cleanMeta(raw: unknown): Partial<Meta> | null {
  if (!isObj(raw)) return null;
  const out: Partial<Meta> = {};
  const client = str(raw.client, LIMITS.meta);
  const file = str(raw.file, LIMITS.meta);
  if (client !== undefined) out.client = client;
  if (file !== undefined) out.file = file;
  if (typeof raw.weekOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.weekOf)) out.weekOf = raw.weekOf;
  return Object.keys(out).length ? out : null;
}

/**
 * Check one change against the board as it stands. Returns the change as it
 * should be applied, or null to drop it.
 */
export function cleanOp(raw: unknown, typeOf: (id: string) => Item["type"] | undefined): Op | null {
  if (!isObj(raw)) return null;
  switch (raw.op) {
    case "put": {
      const item = cleanItem(raw.item);
      if (!item) return null;
      const existing = typeOf(item.id);
      if (existing && existing !== item.type) return null;
      return { op: "put", item };
    }
    case "patch": {
      if (!isId(raw.id)) return null;
      const type = typeOf(raw.id);
      if (!type) return null;
      const set = cleanPatch(type, raw.set);
      return set ? { op: "patch", id: raw.id, set } : null;
    }
    case "del":
      return isId(raw.id) && typeOf(raw.id) ? { op: "del", id: raw.id } : null;
    case "vote": {
      if (!isId(raw.id) || typeOf(raw.id) !== "note" || !isId(raw.who)) return null;
      const c = color(raw.color);
      return c ? { op: "vote", id: raw.id, who: raw.who, color: c, on: raw.on === true } : null;
    }
    case "meta": {
      const set = cleanMeta(raw.set);
      return set ? { op: "meta", set } : null;
    }
    default:
      return null;
  }
}

export function cleanPresence(raw: unknown): Presence | null {
  if (!isObj(raw)) return null;
  const out: Presence = {};
  if (raw.c === null) out.c = null;
  else if (Array.isArray(raw.c)) {
    const x = coord(raw.c[0]);
    const y = coord(raw.c[1]);
    if (x !== undefined && y !== undefined) out.c = [Math.round(x), Math.round(y)];
  }
  if (Array.isArray(raw.sel)) out.sel = raw.sel.filter(isId).slice(0, 200);
  if (raw.edit === null || isId(raw.edit)) out.edit = raw.edit as string | null;
  if (Array.isArray(raw.view)) {
    const x = coord(raw.view[0]);
    const y = coord(raw.view[1]);
    const z = num(raw.view[2], 0.05, 8);
    if (x !== undefined && y !== undefined && z !== undefined) out.view = [Math.round(x), Math.round(y), Math.round(z * 1000) / 1000];
  }
  if (typeof raw.pen === "boolean") out.pen = raw.pen;
  return out;
}

export function cleanEffect(raw: unknown): Effect | undefined {
  if (!isObj(raw) || raw.kind !== "tidy" || !isObj(raw.delays) || !isId(raw.week)) return undefined;
  const delays: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw.delays).slice(0, LIMITS.items)) {
    const d = num(v, 0, 3);
    if (isId(k) && d !== undefined) delays[k] = d;
  }
  const weeks = Array.isArray(raw.weeks) ? raw.weeks.filter(isId).slice(0, 60) : undefined;
  return { kind: "tidy", delays, week: raw.week, ...(weeks?.length ? { weeks } : {}), count: num(raw.count, 0, LIMITS.items) ?? 0 };
}

export const cleanName = (v: unknown) => (str(v, LIMITS.name) ?? "").trim();
export const cleanColor = color;
export const cleanReaction = (v: unknown): ReactionKind | undefined => (REACTIONS.includes(v as ReactionKind) ? (v as ReactionKind) : undefined);
export const cleanCoord = coord;
