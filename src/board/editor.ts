// Typing into the board: a note's words, a label, a checklist's title and
// rows, a photo's caption. Words go out as you type (others watch them
// appear); one undo step covers the whole edit, and a new item that ends up
// empty disappears.
import { LIMITS } from "../shared/schema";
import { checkHeight, CHECK } from "../shared/geometry";
import type { CheckItem, Item, Op } from "../shared/types";
import type { Board } from "./app";
import { fitNote, measureLabel } from "./fit";

export class Editor {
  id: string | null = null;
  private before: Item | null = null;
  private fresh = false;
  private host: HTMLElement | null = null;
  private sendTimer = 0;
  private live: Partial<Item> = {};
  private rebuilding = false;

  constructor(private board: Board) {}

  /** The fields being typed, so a remote move does not overwrite them. */
  liveFields(): Partial<Item> {
    return this.live;
  }

  open(id: string, opts: { fresh?: boolean; row?: number; caret?: "end" | "all" } = {}) {
    if (this.id === id) return;
    this.commit();
    const it = this.board.state.items.get(id);
    const view = this.board.views.get(id);
    if (!it || !view || it.type === "stroke" || it.type === "week") return;
    this.id = id;
    this.before = structuredClone(it);
    this.fresh = !!opts.fresh;
    this.live = {};
    view.editing = true;
    view.el.classList.add("editing");
    this.board.link.presence({ edit: id });
    this.board.setSelection([id]);

    const shape = view.shape;
    if (it.type === "note") {
      const ta = this.textarea("edit-note", it.text, LIMITS.text);
      ta.style.fontSize = `${fitNote(it.text || " ").size}px`;
      ta.addEventListener("input", () => {
        ta.style.fontSize = `${fitNote(ta.value || " ").size}px`;
        this.change({ text: ta.value });
      });
      shape.append(ta);
      this.host = ta;
      this.focus(ta, opts.caret ?? "end");
    } else if (it.type === "label") {
      const ta = this.textarea("edit-label", it.text, LIMITS.label);
      const size = () => {
        const w = Math.max(120, measureLabel(ta.value || " ") + 36);
        shape.style.width = `${w}px`;
        shape.style.left = `${-w / 2}px`;
      };
      size();
      ta.addEventListener("input", () => {
        ta.value = ta.value.replace(/\n/g, " ");
        size();
        this.change({ text: ta.value });
      });
      shape.append(ta);
      this.host = ta;
      this.focus(ta, opts.caret ?? "end");
    } else if (it.type === "photo") {
      const input = document.createElement("input");
      input.className = "edit-caption";
      input.value = it.caption;
      input.maxLength = LIMITS.row;
      input.addEventListener("input", () => this.change({ caption: input.value }));
      this.keys(input);
      shape.append(input);
      this.host = input;
      this.focus(input, opts.caret ?? "end");
    } else if (it.type === "check") {
      this.openChecklist(it, opts.row ?? -1);
    }
  }

  private textarea(cls: string, value: string, max: number) {
    const ta = document.createElement("textarea");
    ta.className = cls;
    ta.value = value;
    ta.maxLength = max;
    ta.spellcheck = false;
    ta.setAttribute("aria-label", "Edit text");
    this.keys(ta);
    return ta;
  }

  private keys(el: HTMLElement, enterCommits = el.tagName === "INPUT") {
    el.addEventListener("keydown", (e) => {
      e.stopPropagation();
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape" || (ke.key === "Enter" && (ke.metaKey || ke.ctrlKey))) {
        ke.preventDefault();
        this.commit();
      }
      if (ke.key === "Enter" && enterCommits) {
        ke.preventDefault();
        this.commit();
      }
      if (ke.key === "Tab" && this.id) {
        // Tab: done here, start the next note beside this one.
        const it = this.board.state.items.get(this.id);
        if (it?.type === "note") {
          ke.preventDefault();
          const { x, y } = it;
          this.commit();
          this.board.addNote(x + 232, y);
        }
      }
    });
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("blur", () => {
      // Let a click that moves focus inside the same item land first.
      if (this.rebuilding) return;
      setTimeout(() => {
        if (this.host && !this.host.contains(document.activeElement) && document.activeElement !== this.host) this.commit();
      }, 0);
    });
  }

  private focus(el: HTMLInputElement | HTMLTextAreaElement, caret: "end" | "all") {
    // Focus at once, so not a keystroke typed straight after a click is lost.
    el.focus({ preventScroll: true });
    if (caret === "all") el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }

  private openChecklist(it: CheckItem, row: number) {
    const view = this.board.views.get(it.id)!;
    const form = document.createElement("div");
    form.className = "edit-check";
    view.shape.append(form);
    this.host = form;
    let rows = it.rows.map((r) => ({ ...r }));
    let title = it.title;
    const render = (focusRow: number | "title", at: "end" | "start" = "end") => {
      this.rebuilding = true;
      form.innerHTML = "";
      const t = document.createElement("input");
      t.className = "edit-check-title";
      t.placeholder = "List title";
      t.value = title;
      t.maxLength = LIMITS.row;
      t.addEventListener("input", () => {
        title = t.value;
        this.change({ title });
      });
      t.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          (form.querySelectorAll<HTMLInputElement>(".edit-check-row")[0] ?? t).focus();
        }
      });
      form.append(t);
      rows.forEach((r, i) => {
        const input = document.createElement("input");
        input.className = "edit-check-row";
        input.placeholder = "Something to do";
        input.value = r.text;
        input.maxLength = LIMITS.row;
        input.addEventListener("input", () => {
          rows[i] = { ...rows[i], text: input.value };
          this.change({ rows: rows.map((x) => ({ ...x })) });
        });
        input.addEventListener("keydown", (e) => {
          const all = form.querySelectorAll<HTMLInputElement>(".edit-check-row");
          if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.stopPropagation();
            if (rows.length >= LIMITS.rows) return;
            rows.splice(i + 1, 0, { text: "", done: false });
            this.change({ rows: rows.map((x) => ({ ...x })) });
            this.resize(rows.length);
            render(i + 1);
          } else if (e.key === "Backspace" && input.value === "" && rows.length > 1) {
            e.preventDefault();
            e.stopPropagation();
            rows.splice(i, 1);
            this.change({ rows: rows.map((x) => ({ ...x })) });
            this.resize(rows.length);
            render(Math.max(0, i - 1));
          } else if (e.key === "ArrowDown" && all[i + 1]) {
            e.preventDefault();
            all[i + 1].focus();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            (all[i - 1] ?? t).focus();
          }
        });
        form.append(input);
      });
      for (const input of form.querySelectorAll<HTMLInputElement>("input")) this.keys(input, false);
      const target = focusRow === "title" ? t : form.querySelectorAll<HTMLInputElement>(".edit-check-row")[focusRow];
      if (target) {
        target.focus({ preventScroll: true });
        const p = at === "end" ? target.value.length : 0;
        target.setSelectionRange(p, p);
      }
      this.rebuilding = false;
    };
    this.resize(rows.length);
    render(row >= 0 ? row : it.title ? Math.max(0, rows.length - 1) : "title");
  }

  private resize(rows: number) {
    const view = this.id ? this.board.views.get(this.id) : null;
    if (!view) return;
    const h = checkHeight(rows);
    view.shape.style.height = `${h}px`;
    view.shape.style.top = `${-h / 2}px`;
    view.shape.style.width = `${CHECK.w}px`;
  }

  /** Apply what was typed here, and send it to the room a moment later. */
  private change(set: Partial<Item>) {
    if (!this.id) return;
    this.live = { ...this.live, ...set };
    this.board.state.apply({ op: "patch", id: this.id, set });
    const view = this.board.views.get(this.id);
    if (view) view.item = this.board.state.items.get(this.id)!;
    if (!this.sendTimer)
      this.sendTimer = window.setTimeout(() => {
        this.sendTimer = 0;
        this.flush();
      }, 140);
  }

  private flush() {
    if (!this.id || !Object.keys(this.live).length) return;
    this.board.link.ops([{ op: "patch", id: this.id, set: this.live }]);
  }

  /** Finish the edit, keeping what was typed. */
  commit() {
    if (!this.id || !this.before) return;
    clearTimeout(this.sendTimer);
    this.sendTimer = 0;
    const id = this.id;
    const before = this.before;
    const fresh = this.fresh;
    this.flush();
    this.close();
    const after = this.board.state.items.get(id);
    if (!after) return;
    if (fresh && isEmpty(after)) {
      // A new note left blank was never really there.
      this.board.commit([{ op: "del", id }], { history: false });
      this.board.setSelection([]);
      return;
    }
    if (fresh) this.board.remember([{ op: "del", id }], [{ op: "put", item: structuredClone(after) }]);
    else {
      const keys = Object.keys(after).filter((k) => JSON.stringify((after as never)[k]) !== JSON.stringify((before as never)[k])) as (keyof Item)[];
      if (keys.length) {
        const undoSet: Record<string, unknown> = {};
        const redoSet: Record<string, unknown> = {};
        for (const k of keys) {
          undoSet[k] = (before as never)[k];
          redoSet[k] = (after as never)[k];
        }
        this.board.remember([{ op: "patch", id, set: undoSet } as Op], [{ op: "patch", id, set: redoSet } as Op]);
      }
    }
    const view = this.board.views.get(id);
    view?.paint();
    this.board.chrome.onItems();
  }

  /** Stop editing without saving anything more (the item went away). */
  cancel() {
    clearTimeout(this.sendTimer);
    this.sendTimer = 0;
    this.close();
  }

  private close() {
    const id = this.id;
    this.id = null;
    this.before = null;
    this.live = {};
    this.host?.remove();
    this.host = null;
    const view = id ? this.board.views.get(id) : null;
    if (view) {
      view.editing = false;
      view.el.classList.remove("editing");
      view.paint();
    }
    this.board.link.presence({ edit: null });
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
}

function isEmpty(it: Item): boolean {
  if (it.type === "note" || it.type === "label") return it.text.trim() === "";
  if (it.type === "check") return it.title.trim() === "" && it.rows.every((r) => r.text.trim() === "");
  return false;
}
