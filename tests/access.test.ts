import { describe, expect, it } from "vitest";
import { FORGET_TRIES_MS, MemoryTryStore, Tries, accessFor, addressKey, checkPassword, hashPassword, newLock, roleFor, same, sha256 } from "../worker/access";
import { keysFromHash } from "../src/board/identity";
import { KEY } from "../src/shared/ids";

describe("a board's keys", () => {
  it("are long, random and different", async () => {
    const a = await newLock();
    const b = await newLock();
    for (const k of [a.lock.edit, a.lock.view, a.ownerKey]) expect(k).toMatch(KEY);
    expect(new Set([a.lock.edit, a.lock.view, a.ownerKey, b.lock.edit, b.lock.view, b.ownerKey]).size).toBe(6);
  });

  it("keep only a hash of the owner key", async () => {
    const { lock, ownerKey } = await newLock();
    expect(JSON.stringify(lock)).not.toContain(ownerKey);
    expect(lock.owner).toBe(await sha256(ownerKey));
  });

  it("give each link its role, and nothing for anything else", async () => {
    const { lock, ownerKey } = await newLock();
    expect(await roleFor(lock, undefined, ownerKey)).toBe("owner");
    expect(await roleFor(lock, lock.edit, undefined)).toBe("editor");
    expect(await roleFor(lock, lock.view, undefined)).toBe("viewer");
    expect(await roleFor(lock, "x".repeat(26), undefined)).toBeNull();
    expect(await roleFor(lock, undefined, lock.owner)).toBeNull(); // the stored hash is not the key
    expect(await roleFor(lock, lock.edit.toUpperCase(), undefined)).toBeNull();
  });

  it("never tell a viewer the edit link", async () => {
    const { lock } = await newLock();
    expect(accessFor(lock, "viewer").edit).toBeUndefined();
    expect(accessFor(lock, "editor").edit).toBe(lock.edit);
  });
});

describe("passwords", () => {
  it("are stored salted, and check out only when right", async () => {
    const a = await hashPassword("rye and pell");
    const b = await hashPassword("rye and pell");
    expect(a.hash).not.toBe(b.hash);
    expect(JSON.stringify(a)).not.toContain("rye");
    expect(await checkPassword("rye and pell", a)).toBe(true);
    expect(await checkPassword("rye and pel", a)).toBe(false);
    expect(await checkPassword("", a)).toBe(false);
    expect(await checkPassword(42, a)).toBe(false);
  });

  it("compare in full", () => {
    expect(same("abc", "abc")).toBe(true);
    expect(same("abc", "abd")).toBe(false);
    expect(same("abc", "abcd")).toBe(false);
    expect(same(undefined, "abc")).toBe(false);
  });

  it("get slower to guess after five wrong tries", () => {
    const t = new Tries();
    const now = 1_000_000;
    for (let i = 0; i < 4; i++) expect(t.fail("1.2.3.4", now)).toBe(0);
    expect(t.fail("1.2.3.4", now)).toBe(30);
    expect(t.wait("1.2.3.4", now + 10_000)).toBe(20);
    expect(t.wait("5.6.7.8", now)).toBe(0);
    expect(t.fail("1.2.3.4", now + 30_000)).toBe(60);
    for (let i = 0; i < 10; i++) t.fail("1.2.3.4", now);
    expect(t.wait("1.2.3.4", now)).toBe(15 * 60);
    t.clear("1.2.3.4");
    expect(t.wait("1.2.3.4", now)).toBe(0);
  });

  it("are counted before they are checked, so tries sent at once still meet the wait", () => {
    const t = new Tries();
    const now = 1_000_000;
    // Six tries arrive together: each one is counted as it comes in.
    const letIn = [0, 1, 2, 3, 4, 5].filter(() => {
      if (t.wait("a", now)) return false;
      t.fail("a", now);
      return true;
    });
    expect(letIn.length).toBe(5);
  });

  it("outlast the room sleeping, and are forgotten a day later", () => {
    const store = new MemoryTryStore();
    const now = 1_000_000;
    const before = new Tries(store);
    for (let i = 0; i < 5; i++) before.fail("a", now);
    // A new room (after it slept) reads the same store.
    const after = new Tries(store);
    expect(after.wait("a", now + 1000)).toBe(29);
    expect(after.fail("a", now + 31_000)).toBe(60);
    expect(new Tries(store).fail("a", now + 31_000 + FORGET_TRIES_MS)).toBe(0);
  });

  it("key addresses by a hash, never the address", async () => {
    const k = await addressKey("203.0.113.7");
    expect(k).not.toContain("203");
    expect(k).toHaveLength(20);
    expect(await addressKey("203.0.113.7")).toBe(k);
    expect(await addressKey("203.0.113.8")).not.toBe(k);
  });
});

describe("links", () => {
  const k = "abcdefghijkmnpqrstuvwxyz23";
  it("carry their key after the #", () => {
    expect(keysFromHash(`#k=${k}`)).toEqual({ key: k });
    expect(keysFromHash(`#v=${k}`)).toEqual({ key: k });
    expect(keysFromHash(`#o=${k}`)).toEqual({ owner: k });
    expect(keysFromHash("#k=short")).toEqual({});
    expect(keysFromHash("")).toEqual({});
  });
});
