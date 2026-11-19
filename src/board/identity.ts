// Who you are on this device: a name, a colour and a stable id for your votes.
// Kept in localStorage; every read and write is guarded, because private
// windows and blocked storage throw.
import { randomId } from "../shared/ids";

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
}
const RECENT = "longtable:recent";

export function recentBoards(): RecentBoard[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? "[]");
    return Array.isArray(v) ? v.filter((b) => typeof b?.id === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function rememberBoard(id: string, title: string) {
  try {
    const list = recentBoards().filter((b) => b.id !== id);
    list.unshift({ id, title, at: Date.now() });
    localStorage.setItem(RECENT, JSON.stringify(list.slice(0, 8)));
  } catch {
    // ignore
  }
}
