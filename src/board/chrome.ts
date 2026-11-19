// The tool's own furniture, which stays put while the board moves: the top
// bar (whose board, who is here, share, export, zoom), the toolbar, the
// selection bar, the Tidy up button, toasts and the few dialogs.
import { PALETTE } from "../shared/colors";
import { ANY, DAY_HEADERS, DAY_NAMES, FROM_WORDS, NO_TIME, dateOf, dayPicked, findDay, findTime, formatTime, mondayOf, nextMonday, noteDay, noteTime, timePicked } from "../shared/days";
import { boardTitle, fileStem, toCsv, toIcs, toMarkdown } from "../shared/exporter";
import { PLAN_MAX_CHARS, linesToNotes, localIso } from "../shared/plan";
import { REACTIONS } from "../shared/schema";
import type { AdminAct, DeniedReason, NoteItem, PlanNote, PlanTrouble, ReactionKind } from "../shared/types";
import { escapeHtml, type Board, type Tool } from "./app";
import { boardLink, forgetBoard, recentBoards } from "./identity";
import type { LinkStatus } from "./net";
import { reactionIcon } from "./people";

const ICON = {
  select: '<path d="M6 3l0 16 4.5-4.2 3 6.6 3-1.4-3-6.4 6-.2z"/>',
  note: '<path d="M4 4h16v10l-6 6H4z" fill="none"/><path d="M14 20v-6h6" fill="none"/>',
  pen: '<path d="M4 20l1.5-5L16 4.5 19.5 8 9 18.5z" fill="none"/><path d="M14 6.5l3.5 3.5" fill="none"/>',
  text: '<path d="M5 5h14M12 5v15" fill="none"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none"/><path d="M8 12.5l3 3 5-6.5" fill="none"/>',
  hand: '<path d="M8 13V6.5a1.5 1.5 0 013 0V12m0-6.5V5a1.5 1.5 0 013 0v7m0-5.5a1.5 1.5 0 013 0V14c0 4-2.5 7-6 7-2.7 0-4.2-1.4-5.6-3.6L4.2 14.6a1.5 1.5 0 012.5-1.6L8 15" fill="none"/>',
  undo: '<path d="M9 7L4 12l5 5" fill="none"/><path d="M4 12h10a6 6 0 010 12" fill="none" transform="translate(0 -6)"/>',
  redo: '<path d="M15 7l5 5-5 5" fill="none"/><path d="M20 12H10a6 6 0 000 12" fill="none" transform="translate(0 -6)"/>',
  react: '<circle cx="12" cy="12" r="8.5" fill="none"/><path d="M8.5 14.5c1.8 2.2 5.2 2.2 7 0" fill="none"/><circle cx="9" cy="10" r="1.2"/><circle cx="15" cy="10" r="1.2"/>',
  share: '<path d="M12 15V4m0 0L8 8m4-4l4 4" fill="none"/><path d="M6 11v8h12v-8" fill="none"/>',
  export: '<rect x="4" y="5" width="16" height="15" rx="2" fill="none"/><path d="M4 10h16M9 3v4M15 3v4" fill="none"/>',
  vote: '<circle cx="12" cy="12" r="6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2" fill="none"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" fill="none"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none"/>',
  edit: '<path d="M4 20l1.5-5L16 4.5 19.5 8 9 18.5z" fill="none"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none"/>',
  day: '<rect x="4" y="5" width="16" height="15" rx="2" fill="none"/><path d="M4 10h16M9 3v4M15 3v4" fill="none"/><rect x="13" y="13" width="4" height="4" rx="0.5"/>',
  minus: '<path d="M5 12h14" fill="none"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2" fill="none"/><path d="M8.5 10.5V7.5a3.5 3.5 0 017 0v3" fill="none"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2" fill="none"/><path d="M8.5 10.5V7.5a3.5 3.5 0 016.8-1.2" fill="none"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" fill="none"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" fill="none"/>',
  key: '<circle cx="8" cy="15" r="4" fill="none"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2" fill="none"/>',
  gear: '<circle cx="12" cy="12" r="3" fill="none"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" fill="none"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none"/><circle cx="12" cy="12" r="3" fill="none"/>',
  device: '<rect x="6" y="3" width="12" height="18" rx="2.5" fill="none"/><path d="M10.5 18h3" fill="none"/>',
  chat: '<path d="M4.5 6.5h10a2 2 0 012 2v6a2 2 0 01-2 2H9.5l-3.5 3v-3H4.5a2 2 0 01-2-2v-6a2 2 0 012-2z" fill="none"/><path d="M19 2.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor" stroke="none"/><path d="M6 10.5h7M6 13h4.5" fill="none"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2" fill="none"/><path d="M4 10h16M9 3v4M15 3v4" fill="none"/><path d="M9 15l2 2 4-4" fill="none"/>',
};
const icon = (name: keyof typeof ICON) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${ICON[name]}</svg>`;

/** The product's mark: a long table with a seat for each person here. */
export function markSvg(colors: string[], size = 1) {
  const seats = (colors.length ? colors : ["#8E919C"]).slice(0, 5);
  const w = 42 * size;
  return `<svg class="mark" viewBox="0 0 42 22" width="${w}" height="${22 * size}" aria-hidden="true">${seats
    .map((c, i) => `<circle cx="${4 + i * 8.5}" cy="7" r="3" fill="${c}"/>`)
    .join("")}<rect x="0" y="13" width="42" height="6.5" rx="3.25" fill="#ECE9E2"/></svg>`;
}

const TOOLS: { tool: Tool; label: string; key: string; icon: keyof typeof ICON }[] = [
  { tool: "select", label: "Select and move", key: "V", icon: "select" },
  { tool: "note", label: "Sticky note", key: "N", icon: "note" },
  { tool: "pen", label: "Pen", key: "P", icon: "pen" },
  { tool: "text", label: "Heading", key: "T", icon: "text" },
  { tool: "check", label: "Checklist", key: "C", icon: "check" },
  { tool: "hand", label: "Hand (or hold Space)", key: "H", icon: "hand" },
];

export class Chrome {
  private top: HTMLElement;
  private toolbar: HTMLElement;
  private selbar: HTMLElement;
  private pill: HTMLButtonElement;
  private zoomBtn: HTMLButtonElement;
  private statusEl: HTMLElement;
  private toasts: HTMLElement;
  private hint: HTMLElement;
  private followEl: HTMLElement;
  private sortedEl: HTMLElement;
  private reactMenu: HTMLElement;
  private zoomMenu: HTMLElement;
  private whenMenu: HTMLElement;
  private boardsMenu: HTMLElement;
  private sortedTimers: number[] = [];
  private avatarsShown = new Set<string>();
  private gate: HTMLElement;
  /** Waiting for the room's answer to one of the owner's controls. */
  private waiting = new Map<AdminAct, (r: { ok: boolean; message?: string }) => void>();
  private viewOnlyAt = 0;
  /** The share or settings dialog while open, to redraw when access changes. */
  private panel: { redraw: () => void; close: () => void } | null = null;
  private gateTimer = 0;

  constructor(private board: Board) {
    const root = board.root;
    root.insertAdjacentHTML(
      "beforeend",
      `
      <header class="topbar">
        <a class="home" href="/" aria-label="Longtable home"><span class="mark-slot"></span></a>
        <div class="names">
          <span class="client" role="textbox" aria-label="Who the board is for" spellcheck="false"></span>
          <span class="slash">/</span>
          <span class="file" role="textbox" aria-label="Board name" spellcheck="false"></span>
        </div>
        <div class="right">
          <div class="avatars"></div>
          <button class="btn ghost share">${icon("share")}<span>Share</span></button>
          <button class="btn ghost export">${icon("export")}<span>Export week</span></button>
          <button class="zoom" aria-label="Zoom" aria-haspopup="menu">100%</button>
        </div>
      </header>
      <div class="menu zoom-menu" role="menu">
        <button data-z="in">${icon("plus")}Zoom in<kbd>+</kbd></button>
        <button data-z="out">${icon("minus")}Zoom out<kbd>−</kbd></button>
        <button data-z="fit">${icon("fit")}Zoom to fit<kbd>⇧1</kbd></button>
        <button data-z="100">100%<kbd>⇧0</kbd></button>
      </div>
      <nav class="toolbar" aria-label="Tools">
        ${TOOLS.map((t) => `<button class="tool" data-tool="${t.tool}" aria-label="${t.label} (${t.key})" title="${t.label} · ${t.key}">${icon(t.icon)}</button>`).join("")}
        <button class="tool plan" aria-label="Turn a chat into a plan" title="Paste a chat: it becomes notes with their days">${icon("chat")}</button>
        <span class="sep"></span>
        <button class="tool react" aria-label="React" title="React" aria-haspopup="menu">${icon("react")}</button>
        <span class="sep desk"></span>
        <button class="tool undo desk" aria-label="Undo" title="Undo · ⌘Z">${icon("undo")}</button>
        <button class="tool redo desk" aria-label="Redo" title="Redo · ⇧⌘Z">${icon("redo")}</button>
      </nav>
      <div class="menu react-menu" role="menu">${REACTIONS.map((k) => `<button data-react="${k}" aria-label="${k}">${reactionIcon(k, "#ECE9E2")}</button>`).join("")}</div>
      <div class="selbar" role="toolbar" aria-label="Selection"></div>
      <div class="menu when-menu" role="dialog" aria-label="Pick the day"></div>
      <div class="menu boards-menu" role="menu" aria-label="Your boards"></div>
      <button class="tidy-pill" aria-label="Tidy up"><span class="grid-icon"><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="pill-text"><b>Tidy up</b><small></small></span></button>
      <div class="status" aria-live="polite"></div>
      <div class="toasts" aria-live="polite"></div>
      <div class="empty-hint">
        <p class="big">Double-click anywhere to add a note.</p>
        <p>Name a day on it — Mon, Tue… or 周一 — or pick one, and <b>Tidy up</b> files it into that day.</p>
        <p>Got a group chat? <b>Paste it</b>: it turns into notes, with the days, times and who.</p>
      </div>
      <div class="follow-frame"><span></span></div>
      <div class="sorted" aria-live="polite"></div>
      <div class="demo-shield" aria-hidden="true"></div>
      <div class="corner"><span class="corner-tag"></span><button class="sample-btn" hidden></button><span class="demo-controls"></span></div>
      <div class="gate" hidden></div>
      <div class="demo-note" hidden role="status"><span><b>Only you can see this.</b> It’s the demo<span class="wide">: nothing here is saved or shared</span>.</span><button class="btn primary" data-demo="real">Make it a real board</button></div>
    `,
    );
    const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
    this.top = $(".topbar");
    this.toolbar = $(".toolbar");
    this.selbar = $(".selbar");
    this.pill = $(".tidy-pill");
    this.zoomBtn = $(".zoom");
    this.statusEl = $(".status");
    this.toasts = $(".toasts");
    this.hint = $(".empty-hint");
    this.followEl = $(".follow-frame");
    this.sortedEl = $(".sorted");
    this.reactMenu = $(".react-menu");
    this.zoomMenu = $(".zoom-menu");
    this.whenMenu = $(".when-menu");
    this.boardsMenu = $(".boards-menu");
    this.gate = $(".gate");

    // Names in the top bar are edited in place.
    for (const key of ["client", "file"] as const) {
      const span = this.top.querySelector<HTMLElement>(`.${key}`)!;
      span.addEventListener("click", () => {
        if (board.readOnly && !board.demo) return this.viewOnly();
        span.contentEditable = "plaintext-only";
        if (span.contentEditable !== "plaintext-only") span.contentEditable = "true";
        span.focus();
        document.getSelection()?.selectAllChildren(span);
      });
      span.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          if (e.key === "Escape") span.textContent = board.state.meta[key];
          span.blur();
        }
        e.stopPropagation();
      });
      span.addEventListener("blur", () => {
        span.contentEditable = "false";
        const v = (span.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
        if (v && v !== board.state.meta[key]) board.setMeta({ [key]: v });
        else span.textContent = board.state.meta[key];
      });
    }

    this.toolbar.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.dataset.tool) board.setTool(b.dataset.tool as Tool);
      else if (b.classList.contains("undo")) board.undo();
      else if (b.classList.contains("redo")) board.redo();
      else if (b.classList.contains("react")) this.openMenu(this.reactMenu, b);
      else if (b.classList.contains("plan")) this.planDialog();
    });
    this.reactMenu.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-react]");
      if (!b) return;
      board.react(b.dataset.react as ReactionKind);
      this.closeMenus();
    });
    this.zoomBtn.addEventListener("click", () => this.openMenu(this.zoomMenu, this.zoomBtn));
    this.zoomMenu.addEventListener("click", (e) => {
      const z = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.z;
      if (z === "in") board.zoomBy(1.25);
      else if (z === "out") board.zoomBy(0.8);
      else if (z === "fit") board.fitAll();
      else if (z === "100") board.cam.glideTo({ x: board.cam.x, y: board.cam.y, z: 1 }, 300);
      this.closeMenus();
    });
    document.addEventListener("pointerdown", (e) => {
      if (!(e.target as HTMLElement).closest(".menu, .react, .zoom, .day-tag, [data-act='day'], [data-demo='boards']")) this.closeMenus();
    });
    this.whenMenu.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.whenMenu.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.dataset.day) board.setWhen({ day: Number(b.dataset.day) });
      else if (b.dataset.time === "none") board.setWhen({ time: NO_TIME });
      else if (b.dataset.when === "words") board.setWhen({ day: FROM_WORDS, time: FROM_WORDS });
      else if (b.dataset.when === "done") return void this.closeMenus();
      this.renderWhen();
    });
    this.whenMenu.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.name === "time") {
        // Leave the field alone while it is being typed into: just apply it.
        const m = /^(\d{2}):(\d{2})/.exec(input.value);
        board.setWhen({ time: m ? Number(m[1]) * 60 + Number(m[2]) : NO_TIME });
        const none = this.whenMenu.querySelector<HTMLElement>("[data-time='none']");
        none?.classList.toggle("on", !m);
        none?.setAttribute("aria-pressed", String(!m));
        return;
      } else if (input.name === "week" && /^\d{4}-\d{2}-\d{2}$/.test(input.value)) {
        const weekOf = mondayOf(input.value);
        if (weekOf !== board.state.meta.weekOf) board.setMeta({ weekOf });
      }
      this.renderWhen();
    });
    this.whenMenu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeMenus();
      }
      e.stopPropagation();
    });
    $(".share").addEventListener("click", () => this.share());
    $(".export").addEventListener("click", () => this.exportWeek());
    this.pill.addEventListener("click", () => board.tidy());
    this.top.querySelector(".avatars")!.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>("[data-pid]");
      if (!a) return;
      if (a.dataset.pid === "me") this.askName(board.me.color, true);
      else board.follow(board.following === a.dataset.pid ? null : a.dataset.pid!);
    });
    this.followEl.addEventListener("click", () => board.follow(null));
    root.querySelector(".sample-btn")!.addEventListener("click", () => (board.sampleTeam.active ? board.sampleTeam.stop() : board.sampleTeam.start()));
    root.querySelector(".demo-note")!.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-demo='real']")) board.makeReal(true);
    });
    root.querySelector(".demo-controls")!.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.demo;
      if (act === "play") location.href = `/demo?back=${encodeURIComponent(location.pathname)}`;
      else if (act === "stop") board.demo?.stop();
      else if (act === "replay") board.demo?.start();
      // Changed the demo? Your changes come along. Untouched? A fresh copy of the example, to tidy yourself.
      else if (act === "own") board.demo?.edited ? board.makeReal(false) : (location.href = "/new?template=pell-and-rye");
      else if (act === "blank") location.href = "/new?template=blank";
      else if (act === "boards") this.openBoards((e.target as HTMLElement).closest("button")!);
      else if (act === "back") location.href = demoBack() ?? "/";
    });
    let shieldNoticed = false;
    root.querySelector(".demo-shield")!.addEventListener("pointerdown", () => {
      if (shieldNoticed) return;
      shieldNoticed = true;
      this.toast("The demo is playing. Press Stop (or Esc) to try the board yourself.");
    });
    this.onDemo();
    this.selbar.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.selbar.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      const act = b.dataset.act;
      if (b.dataset.color) board.recolor(b.dataset.color);
      else if (act === "vote") board.toggleVote();
      else if (act === "day") this.openWhen(b);
      else if (act === "tidy") board.tidy();
      else if (act === "dup") board.duplicate([...board.sel]);
      else if (act === "del") board.deleteSelected();
      else if (act === "edit") {
        const [only] = board.sel;
        if (only) board.editor.open(only);
      }
    });
    this.onTool();
    this.onHistory();
  }

  private openMenu(menu: HTMLElement, by: HTMLElement) {
    const open = menu.classList.contains("open");
    this.closeMenus();
    if (open) return;
    const r = by.getBoundingClientRect();
    const phone = innerWidth < 700;
    menu.classList.add("open");
    const m = menu.getBoundingClientRect();
    let left = phone || menu === this.zoomMenu ? r.right - m.width : r.right + 10;
    let top = phone ? r.top - m.height - 10 : menu === this.zoomMenu ? r.bottom + 8 : r.top + r.height / 2 - m.height / 2;
    if (menu === this.reactMenu && phone) left = Math.max(8, Math.min(innerWidth - m.width - 8, r.left + r.width / 2 - m.width / 2));
    left = Math.max(8, Math.min(innerWidth - m.width - 8, left));
    top = Math.max(8, top);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  /** Close every open menu; says whether one was open. */
  closeMenus(): boolean {
    const open = [this.reactMenu, this.zoomMenu, this.boardsMenu].some((m) => m.classList.contains("open"));
    this.reactMenu.classList.remove("open");
    this.zoomMenu.classList.remove("open");
    this.boardsMenu.classList.remove("open");
    return this.closeWhen() || open;
  }

  /** Close the day picker if it is open; says whether it was. */
  closeWhen(): boolean {
    const open = this.whenMenu.classList.contains("open");
    this.whenMenu.classList.remove("open");
    // Focus left in the hidden picker would swallow the board's shortcuts.
    if (document.activeElement instanceof HTMLElement && this.whenMenu.contains(document.activeElement)) document.activeElement.blur();
    return open;
  }

  /**
   * The day picker for the selected notes: the seven days of the board's week
   * with their dates, "any day", a time, and the week itself.
   */
  openWhen(by?: HTMLElement) {
    const notes = this.board.selected().filter((it) => it.type === "note");
    if (!notes.length) {
      if (this.board.sel.size) this.toast("Pick a day for notes: select a note first.");
      return;
    }
    this.board.editor.commit();
    this.closeMenus();
    this.renderWhen();
    this.whenMenu.classList.add("open");
    const m = this.whenMenu.getBoundingClientRect();
    const anchor = by ?? this.selbar.querySelector<HTMLElement>("[data-act='day']") ?? this.selbar;
    const r = anchor.getBoundingClientRect();
    let left = r.left + r.width / 2 - m.width / 2;
    let top = r.bottom + 10;
    if (top + m.height > innerHeight - 8) top = r.top - m.height - 10;
    left = Math.max(8, Math.min(innerWidth - m.width - 8, left));
    top = Math.max(8, Math.min(innerHeight - m.height - 8, top));
    this.whenMenu.style.left = `${Math.round(left)}px`;
    this.whenMenu.style.top = `${Math.round(top)}px`;
    this.whenMenu.querySelector<HTMLButtonElement>("button.on, [data-day]")?.focus({ preventScroll: true });
  }

  private renderWhen() {
    const b = this.board;
    const notes = b.selected().filter((it): it is NoteItem => it.type === "note");
    if (!notes.length) return this.closeMenus();
    const weekOf = b.state.meta.weekOf || nextMonday();
    const days = notes.map(noteDay);
    const day = days.every((d) => d === days[0]) ? days[0] : undefined;
    const times = notes.map(noteTime);
    const time = times.every((t) => t === times[0]) ? times[0] : undefined;
    const byHand = notes.some((n) => dayPicked(n) || timePicked(n));
    const fromWords = notes.every((n) => !dayPicked(n));
    const cell = (i: number) => {
      const on = day !== undefined && (i === ANY ? day === null : day === i);
      const label = i === ANY ? "Any day" : `${DAY_NAMES[i]} ${dateOf(weekOf, i).getDate()}`;
      return `<button data-day="${i}" class="${on ? "on" : ""}${on && fromWords ? " auto" : ""}" aria-pressed="${on}" aria-label="${label}"><b>${i === ANY ? "ANY" : DAY_HEADERS[i]}</b><small>${i === ANY ? "day" : dateOf(weekOf, i).getDate()}</small></button>`;
    };
    let hint = "";
    if (notes.length === 1) {
      const n = notes[0];
      const named = findDay(n.text);
      if (dayPicked(n)) hint = "Picked by hand: this wins over the words on the note.";
      else if (named) hint = `Read from “${escapeHtml(n.text.slice(named.index, named.index + named.length))}” on the note. Pick a day to change it.`;
      else hint = "The note names no day yet, so it goes under ANY DAY. Pick one.";
    } else hint = `${notes.length} notes selected: a day you pick applies to all of them.`;
    const month = dateOf(weekOf, 0).toLocaleString("en-GB", { month: "short" });
    this.whenMenu.innerHTML =
      `<div class="when-top"><b>Day</b><label class="when-week">Week of <input type="date" name="week" value="${weekOf}" aria-label="Week starting"></label></div>` +
      `<div class="when-days" aria-label="Days of the week of ${dateOf(weekOf, 0).getDate()} ${month}">${[0, 1, 2, 3, 4, 5, 6, ANY].map(cell).join("")}</div>` +
      `<div class="when-time"><label>Time <input type="time" name="time" step="300" value="${time !== undefined && time !== null ? formatTime(time) : ""}"></label>` +
      `<button data-time="none" class="${time === null ? "on" : ""}" aria-pressed="${time === null}">No time</button></div>` +
      `<p class="when-hint">${hint}</p>` +
      `<div class="when-foot">${byHand ? `<button data-when="words">Read from the words again</button>` : "<span></span>"}<button data-when="done" class="done">Done</button></div>`;
  }

  // ---------------------------------------------------------------- updates
  onMeta() {
    const m = this.board.state.meta;
    const client = this.top.querySelector<HTMLElement>(".client")!;
    const file = this.top.querySelector<HTMLElement>(".file")!;
    if (document.activeElement !== client) client.textContent = m.client;
    if (document.activeElement !== file) file.textContent = m.file;
    document.title = m.template === "demo" ? "Longtable · plan it together" : `${[m.client, m.file].filter(Boolean).join(" / ") || "Board"} · Longtable`;
    const tag = this.board.root.querySelector<HTMLElement>(".corner-tag")!;
    tag.textContent =
      this.board.access?.role === "viewer"
        ? "WATCHING · THIS LINK CAN’T CHANGE THE BOARD"
        : m.template === "pell-and-rye"
          ? "EXAMPLE BOARD · PELL & RYE IS A FICTIONAL BAKERY"
          : m.template === "demo"
            ? "DEMO · NOTHING HERE IS SAVED · PELL & RYE IS A FICTIONAL BAKERY"
            : "";
    tag.hidden = !tag.textContent;
    this.onSampleTeam();
  }

  onPeople() {
    const b = this.board;
    const others = [...b.people.all.values()];
    const colors = [b.me.color, ...others.map((p) => p.color)];
    this.top.querySelector(".mark-slot")!.innerHTML = markSvg(colors);
    const max = innerWidth < 700 ? 2 : 6;
    const shown = others.slice(0, max);
    const extra = others.length - shown.length;
    const seen = this.avatarsShown;
    this.avatarsShown = new Set(["me", ...others.map((p) => p.pid)]);
    const av = (pid: string, name: string, color: string, me = false, watching = false) =>
      `<button class="avatar${me ? " me" : ""}${watching ? " watching" : ""}${seen.has(me ? "me" : pid) ? "" : " new"}${b.following === pid ? " followed" : ""}" data-pid="${me ? "me" : pid}" style="--c:${color}" title="${me ? `You (${escapeHtml(name || "Guest")}) · change name or colour` : `${escapeHtml(name)}${watching ? " · watching" : ""} · click to follow`}" aria-label="${me ? "You" : `Follow ${escapeHtml(name)}`}">${escapeHtml((name || "?").trim().charAt(0).toUpperCase() || "?")}</button>`;
    this.top.querySelector(".avatars")!.innerHTML =
      shown.map((p) => av(p.pid, p.name, p.color, false, !!p.view)).join("") +
      (extra > 0 ? `<span class="avatar more">+${extra}</span>` : "") +
      av("me", b.me.name, b.me.color, true, b.access?.role === "viewer");
  }

  onItems() {
    const items = this.board.state.items;
    let notes = 0;
    for (const it of items.values()) if (it.type === "note") notes++;
    this.hint.classList.toggle("show", this.board.ready && items.size === 0);
    this.pill.classList.toggle("show", notes > 0);
    this.updatePill();
  }

  private updatePill() {
    const selNotes = this.board.selected().filter((it) => it.type === "note").length;
    const small = this.pill.querySelector("small")!;
    small.textContent = selNotes ? `${selNotes} selected note${selNotes === 1 ? "" : "s"}` : "the whole board";
  }

  onSelection() {
    this.updatePill();
    if (this.whenMenu.classList.contains("open") && !this.whenMenu.contains(document.activeElement)) this.renderWhen();
    const items = this.board.selected();
    if (!items.length || this.board.editor.id) {
      this.selbar.classList.remove("show");
      this.board.root.classList.remove("has-selection");
      return;
    }
    const notes = items.filter((it) => it.type === "note");
    const colorable = items.some((it) => it.type === "note" || it.type === "stroke" || it.type === "check");
    const myVote = notes.length > 0 && notes.every((n) => n.type === "note" && n.votes?.[this.board.me.cid]);
    const editable = items.length === 1 && items[0].type !== "stroke" && items[0].type !== "week";
    this.selbar.innerHTML =
      (colorable ? `<div class="swatches">${PALETTE.map((c) => `<button data-color="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join("")}</div><span class="sep"></span>` : "") +
      (notes.length ? `<button data-act="vote" class="${myVote ? "on" : ""}" title="Vote" style="--me:${this.board.me.color}">${icon("vote")}<span>${myVote ? "Voted" : "Vote"}</span></button>` : "") +
      (notes.length ? `<button data-act="day" title="Pick the day · D" aria-haspopup="dialog">${icon("day")}<span>${escapeHtml(this.dayButtonLabel(notes as NoteItem[]))}</span></button>` : "") +
      (editable ? `<button data-act="edit" class="phone-only" title="Edit">${icon("edit")}<span>Edit</span></button>` : "") +
      (notes.length ? `<button data-act="tidy" title="Tidy these up">${icon("fit")}<span>Tidy</span></button>` : "") +
      `<button data-act="dup" title="Duplicate · ⌘D" aria-label="Duplicate">${icon("copy")}</button>` +
      `<button data-act="del" title="Delete · ⌫" aria-label="Delete">${icon("trash")}</button>`;
    this.selbar.classList.add("show");
    this.board.root.classList.toggle("has-selection", true);
    this.placeSelectionBar();
  }

  private dayButtonLabel(notes: NoteItem[]): string {
    const days = notes.map(noteDay);
    if (!days.every((d) => d === days[0])) return "Day";
    const d = days[0];
    if (d === null) return notes.some(dayPicked) ? "Any day" : "Day";
    const weekOf = this.board.state.meta.weekOf;
    return weekOf ? `${DAY_HEADERS[d].charAt(0)}${DAY_HEADERS[d].slice(1).toLowerCase()} ${dateOf(weekOf, d).getDate()}` : DAY_NAMES[d];
  }

  placeSelectionBar() {
    if (!this.selbar.classList.contains("show")) return;
    const box = this.board.selectionBox();
    if (!box || this.board.root.classList.contains("dragging") || this.board.editor.id) {
      this.selbar.style.opacity = "0";
      return;
    }
    this.selbar.style.opacity = "";
    const cam = this.board.cam;
    if (cam.w < 700) {
      // On a phone the bar docks above the toolbar instead of following.
      this.selbar.style.transform = "";
      return;
    }
    const [x0, y0] = cam.toScreen(box.x0, box.y0);
    const [x1, y1] = cam.toScreen(box.x1, box.y1);
    const w = this.selbar.offsetWidth;
    const h = this.selbar.offsetHeight;
    let left = (x0 + x1) / 2 - w / 2;
    let top = y0 - h - 16;
    if (top < 70) top = y1 + 16;
    left = Math.max(this.board.insets().left, Math.min(cam.w - w - 10, left));
    top = Math.max(70, Math.min(cam.h - h - 90, top));
    this.selbar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  onTool() {
    for (const b of this.toolbar.querySelectorAll<HTMLButtonElement>("[data-tool]")) b.classList.toggle("active", b.dataset.tool === this.board.tool);
  }

  onHistory() {
    this.toolbar.querySelector<HTMLButtonElement>(".undo")!.disabled = !this.board.canUndo;
    this.toolbar.querySelector<HTMLButtonElement>(".redo")!.disabled = !this.board.canRedo;
  }

  onCamera() {
    this.zoomBtn.textContent = `${Math.round(this.board.cam.z * 100)}%`;
    this.placeSelectionBar();
  }

  onFollow() {
    const pid = this.board.following;
    const s = pid ? this.board.people.all.get(pid) : null;
    this.followEl.classList.toggle("show", !!s);
    if (s) {
      this.followEl.style.setProperty("--c", s.color);
      this.followEl.querySelector("span")!.textContent = `Following ${s.name} · click or Esc to stop`;
    }
    this.onPeople();
  }

  /** The button that brings in (or sends away) the sample teammates. */
  onSampleTeam() {
    const btn = this.board.root.querySelector<HTMLButtonElement>(".sample-btn")!;
    const on = this.board.sampleTeam.active;
    btn.hidden = this.board.state.meta.template !== "pell-and-rye" && !on;
    btn.classList.toggle("on", on);
    btn.innerHTML = on
      ? `<i class="live"></i>Sample teammates on · stop`
      : `${markSvg(PALETTE.slice(1, 5), 0.6)}Add sample teammates`;
    btn.title = on ? "They only appear on your screen and never change the board." : "Four made-up people wander this board on your screen only, so you can see what planning together looks like.";
  }

  /**
   * The demo's buttons in the corner. On a board: play the demo. On the demo
   * (the front page): stop it while it plays; then replay it, make a board of
   * your own (the example or a blank one), or go to one of yours.
   */
  onDemo() {
    const slot = this.board.root.querySelector<HTMLElement>(".demo-controls")!;
    const demo = this.board.demo;
    const play = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2.5 1.5v9l8-4.5z" fill="currentColor"/></svg>';
    const stop = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';
    const caret = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    this.board.root.classList.toggle("demo-playing", !!demo?.playing);
    const note = this.board.root.querySelector<HTMLElement>(".demo-note")!;
    note.hidden = !demo || demo.playing || !demo.edited;
    if (!demo) {
      slot.innerHTML = `<button class="sample-btn demo-btn" data-demo="play" title="Watch five made-up people plan a week on a board of its own, then tidy it">${play}Play the demo</button>`;
      return;
    }
    const back = demoBack();
    const mine = !back && recentBoards().length > 0 ? `<button class="sample-btn demo-btn" data-demo="boards" aria-haspopup="menu"><span class="wide">Your boards</span><span class="narrow">Boards</span>${caret}</button>` : "";
    slot.innerHTML = demo.playing
      ? `<button class="sample-btn demo-btn on" data-demo="stop" title="Stop and try the board yourself · Esc">${stop}Stop demo</button>` + mine
      : `<button class="sample-btn demo-btn" data-demo="replay">${play}${demo.played ? `Replay<span class="wide"> demo</span>` : `Play<span class="wide"> the demo</span>`}</button>` +
        `<button class="sample-btn demo-btn primary" data-demo="own"><span class="wide">Make your own board</span><span class="narrow">Your own</span></button>` +
        `<button class="sample-btn demo-btn" data-demo="blank">Blank<span class="wide"> board</span></button>` +
        mine +
        (back ? `<button class="sample-btn demo-btn" data-demo="back">Back<span class="wide"> to your board</span></button>` : "");
  }

  /** The boards you have opened on this device, as a menu above the button. */
  private openBoards(by: HTMLElement) {
    const open = this.boardsMenu.classList.contains("open");
    this.closeMenus();
    if (open) return;
    const when = (at: number) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    this.boardsMenu.innerHTML = recentBoards()
      .map((r) => `<a href="/b/${escapeHtml(r.id)}" role="menuitem"><span>${escapeHtml(r.title || "Untitled board")}</span><time>${when(r.at)}</time></a>`)
      .join("");
    this.boardsMenu.classList.add("open");
    const r = by.getBoundingClientRect();
    const m = this.boardsMenu.getBoundingClientRect();
    let top = r.top - m.height - 8;
    if (top < 8) top = r.bottom + 8;
    this.boardsMenu.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - m.width - 8, r.left)))}px`;
    this.boardsMenu.style.top = `${Math.round(top)}px`;
  }

  setStatus(s: LinkStatus) {
    this.statusEl.className = `status ${s}`;
    this.statusEl.textContent = s === "online" ? "" : s === "connecting" ? "Connecting…" : "Offline: your changes will sync when the connection is back";
  }

  toast(text: string, color?: string) {
    const t = document.createElement("div");
    t.className = "toast";
    if (color) t.style.setProperty("--c", color);
    t.innerHTML = `${color ? '<i class="dot"></i>' : ""}<span>${escapeHtml(text)}</span>`;
    this.toasts.append(t);
    setTimeout(() => t.classList.add("out"), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  /** The closing line after a tidy: "Opening week, sorted." rising word by word. */
  sorted(file: string, count: number, afterMs: number, mine: boolean) {
    const words = `${file.trim() || "The week"}, sorted.`.split(" ");
    this.sortedEl.innerHTML =
      `<div class="line">${words.map((w, i) => `<span style="--i:${i}">${escapeHtml(w)}</span>`).join(" ")}</div>` +
      `<div class="sub">${markSvg(PALETTE.slice(0, 5), 1.1)}<span>${count} note${count === 1 ? "" : "s"} into the week${mine ? "" : " · tidied by someone else"}</span></div>`;
    this.clearSorted();
    this.sortedTimers.push(
      window.setTimeout(() => {
        void this.sortedEl.offsetWidth;
        this.sortedEl.classList.add("show");
      }, Math.max(0, afterMs - 250)),
      window.setTimeout(() => this.sortedEl.classList.add("out"), afterMs + 2600),
    );
  }

  /** Take the closing line away, and any still waiting to show. */
  clearSorted() {
    for (const t of this.sortedTimers) clearTimeout(t);
    this.sortedTimers = [];
    this.sortedEl.classList.remove("show", "out");
  }

  // ---------------------------------------------------------------- dialogs
  private dialog(html: string, cls = ""): { el: HTMLElement; close: () => void } {
    const wrap = document.createElement("div");
    wrap.className = `dialog ${cls}`;
    wrap.innerHTML = `<div class="scrim"></div><div class="card" role="dialog" aria-modal="true">${html}</div>`;
    this.board.root.append(wrap);
    requestAnimationFrame(() => wrap.classList.add("open"));
    const close = () => {
      wrap.classList.remove("open");
      setTimeout(() => wrap.remove(), 200);
      removeEventListener("keydown", onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      // Only the dialog on top closes.
      const open = [...this.board.root.querySelectorAll(".dialog.open")];
      if (open[open.length - 1] === wrap || !wrap.classList.contains("open")) close();
    };
    addEventListener("keydown", onKey, true);
    wrap.querySelector(".scrim")!.addEventListener("click", close);
    wrap.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
    wrap.addEventListener("pointerdown", (e) => e.stopPropagation());
    return { el: wrap, close };
  }

  askName(suggested: string, editing = false) {
    const b = this.board;
    let color = editing ? b.me.color : suggested;
    const d = this.dialog(
      `
      <h2>${editing ? "Your name and colour" : "Who’s planning?"}</h2>
      <p class="muted">Your name rides on your cursor and on the notes you write. Your colour is your notes’ colour.</p>
      <form class="join">
        <input name="name" autocomplete="nickname" maxlength="32" placeholder="Your name" value="${escapeHtml(b.me.name)}" required />
        <div class="swatches big">${PALETTE.map((c) => `<button type="button" data-c="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join("")}</div>
        <div class="actions">
          ${editing ? '<button type="button" class="btn ghost" data-close>Cancel</button>' : '<button type="button" class="btn ghost" data-close>Just look around</button>'}
          <button class="btn primary" type="submit">${editing ? "Save" : "Join the board"}</button>
        </div>
      </form>`,
      "join-dialog",
    );
    const form = d.el.querySelector("form")!;
    const input = form.querySelector("input")!;
    const paint = () => form.querySelectorAll<HTMLButtonElement>("[data-c]").forEach((s) => s.classList.toggle("on", s.dataset.c === color));
    paint();
    form.querySelector(".swatches")!.addEventListener("click", (e) => {
      const s = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-c]");
      if (!s) return;
      color = s.dataset.c!;
      paint();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input.value.replace(/\s+/g, " ").trim().slice(0, 32);
      if (!name) return input.focus();
      b.setIdentity(name, color);
      d.close();
    });
    setTimeout(() => input.focus(), 60);
  }

  share() {
    const b = this.board;
    const a = b.access;
    this.panel?.close();
    if (!a || a.local) return this.shareLocal();
    const d = this.dialog("", "share-dialog");
    const card = d.el.querySelector(".card")!;
    const row = (label: string, url: string, what: string, note: string) => `
      <div class="share-link">
        <div class="share-label"><b>${label}</b><span>${note}</span></div>
        <div class="linkrow"><input readonly value="${escapeHtml(url)}" aria-label="${label} link"/><button class="btn ${what === "edit" ? "primary" : ""} copy" data-url="${escapeHtml(url)}">Copy</button></div>
      </div>`;
    const redraw = () => {
      const a = b.access;
      if (!a) return d.close();
      const edit = a.edit ? boardLink(b.id, "k", a.edit) : null;
      const view = boardLink(b.id, "v", a.view);
      card.innerHTML = `
        <h2>Share this board</h2>
        <p class="muted">Only people with a link get in: boards aren’t listed or searchable anywhere, and the key in the link never reaches the server’s logs.</p>
        ${edit ? row("Can edit", edit, "edit", "Anyone with this link can change the board.") : ""}
        ${row("Can watch", view, "view", "Sees it all live and can react, but can’t change anything.")}
        <div class="share-status ${a.password ? "on" : ""}">${icon(a.password ? "lock" : "unlock")}<span>${
          a.password ? "<b>Password on.</b> Send it separately from the link." : "<b>No password:</b> the link is enough to get in."
        }</span>${a.role === "owner" ? `<button class="linkish" data-act="pw">${a.password ? "Change" : "Add one"}</button>` : ""}</div>
        ${
          b.state.meta.template === "pell-and-rye" && a.role !== "viewer"
            ? `<p class="tip"><b>Trying it on your own?</b> Open the link in a second window and watch your other self’s cursor arrive, or add sample teammates: four made-up people who wander the board on your screen only.</p>`
            : ""
        }
        <div class="actions wrap">
          <button class="btn ghost" data-act="settings">${icon("gear")}<span>Board settings</span></button>
          ${b.state.meta.template === "pell-and-rye" && a.role !== "viewer" ? `<button class="btn ghost sample">${b.sampleTeam.active ? "Stop sample teammates" : "Add sample teammates"}</button>` : ""}
          <button class="btn primary" data-close>Done</button>
        </div>`;
      card.querySelectorAll<HTMLInputElement>("input[readonly]").forEach((input) => input.addEventListener("focus", () => input.select()));
      card.querySelector("[data-close]")!.addEventListener("click", d.close);
    };
    card.addEventListener("click", async (e) => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!t) return;
      if (t.classList.contains("copy")) await this.copy(t.dataset.url!, "Link copied");
      else if (t.classList.contains("sample")) {
        if (b.sampleTeam.active) b.sampleTeam.stop();
        else b.sampleTeam.start();
        d.close();
      } else if (t.dataset.act === "settings") {
        d.close();
        this.settings();
      } else if (t.dataset.act === "pw") this.passwordDialog();
    });
    redraw();
    this.track(d, redraw);
  }

  /** The share dialog of a board kept in this browser (development, or the demo). */
  private shareLocal() {
    const b = this.board;
    if (b.demo) {
      b.demo.stop();
      const d = this.dialog(
        `
        <h2>Share this board</h2>
        <p class="muted">This is the demo. It runs in this tab only, so anyone you send this page to just gets the demo from the start, not your board.</p>
        <p class="muted">Make it a real board first: everything on it now comes along, it’s saved, and you get a link that brings people onto it with you, live.</p>
        <div class="actions wrap"><button class="btn ghost" data-close>Cancel</button><a class="btn ghost" href="/new?template=blank">Start a blank board</a><button class="btn primary" data-act="real">Make it a real board and share</button></div>`,
        "share-dialog demo-share",
      );
      d.el.querySelector("[data-act='real']")!.addEventListener("click", () => b.makeReal(true));
      return;
    }
    const url = location.href.split("#")[0].split("?")[0];
    const d = this.dialog(`
      <h2>Plan it together</h2>
      <p class="muted">This board is kept in this browser only (no server is running), so its link opens it in this browser’s other tabs.</p>
      <div class="linkrow"><input readonly value="${escapeHtml(url)}" aria-label="Board link"/><button class="btn primary copy">Copy link</button></div>
      <div class="actions"><button class="btn ghost" data-act="settings">Board settings</button><button class="btn ghost" data-close>Done</button></div>
    `);
    d.el.querySelector(".copy")!.addEventListener("click", () => this.copy(url, "Link copied"));
    d.el.querySelector("[data-act='settings']")?.addEventListener("click", () => {
      d.close();
      this.settings();
    });
  }

  private async copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      t.style.cssText = "position:fixed;opacity:0";
      document.body.append(t);
      t.select();
      document.execCommand?.("copy");
      t.remove();
    }
    this.toast(done);
  }

  private track(d: { el: HTMLElement; close: () => void }, redraw: () => void) {
    const panel = {
      redraw,
      close: d.close,
    };
    this.panel = panel;
    const close = d.close;
    d.close = () => {
      if (this.panel === panel) this.panel = null;
      close();
    };
    panel.close = d.close;
    d.el.querySelector(".scrim")!.addEventListener("click", () => this.panel === panel && (this.panel = null));
  }

  /** Board settings: the owner's password, links, owner link, clear and delete; for everyone, forgetting it here. */
  settings() {
    const b = this.board;
    this.panel?.close();
    const d = this.dialog("", "settings-dialog");
    const card = d.el.querySelector(".card")!;
    const redraw = () => {
      const a = b.access;
      if (!a) return d.close();
      const owner = a.role === "owner";
      const lede = a.local
        ? "This board is kept in this browser only. Passwords, links and owners come with a deployed Longtable."
        : owner
          ? "You own this board: only you can change the password and links, or delete it."
          : a.role === "editor"
            ? "You can change this board. Its owner (whoever made it) looks after its password and links."
            : "You’re watching this board: you see every change live, but this link can’t change anything.";
      card.innerHTML = `
        <h2>Board settings</h2>
        <p class="muted">${lede}</p>
        ${
          owner && !a.local
            ? `
        <section class="set">
          <h3>${icon("lock")}Password</h3>
          <p>${a.password ? "On. Anyone with a link also needs the password, once per device. You don’t, as the owner." : "Off. Anyone with a link can open the board."}</p>
          <div class="row">${a.password ? '<button class="btn" data-act="pw">Change the password</button><button class="btn ghost" data-act="pw-off">Turn it off</button>' : '<button class="btn" data-act="pw">Set a password</button>'}</div>
        </section>
        <section class="set">
          <h3>${icon("link")}Links</h3>
          <p>If a link reached someone it shouldn’t, make new ones. The old links stop working at once, and everyone but you leaves the board until they get a new one.</p>
          <div class="row"><button class="btn" data-act="links">Make new links</button></div>
        </section>
        <section class="set">
          <h3>${icon("key")}Your owner link</h3>
          <p>Opens the board as its owner, to manage it from another device. Keep it to yourself: whoever has it can change the password or delete the board.</p>
          <div class="row"><button class="btn" data-act="owner-link">Copy the owner link</button></div>
        </section>`
            : ""
        }
        ${
          owner
            ? `
        <section class="set danger">
          <h3>${icon("trash")}Clear or delete</h3>
          <p>Clearing takes everything off the board, for everyone; Undo brings it back. Deleting removes the board and everything on it from the ${a.local ? "browser" : "server"} for good${a.local ? "" : ", and its links stop working"}.</p>
          <div class="row"><button class="btn" data-act="clear">Clear the board</button><button class="btn danger" data-act="delete">Delete the board…</button></div>
        </section>`
            : ""
        }
        ${
          a.local
            ? ""
            : `
        <section class="set">
          <h3>${icon("device")}This device</h3>
          <p>This browser keeps the board’s key${a.password && !owner ? " and your way past the password" : ""}, so it opens again from Your boards. Forget it to take the board off this device${owner ? ", including your owner key" : ""}; you’ll need a link to come back.</p>
          <div class="row"><button class="btn ghost" data-act="forget">Forget this board here</button></div>
        </section>`
        }
        <div class="actions"><button class="btn primary" data-close>Done</button></div>`;
      card.querySelector("[data-close]")!.addEventListener("click", d.close);
    };
    card.addEventListener("click", async (e) => {
      const act = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.act;
      if (act === "pw") this.passwordDialog();
      else if (act === "pw-off") {
        const r = await this.ask("password", () => b.link.admin("password", null));
        this.toast(r.ok ? "Password off: a link alone opens the board now." : (r.message ?? "That didn’t work."));
      } else if (act === "links") this.newLinksDialog();
      else if (act === "owner-link" && b.keys.owner) await this.copy(boardLink(b.id, "o", b.keys.owner), "Owner link copied: keep it to yourself");
      else if (act === "clear") this.clearDialog();
      else if (act === "delete") this.deleteDialog();
      else if (act === "forget") this.forgetDialog();
    });
    redraw();
    this.track(d, redraw);
  }

  /** Ask the room to do one of the owner's controls; resolves with its answer. */
  private ask(act: AdminAct, run: () => void): Promise<{ ok: boolean; message?: string }> {
    return new Promise((resolve) => {
      this.waiting.get(act)?.({ ok: false });
      this.waiting.set(act, resolve);
      run();
    });
  }

  onDone(act: AdminAct, ok: boolean, message?: string) {
    const w = this.waiting.get(act);
    this.waiting.delete(act);
    if (w) w({ ok, message });
    else if (!ok && message) this.toast(message);
  }

  private passwordDialog() {
    const b = this.board;
    const had = !!b.access?.password;
    const d = this.dialog(
      `
      <h2>${had ? "Change the password" : "Set a password"}</h2>
      <p class="muted">${had ? "Everyone but you will be asked for the new one, including whoever is on the board now." : "People who open a link will be asked for it, once per device. Whoever is on the board now, except you, is asked straight away."} Send it separately from the link.</p>
      <form class="pw-form">
        <label class="field"><span>${had ? "New password" : "Password"}</span><input type="password" name="pw" minlength="6" maxlength="200" autocomplete="new-password" required placeholder="At least 6 characters" /></label>
        <label class="reveal"><input type="checkbox" name="show" /> Show it</label>
        <p class="form-error" aria-live="polite"></p>
        <div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">${had ? "Change it" : "Set the password"}</button></div>
      </form>`,
      "pw-dialog",
    );
    const form = d.el.querySelector("form")!;
    const input = form.querySelector<HTMLInputElement>("input[name=pw]")!;
    const err = form.querySelector(".form-error")!;
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    form.querySelector<HTMLInputElement>("input[name=show]")!.addEventListener("change", (e) => (input.type = (e.target as HTMLInputElement).checked ? "text" : "password"));
    input.addEventListener("keydown", (e) => e.stopPropagation());
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw = input.value;
      if (pw.length < 6) {
        err.textContent = "Make it at least 6 characters.";
        return input.focus();
      }
      submit.disabled = true;
      submit.textContent = "Saving…";
      const r = await this.ask("password", () => b.link.admin("password", pw));
      if (r.ok) {
        d.close();
        this.toast(had ? "Password changed: everyone else needs the new one." : "Password on: everyone else needs it to get in.");
      } else {
        err.textContent = r.message ?? "That didn’t work. Try again.";
        submit.disabled = false;
        submit.textContent = had ? "Change it" : "Set the password";
      }
    });
    setTimeout(() => input.focus(), 60);
  }

  private confirm(opts: { title: string; body: string; yes: string; danger?: boolean; typed?: string }): Promise<boolean> {
    return new Promise((resolve) => {
      let answered = false;
      const d = this.dialog(
        `
        <h2>${opts.title}</h2>
        <p class="muted">${opts.body}</p>
        ${opts.typed ? `<label class="field"><span>Type <b>${opts.typed}</b> to confirm</span><input name="typed" autocomplete="off" spellcheck="false" /></label>` : ""}
        <div class="actions"><button class="btn ghost" data-close>Cancel</button><button class="btn ${opts.danger ? "danger" : "primary"} yes"${opts.typed ? " disabled" : ""}>${opts.yes}</button></div>`,
        "confirm-dialog",
      );
      const yes = d.el.querySelector<HTMLButtonElement>(".yes")!;
      const typed = d.el.querySelector<HTMLInputElement>("input[name=typed]");
      typed?.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !yes.disabled) yes.click();
      });
      typed?.addEventListener("input", () => (yes.disabled = typed.value.trim().toLowerCase() !== opts.typed));
      const close = d.close;
      d.close = () => {
        close();
        if (!answered) resolve(false);
        answered = true;
      };
      d.el.querySelectorAll("[data-close], .scrim").forEach((x) => x.addEventListener("click", () => !answered && ((answered = true), resolve(false))));
      yes.addEventListener("click", () => {
        answered = true;
        resolve(true);
        close();
      });
      setTimeout(() => (typed ?? yes).focus(), 60);
    });
  }

  private async newLinksDialog() {
    const ok = await this.confirm({
      title: "Make new links?",
      body: "The edit and watch links both change. The old ones stop working right away, and everyone on the board but you leaves it. Then send the new link to the people who should have it.",
      yes: "Make new links",
    });
    if (!ok) return;
    const r = await this.ask("links", () => this.board.link.admin("links"));
    if (!r.ok) return this.toast(r.message ?? "That didn’t work.");
    this.toast("New links made: the old ones no longer open the board.");
    this.share();
  }

  private async clearDialog() {
    const ok = await this.confirm({
      title: "Clear the board?",
      body: "Every note, heading, checklist, photo and drawing comes off the board, for everyone on it. Undo (⌘Z) brings it all back.",
      yes: "Clear the board",
      danger: true,
    });
    if (!ok) return;
    this.panel?.close();
    this.board.clearBoard();
    this.toast("Board cleared. Undo brings it back.");
  }

  private async deleteDialog() {
    const m = this.board.state.meta;
    const name = escapeHtml([m.client, m.file].filter(Boolean).join(" / ") || "This board");
    const local = !!this.board.access?.local;
    const ok = await this.confirm({
      title: "Delete this board for good?",
      body: local
        ? `“${name}” and everything on it are removed from this browser. This can’t be undone.`
        : `“${name}” and everything on it are removed from the server. Its links stop working for everyone, right away, and anyone on it now sees that it’s gone. This can’t be undone.`,
      yes: "Delete for good",
      danger: true,
      typed: "delete",
    });
    if (!ok) return;
    const r = await this.ask("delete", () => this.board.link.admin("delete"));
    if (!r.ok) this.toast(r.message ?? "That didn’t work.");
  }

  private async forgetDialog() {
    const owner = this.board.access?.role === "owner";
    const ok = await this.confirm({
      title: "Forget this board on this device?",
      body: owner
        ? "This browser forgets the board and your owner key. The board stays as it is for everyone else, but to manage it again you’ll need your owner link: copy it first if you don’t have it."
        : "This browser forgets the board’s key. The board stays as it is for everyone else; to come back you’ll need the link again.",
      yes: "Forget it here",
    });
    if (!ok) return;
    forgetBoard(this.board.id);
    location.href = "/";
  }

  /** Redraw the share or settings dialog after the access changed. */
  onAccess() {
    this.panel?.redraw();
    this.onMeta();
    this.onPeople();
  }

  /** Said, now and then, when the watch link tries to change something. */
  viewOnly() {
    if (this.board.access?.role !== "viewer" || !this.board.ready) return;
    const now = Date.now();
    if (now - this.viewOnlyAt < 4000) return;
    this.viewOnlyAt = now;
    this.toast("You’re on the watch link: you can look, point and react, but not change the board.");
  }

  // ------------------------------------------------------------------ gate
  /** The screen in front of the board: its password, or why it won’t open. */
  showGate(kind: "locked" | DeniedReason, info: { wrong?: boolean; wait?: number; at?: string; changed?: boolean } = {}) {
    const g = this.gate;
    const b = this.board;
    this.closeMenus();
    this.panel?.close();
    b.root.querySelectorAll(".dialog").forEach((x) => x.remove());
    b.root.classList.add("gated");
    g.hidden = false;
    clearInterval(this.gateTimer);
    if (kind !== "locked") {
      const when = info.at ? new Date(info.at) : null;
      const on = when && !Number.isNaN(+when) ? ` on ${when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}` : "";
      const [title, body] = {
        missing: ["There’s no board at this link", "Check the whole link was copied, or ask whoever sent it for a fresh one."],
        link: ["This link doesn’t open the board any more", "Its owner made new links, or this one was copied wrong. Ask them for the current link."],
        deleted: ["This board was deleted", `Its owner deleted it${on}, with everything on it. Nothing of it is kept.`],
      }[kind];
      g.dataset.kind = kind;
      g.innerHTML = `
        <div class="gate-card" role="alert">
          <div class="gate-icon">${icon(kind === "deleted" ? "trash" : "link")}</div>
          <h1>${title}</h1>
          <p>${body}</p>
          <div class="actions"><a class="btn primary" href="/new?template=blank">Start a new board</a><a class="btn ghost" href="/">Watch the demo</a></div>
        </div>`;
      return;
    }
    let form = g.querySelector<HTMLFormElement>("form.unlock");
    if (g.dataset.kind !== "locked" || !form) {
      g.dataset.kind = "locked";
      g.innerHTML = `
        <div class="gate-card">
          <div class="gate-icon">${icon("lock")}</div>
          <h1>This board has a password</h1>
          <p class="gate-why">${info.changed ? "The board’s owner just changed it. Enter the new one to carry on." : "Whoever sent you the link can tell you what it is."}</p>
          <form class="unlock">
            <label class="field"><span>Password</span><input type="password" name="pw" autocomplete="current-password" maxlength="200" required /></label>
            <p class="form-error" aria-live="polite"></p>
            <button class="btn primary big" type="submit">Open the board</button>
          </form>
          <p class="fine">This device remembers it until the password changes.</p>
        </div>`;
      form = g.querySelector<HTMLFormElement>("form.unlock")!;
      const input = form.querySelector<HTMLInputElement>("input")!;
      input.addEventListener("keydown", (e) => e.stopPropagation());
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (!input.value) return input.focus();
        const btn = form!.querySelector<HTMLButtonElement>("button")!;
        btn.disabled = true;
        btn.textContent = "Checking…";
        b.link.unlock(input.value);
      });
      setTimeout(() => input.focus(), 60);
    }
    const input = form.querySelector<HTMLInputElement>("input")!;
    const btn = form.querySelector<HTMLButtonElement>("button")!;
    const err = form.querySelector(".form-error")!;
    if (info.wrong) {
      input.select();
      g.querySelector(".gate-card")?.classList.remove("shake");
      void (g.querySelector(".gate-card") as HTMLElement | null)?.offsetWidth;
      g.querySelector(".gate-card")?.classList.add("shake");
    }
    let wait = info.wait ?? 0;
    const paint = () => {
      if (wait > 0) {
        err.textContent = `${info.wrong ? "That’s not it. " : ""}Too many tries: wait ${wait < 60 ? `${wait} s` : `${Math.ceil(wait / 60)} min`} before the next one.`;
        btn.disabled = true;
        btn.textContent = "Wait…";
      } else {
        err.textContent = info.wrong ? "That’s not it. Try again." : "";
        btn.disabled = false;
        btn.textContent = "Open the board";
      }
    };
    paint();
    if (wait > 0)
      this.gateTimer = window.setInterval(() => {
        wait--;
        if (wait <= 0) {
          clearInterval(this.gateTimer);
          info = { ...info, wrong: false };
        }
        paint();
      }, 1000);
  }

  hideGate() {
    clearInterval(this.gateTimer);
    this.gate.hidden = true;
    this.gate.innerHTML = "";
    delete this.gate.dataset.kind;
    this.board.root.classList.remove("gated");
  }

  /**
   * Turn a chat into a plan: paste a group chat, meeting notes or a to-do
   * list; the room's Workers AI picks out what needs doing, with the day, time
   * and who; you look the notes over and add them, tidied into the week if you
   * like. Where AI isn't there (a board in this browser, AI not set up, used up
   * for the day), each line becomes a note and the words decide its day.
   */
  planDialog(prefill = "") {
    const b = this.board;
    if (b.readOnly && !b.demo) return this.viewOnly();
    const live = !b.access?.local;
    const d = this.dialog("", "plan-dialog");
    const card = d.el.querySelector(".card")!;
    let text = prefill.slice(0, PLAN_MAX_CHARS);
    let notes: PlanNote[] = [];

    const write = () => {
      card.innerHTML = `
        <h2>Turn a chat into a plan</h2>
        <p class="muted">Paste a group chat, meeting notes or a to-do list. ${live ? "Longtable picks out what needs doing, with the day, the time and who it falls to." : "Each line becomes a note, and the day and time come from its words."}</p>
        <form class="plan-form">
          <textarea name="chat" rows="9" maxlength="${PLAN_MAX_CHARS}" spellcheck="false" aria-label="The chat" placeholder="${escapeHtml(PLAN_EXAMPLE)}"></textarea>
          <p class="fine">${live ? "Workers AI on this Longtable’s own Cloudflare account reads the text. Nothing you paste is stored, only the notes you add." : "On a deployed Longtable, Workers AI reads the chat instead: it leaves out the small talk and finds days in words like “tomorrow”."}</p>
          <div class="actions wrap">
            <button type="button" class="btn ghost" data-close>Cancel</button>
            ${live ? '<button type="button" class="btn" data-act="lines">One note per line</button>' : ""}
            <button type="submit" class="btn primary">${live ? "Make a plan" : "Make notes"}</button>
          </div>
        </form>`;
      const area = card.querySelector("textarea")!;
      area.value = text;
      area.addEventListener("input", () => (text = area.value));
      area.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) card.querySelector<HTMLFormElement>("form")!.requestSubmit();
      });
      card.querySelector("[data-close]")!.addEventListener("click", d.close);
      card.querySelector("[data-act='lines']")?.addEventListener("click", () => {
        if (text.trim()) review(linesToNotes(text), null);
      });
      card.querySelector("form")!.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!text.trim()) return area.focus();
        if (!live) return review(linesToNotes(text), null);
        const go = card.querySelector<HTMLButtonElement>("button[type=submit]")!;
        go.disabled = true;
        area.disabled = true;
        go.innerHTML = `<span class="spinner" aria-hidden="true"></span>Reading the chat…`;
        card.querySelector(".fine")!.textContent = "It reads the whole chat before it answers, so who took what and any change of plan come out right. That can take half a minute.";
        const r = await b.link.plan(text, localIso());
        if (!d.el.isConnected) return;
        if (r.ok) review(r.notes, null);
        else review(linesToNotes(text), r.why, r.wait);
      });
      setTimeout(() => area.focus(), 60);
    };

    const review = (found: PlanNote[], why: PlanTrouble | null, wait?: number) => {
      notes = found;
      const weekOf = b.state.meta.weekOf;
      const whenOf = (n: PlanNote) => {
        const day = n.day ?? findDay(n.text)?.day ?? null;
        const time = n.time ?? findTime(n.text);
        const dayText = day === null ? "Any day" : weekOf ? `${DAY_HEADERS[day]} ${dateOf(weekOf, day).getDate()}` : DAY_HEADERS[day];
        return `${dayText}${time !== null ? ` · ${formatTime(time)}` : ""}`;
      };
      card.innerHTML = `
        <h2>${notes.length ? `${notes.length} note${notes.length === 1 ? "" : "s"} from the chat` : "Nothing to add"}</h2>
        ${why ? `<p class="plan-why">${planTrouble(why, wait, live)}</p>` : ""}
        ${
          notes.length
            ? `<ul class="plan-list">${notes
                .map(
                  (n, i) => `<li><label><input type="checkbox" checked data-i="${i}" /><span class="when">${escapeHtml(whenOf(n))}</span><span class="what">${escapeHtml(n.text)}</span>${n.who ? `<span class="who">@${escapeHtml(n.who)}</span>` : ""}</label></li>`,
                )
                .join("")}</ul>
               <label class="check-line"><input type="checkbox" name="tidy" checked /> Tidy them into the week</label>`
            : `<p class="muted">That text has no lines to turn into notes.</p>`
        }
        <div class="actions wrap">
          <button type="button" class="btn ghost" data-act="back">Back</button>
          ${notes.length ? `<button type="button" class="btn primary" data-act="add">Add ${notes.length} note${notes.length === 1 ? "" : "s"}</button>` : ""}
        </div>`;
      const add = card.querySelector<HTMLButtonElement>("[data-act='add']");
      const picked = () => [...card.querySelectorAll<HTMLInputElement>(".plan-list input[data-i]")].filter((c) => c.checked).map((c) => notes[Number(c.dataset.i)]);
      card.querySelector(".plan-list")?.addEventListener("change", () => {
        const n = picked().length;
        if (add) {
          add.disabled = !n;
          add.textContent = `Add ${n} note${n === 1 ? "" : "s"}`;
        }
      });
      card.querySelector("[data-act='back']")!.addEventListener("click", write);
      add?.addEventListener("click", () => {
        const chosen = picked();
        const tidy = card.querySelector<HTMLInputElement>("input[name=tidy]")?.checked ?? false;
        d.close();
        b.addNotes(chosen, { tidy });
        if (!tidy) this.toast(`Added ${chosen.length} note${chosen.length === 1 ? "" : "s"}`);
      });
      add?.focus();
    };

    write();
  }

  /** The board's calendar feed, with the links that subscribe to it in Google, Apple and Outlook calendars. */
  private calendarLinks() {
    const b = this.board;
    const cal = b.access?.cal;
    if (!cal || b.access?.local) return null;
    let tz = "";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    } catch {
      // floating times it is
    }
    const feed = `${location.origin}/api/boards/${b.id}/cal/${cal}.ics${tz ? `?tz=${encodeURIComponent(tz)}` : ""}`;
    const webcal = feed.replace(/^https?:/, "webcal:");
    return {
      feed,
      apple: webcal,
      google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
      outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=${encodeURIComponent(boardTitle(b.state.meta))}`,
    };
  }

  exportWeek() {
    const b = this.board;
    const weekOf = b.state.meta.weekOf || nextMonday();
    const cal = this.calendarLinks();
    const d = this.dialog(
      `
      <h2>Export the week</h2>
      ${
        cal
          ? `<section class="subscribe">
        <div class="sub-head">${icon("cal")}<div><b>Keep it in your calendar</b><span>Subscribe once and your calendar follows the board as it changes.</span></div></div>
        <div class="cal-row">
          <a class="btn" data-cal="google" href="${escapeHtml(cal.google)}" target="_blank" rel="noopener noreferrer">Google Calendar</a>
          <a class="btn" data-cal="apple" href="${escapeHtml(cal.apple)}">Apple Calendar</a>
          <a class="btn" data-cal="outlook" href="${escapeHtml(cal.outlook)}" target="_blank" rel="noopener noreferrer">Outlook</a>
          <button class="btn ghost" data-cal="copy" data-url="${escapeHtml(cal.feed)}">${icon("copy")}<span>Copy link</span></button>
        </div>
        <p class="fine">Each calendar looks for changes on its own clock: Apple and Outlook within hours, Google sometimes only once a day. Anyone with this calendar link can read the notes that name a day; new links or a new password (Board settings) switch it off.</p>
      </section>`
          : ""
      }
      <p class="muted">Every note that names a day, in day order. Notes with a time (“8 am”, “16:00”, “下午4点”) become timed events.</p>
      <label class="field">Week starting <input type="date" value="${weekOf}" /></label>
      <pre class="preview"></pre>
      <div class="actions wrap">
        <button class="btn ghost" data-close>Close</button>
        <button class="btn" data-x="csv">Spreadsheet (.csv)</button>
        <button class="btn" data-x="ics">Calendar file (.ics)</button>
        <button class="btn primary" data-x="md">Copy as text</button>
      </div>`,
      "export-dialog",
    );
    const date = d.el.querySelector<HTMLInputElement>("input[type=date]")!;
    const pre = d.el.querySelector("pre")!;
    d.el.querySelector("[data-cal='copy']")?.addEventListener("click", (e) => this.copy((e.currentTarget as HTMLElement).dataset.url!, "Calendar link copied: add it in your calendar as a subscription"));
    const meta = () => ({ ...b.state.meta, weekOf: /^\d{4}-\d{2}-\d{2}$/.test(date.value) ? mondayOf(date.value) : weekOf });
    const render = () => (pre.textContent = toMarkdown(meta(), b.state.list()));
    render();
    date.addEventListener("change", () => {
      const m = meta();
      date.value = m.weekOf;
      if (m.weekOf !== b.state.meta.weekOf && !b.readOnly) b.setMeta({ weekOf: m.weekOf });
      render();
    });
    d.el.querySelector(".actions")!.addEventListener("click", async (e) => {
      const x = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-x]")?.dataset.x;
      if (!x) return;
      const m = meta();
      if (x === "md") {
        try {
          await navigator.clipboard.writeText(toMarkdown(m, b.state.list()));
          this.toast("Copied: paste it into a message or a doc");
        } catch {
          this.toast("Copy didn’t work here: select the text above instead");
        }
      } else if (x === "ics") download(`${fileStem(m)}.ics`, toIcs(m, b.state.list(), b.id), "text/calendar");
      else download(`${fileStem(m)}.csv`, toCsv(m, b.state.list()), "text/csv");
    });
  }
}

/** Where the demo was opened from, if it was a board of yours. */
function demoBack(): string | null {
  const back = new URLSearchParams(location.search).get("back");
  return back && /^\/b\/[A-Za-z0-9]+$/.test(back) ? back : null;
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** What the plan dialog's empty box shows. */
const PLAN_EXAMPLE = "Ana: Flyers need to be out by Wed 8am\nBo: I’ll order the cake stand, it has to be here Friday\n小王：周四下午4点试吃，我来订蛋糕\nCy: 👍";

/** Why the chat was read line by line, in a sentence. */
function planTrouble(why: PlanTrouble, wait: number | undefined, live: boolean): string {
  const tail = "so each line became a note. Days and times still come from the words.";
  if (!live || why === "off") return `Workers AI isn’t set up on this Longtable, ${tail}`;
  if (why === "spent") {
    const now = new Date();
    const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return `Today’s free Workers AI is used up (it comes back at ${reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}), ${tail}`;
  }
  if (why === "busy") return `That’s a lot of chats in one hour (more in ${Math.ceil((wait ?? 600) / 60)} min), ${tail}`;
  if (why === "empty") return `The AI found nothing to do in that text, ${tail}`;
  return `The AI didn’t answer this time, ${tail} Go back and try again for a smarter read.`;
}
