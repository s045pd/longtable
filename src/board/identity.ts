// Who you are on this device: a name, a colour and a stable id for your votes.
// Kept in localStorage; every read and write is guarded, because private
// windows and blocked storage throw.
import { randomId } from "../shared/ids";
import type { BoardKeys } from "./net";
import type { Item, Meta, Role } from "../shared/types";

export interface Identity {
  cid: string;
  name: string;
  color: string;
}

const KEY = "longtable:me";

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.cid === "string" && typeof v?.name === "string" && typeof v?.color === "string") return v;
  } catch {
    // fall through
  }
  return null;
}

export function saveIdentity(me: Identity) {
  try {
    localStorage.setItem(KEY, JSON.stringify(me));
  } catch {
    // not saved: you will be asked again next time
  }
}

/** A device id even before you have a name (votes need one). */
export function deviceId(): string {
  return loadIdentity()?.cid ?? sessionCid;
}
const sessionCid = randomId(12);

export interface RecentBoard {
  id: string;
  title: string;
  at: number;
  /** What you were on it last time: owner, editor or viewer. */
  role?: Role;
}
const RECENT = "longtable:recent";
/** How many boards "Your boards" keeps. */
const RECENT_MAX = 30;

export function recentBoards(): RecentBoard[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? "[]");
    return Array.isArray(v) ? v.filter((b) => typeof b?.id === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberBoard(id: string, title: string, role?: Role) {
  try {
    const all = recentBoards();
    const was = all.find((b) => b.id === id);
    const list = all.filter((b) => b.id !== id);
    const r = role ?? was?.role;
    list.unshift({ id, title, at: Date.now(), ...(r ? { role: r } : {}) });
    localStorage.setItem(RECENT, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // ignore
  }
}

export function forgetRecent(id: string) {
  try {
    localStorage.setItem(RECENT, JSON.stringify(recentBoards().filter((b) => b.id !== id)));
  } catch {
    // ignore
  }
}

// ------------------------------------------------------------- board keys
// The keys this device has for each board, so a board opens again from
// "Your boards" or a bare /b/<id> without its link. Only this browser has them.
const KEYS = "longtable:keys";
const KEY_RE = /^[a-z0-9]{26}$/;

function allKeys(): Record<string, BoardKeys> {
  try {
    const v = JSON.parse(localStorage.getItem(KEYS) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function loadKeys(id: string): BoardKeys {
  const k = allKeys()[id] ?? {};
  return {
    ...(typeof k.key === "string" ? { key: k.key } : {}),
    ...(typeof k.owner === "string" ? { owner: k.owner } : {}),
    ...(typeof k.pass === "string" ? { pass: k.pass } : {}),
  };
}

/** Merge into what this device keeps for the board; an undefined field is removed. */
export function saveKeys(id: string, keys: Partial<Record<keyof BoardKeys, string | undefined>>) {
  try {
    const all = allKeys();
    const next: BoardKeys = { ...all[id] };
    for (const [k, v] of Object.entries(keys) as [keyof BoardKeys, string | undefined][]) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    all[id] = next;
    localStorage.setItem(KEYS, JSON.stringify(all));
  } catch {
    // not kept: the link is needed again next time
  }
}

/** Forget a board on this device: its keys, its password pass and its place in Your boards. */
export function forgetBoard(id: string) {
  try {
    const all = allKeys();
    delete all[id];
    localStorage.setItem(KEYS, JSON.stringify(all));
  } catch {
    // ignore
  }
  forgetRecent(id);
}

/**
 * The keys in a link's fragment: #k=… (edit), #v=… (watch) or #o=… (owner).
 * A fragment never reaches the server, so the keys stay out of its logs.
 */
export function keysFromHash(hash: string): BoardKeys {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const out: BoardKeys = {};
  const key = p.get("k") ?? p.get("v");
  if (key && KEY_RE.test(key)) out.key = key;
  const owner = p.get("o");
  if (owner && KEY_RE.test(owner)) out.owner = owner;
  return out;
}

/** A board's link for one of its keys. */
export const boardLink = (id: string, kind: "k" | "v" | "o", key: string) => `${location.origin}/b/${id}#${kind}=${key}`;

// ------------------------------------------------------------- the demo, carried
// "Make it a real board" on the demo: what is on it waits here (this tab only)
// until the new board exists, then goes onto it.
export interface Carry {
  items: Item[];
  meta: Pick<Meta, "client" | "file" | "weekOf">;
  /** Open the new board's Share dialog. */
  share: boolean;
}
const CARRY = "longtable:carry";

export function putCarry(c: Carry) {
  try {
    sessionStorage.setItem(CARRY, JSON.stringify(c));
  } catch {
    // too big or blocked: the new board starts blank
  }
}

/** Hand what is waiting to the board just made. */
export function carryTo(id: string) {
  try {
    const raw = sessionStorage.getItem(CARRY);
    sessionStorage.removeItem(CARRY);
    if (raw) sessionStorage.setItem(`${CARRY}:${id}`, raw);
  } catch {
    // ignore
  }
}

export function takeCarry(id: string): Carry | null {
  try {
    const raw = sessionStorage.getItem(`${CARRY}:${id}`);
    sessionStorage.removeItem(`${CARRY}:${id}`);
    const c = raw ? JSON.parse(raw) : null;
    return c && Array.isArray(c.items) && c.meta ? c : null;
  } catch {
    return null;
  }
}
