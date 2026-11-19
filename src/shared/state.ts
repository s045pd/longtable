// A board in memory: its items and its name. The server and every browser
// hold one and apply the same changes to it in the same way.
import type { Item, Meta, Op } from "./types";

export class BoardState {
  items = new Map<string, Item>();
  meta: Meta;

  constructor(meta: Meta, items: Item[] = []) {
    this.meta = { ...meta };
    for (const it of items) this.items.set(it.id, it);
  }

  typeOf = (id: string) => this.items.get(id)?.type;

  /** Apply one change. Returns false when it changed nothing (e.g. a patch to a deleted item). */
  apply(op: Op): boolean {
    switch (op.op) {
      case "put":
        this.items.set(op.item.id, op.item);
        return true;
      case "patch": {
        const it = this.items.get(op.id);
        if (!it) return false;
        this.items.set(op.id, { ...it, ...op.set } as Item);
        return true;
      }
      case "del":
        return this.items.delete(op.id);
      case "vote": {
        const it = this.items.get(op.id);
        if (!it || it.type !== "note") return false;
        const votes = { ...(it.votes ?? {}) };
        if (op.on) votes[op.who] = op.color;
        else delete votes[op.who];
        this.items.set(op.id, { ...it, votes });
        return true;
      }
      case "meta":
        this.meta = { ...this.meta, ...op.set };
        return true;
    }
  }

  /** The changes that would undo `op`, worked out before it is applied. */
  inverse(op: Op): Op[] {
    switch (op.op) {
      case "put": {
        const before = this.items.get(op.item.id);
        return [before ? { op: "put", item: before } : { op: "del", id: op.item.id }];
      }
      case "patch": {
        const before = this.items.get(op.id) as Record<string, unknown> | undefined;
        if (!before) return [];
        const set: Record<string, unknown> = {};
        for (const key of Object.keys(op.set)) set[key] = before[key];
        return [{ op: "patch", id: op.id, set: set as Partial<Item> }];
      }
      case "del": {
        const before = this.items.get(op.id);
        return before ? [{ op: "put", item: before }] : [];
      }
      case "vote": {
        const before = this.items.get(op.id);
        if (!before || before.type !== "note") return [];
        const had = before.votes?.[op.who];
        return [{ op: "vote", id: op.id, who: op.who, color: had ?? op.color, on: had !== undefined }];
      }
      case "meta": {
        const set: Record<string, unknown> = {};
        for (const key of Object.keys(op.set)) set[key] = (this.meta as unknown as Record<string, unknown>)[key];
        return [{ op: "meta", set: set as Partial<Meta> }];
      }
    }
  }

  /** The highest stacking order in use. */
  topZ(): number {
    let z = 0;
    for (const it of this.items.values()) z = Math.max(z, it.z);
    return z;
  }

  list(): Item[] {
    return [...this.items.values()];
  }
}
