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
  return { lock: { edit: newKey(), view: newKey(), owner: await sha256(ownerKey) }, ownerKey };
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
  ...(role === "viewer" ? {} : { edit: lock.edit }),
});

/**
 * Wrong passwords, per address: five free tries, then a wait that doubles
 * from 30 seconds up to 15 minutes. Kept in memory, so a board that sleeps
 * forgets; waking it again takes long enough to slow guessing to a crawl.
 */
export class Tries {
  private by = new Map<string, { n: number; until: number }>();

  /** Seconds to wait before the next try from this address counts, or 0. */
  wait(ip: string, now = Date.now()): number {
    const t = this.by.get(ip);
    return t && t.until > now ? Math.ceil((t.until - now) / 1000) : 0;
  }

  fail(ip: string, now = Date.now()): number {
    const t = this.by.get(ip) ?? { n: 0, until: 0 };
    t.n++;
    if (t.n >= 5) t.until = now + Math.min(15 * 60_000, 30_000 * 2 ** (t.n - 5));
    this.by.set(ip, t);
    if (this.by.size > 5000) this.by.delete(this.by.keys().next().value!);
    return this.wait(ip, now);
  }

  clear(ip: string) {
    this.by.delete(ip);
  }
}
