// A board's keys and password, kept in the board's own storage. Everything
// here runs inside the board's Durable Object.
import { KEY, newKey } from "../src/shared/ids";
import type { Access, Role } from "../src/shared/types";

/** What the board stores about who may open it. */
export interface Lock {
  /** The key of the edit link. */
  edit: string;
  /** The key of the watch-only link. */
  view: string;
  /** The key of the calendar feed; boards from before calendars get one when first opened. */
  cal?: string;
  /** SHA-256 of the owner key (the owner key itself is never stored). */
  owner: string;
  /** The password, as PBKDF2-SHA-256 of it with its own salt. */
  pw?: { salt: string; hash: string; iter: number };
  /** Handed to whoever gives the right password, to come back without typing it; changes with the password. */
  pass?: string;
}

export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 200;
/** The most the Workers runtime allows. Checking one password takes a few tens of milliseconds. */
const ITERATIONS = 100_000;

const enc = new TextEncoder();
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare two strings in time that does not depend on where they differ. */
export function same(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  // Workers have timingSafeEqual; elsewhere (the unit tests) compare every byte.
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(x, y);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function pbkdf2(pw: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
  return b64(bits);
}

export async function hashPassword(pw: string): Promise<NonNullable<Lock["pw"]>> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: await pbkdf2(pw, salt, ITERATIONS), iter: ITERATIONS };
}

export async function checkPassword(pw: unknown, stored: NonNullable<Lock["pw"]>): Promise<boolean> {
  if (typeof pw !== "string" || !pw.length || pw.length > PASSWORD_MAX) return false;
  return same(await pbkdf2(pw, unb64(stored.salt), stored.iter), stored.hash);
}

/** A new board's keys. The owner key goes to the person who made the board and is stored only as a hash. */
export async function newLock(): Promise<{ lock: Lock; ownerKey: string }> {
  const ownerKey = newKey();
  return { lock: { edit: newKey(), view: newKey(), cal: newKey(), owner: await sha256(ownerKey) }, ownerKey };
}

/** Which role a hello's keys give, or null when they open nothing. */
export async function roleFor(lock: Lock, key: unknown, owner: unknown): Promise<Role | null> {
  if (typeof owner === "string" && KEY.test(owner) && same(await sha256(owner), lock.owner)) return "owner";
  if (same(key, lock.edit)) return "editor";
  if (same(key, lock.view)) return "viewer";
  return null;
}

/** What one person is told about their access. */
export const accessFor = (lock: Lock, role: Role): Access => ({
  role,
  password: !!lock.pw,
  view: lock.view,
  ...(lock.cal ? { cal: lock.cal } : {}),
  ...(role === "viewer" ? {} : { edit: lock.edit }),
});

/** An IANA time zone name the runtime knows, or undefined. */
export function cleanZone(tz: string | null | undefined): string | undefined {
  if (!tz || tz.length > 40 || !/^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+){0,2}$/.test(tz)) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

/** Wrong tries from one address. */
export interface TryRecord {
  n: number;
  /** Until when the next try is refused (ms). */
  until: number;
  /** The last wrong try (ms). */
  at: number;
}

/** Where wrong tries are kept: in the board's storage, so they outlast the room sleeping. */
export interface TryStore {
  get(who: string): TryRecord | undefined;
  set(who: string, t: TryRecord): void;
  delete(who: string): void;
}

/** A try store in memory (for tests). */
export class MemoryTryStore implements TryStore {
  private by = new Map<string, TryRecord>();
  get = (who: string) => this.by.get(who);
  set(who: string, t: TryRecord) {
    this.by.set(who, t);
    if (this.by.size > 5000) this.by.delete(this.by.keys().next().value!);
  }
  delete = (who: string) => void this.by.delete(who);
}

/** An address is forgotten a day after its last wrong try. */
export const FORGET_TRIES_MS = 24 * 3600_000;

/**
 * Wrong passwords, per address: five free tries, then a wait that doubles
 * from 30 seconds up to 15 minutes. A try is counted before it is checked,
 * so tries sent all at once still meet the wait; the right password clears
 * the count.
 */
export class Tries {
  constructor(private store: TryStore = new MemoryTryStore()) {}

  /** Seconds to wait before the next try from this address counts, or 0. */
  wait(who: string, now = Date.now()): number {
    const t = this.store.get(who);
    return t && t.until > now ? Math.ceil((t.until - now) / 1000) : 0;
  }

  /** Count a try. Returns the wait that follows it, in seconds. */
  fail(who: string, now = Date.now()): number {
    const old = this.store.get(who);
    const t: TryRecord = old && now - old.at < FORGET_TRIES_MS ? { ...old } : { n: 0, until: 0, at: now };
    t.n++;
    t.at = now;
    if (t.n >= 5) t.until = now + Math.min(15 * 60_000, 30_000 * 2 ** (t.n - 5));
    this.store.set(who, t);
    return this.wait(who, now);
  }

  clear(who: string) {
    if (this.store.get(who)) this.store.delete(who);
  }
}

/** How a socket's address is kept: a short hash, never the address itself. */
export async function addressKey(ip: string | null | undefined): Promise<string> {
  return (await sha256(`longtable:${ip ?? "local"}`)).slice(0, 20);
}
