// Your boards: the boards opened on this device, and deleting several of them
// at once (the ones you own) from "Manage boards", without opening each.
import type { Role } from "../shared/types";
import { forgetBoard, loadKeys, recentBoards, type RecentBoard } from "./identity";

/** Boards live on the server (the Worker), or only in this browser under `npm run dev`. */
export const ON_SERVER = import.meta.env.PROD || new URLSearchParams(location.search).has("live");

export interface MyBoard extends RecentBoard {
  /** This device has the owner key, so it may delete the board. */
  mine: boolean;
}

export function myBoards(): MyBoard[] {
  return recentBoards().map((r) => {
    const mine = !ON_SERVER || !!loadKeys(r.id).owner;
    const role: Role | undefined = mine ? "owner" : r.role;
    return { ...r, mine, role };
  });
}

/** The board to go to after deleting these: the one opened most recently. */
export const nextBoard = (except: string[]): RecentBoard | undefined => recentBoards().find((r) => !except.includes(r.id));

export type Deleted = { id: string; ok: true } | { id: string; ok: false; why: string };

/** Delete one board with this device's owner key; one already gone counts as deleted. */
export async function deleteBoard(id: string): Promise<Deleted> {
  if (!ON_SERVER) {
    try {
      localStorage.removeItem(`longtable:board:${id}`);
    } catch {
      // ignore
    }
    forgetBoard(id);
    return { id, ok: true };
  }
  const owner = loadKeys(id).owner;
  if (!owner) return { id, ok: false, why: "only its owner can delete it" };
  try {
    const res = await fetch(`/api/boards/${encodeURIComponent(id)}/delete`, { method: "POST", headers: { "x-longtable-owner": owner } });
    if (res.ok || res.status === 404 || res.status === 410) {
      forgetBoard(id);
      return { id, ok: true };
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { id, ok: false, why: body.error ?? `the server said ${res.status}` };
  } catch {
    return { id, ok: false, why: "no connection" };
  }
}

// A line to show on the next page: "Deleted “Launch party”." after the jump.
const FLASH = "longtable:flash";

export function setFlash(text: string) {
  try {
    sessionStorage.setItem(FLASH, text);
  } catch {
    // ignore
  }
}

export function takeFlash(): string | null {
  try {
    const t = sessionStorage.getItem(FLASH);
    sessionStorage.removeItem(FLASH);
    return t;
  } catch {
    return null;
  }
}
