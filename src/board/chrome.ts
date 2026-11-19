// The tool's own furniture, which stays put while the board moves: the top
// bar (whose board, who is here, share, export, zoom), the toolbar, the
// selection bar, the Tidy up button, toasts and the few dialogs.
import { PALETTE } from "../shared/colors";
import { ANY, DAY_HEADERS, DAY_NAMES, FROM_WORDS, NO_TIME, dateOf, dayPicked, findDay, formatTime, mondayOf, nextMonday, noteDay, noteTime, timePicked } from "../shared/days";
import { fileStem, toCsv, toIcs, toMarkdown } from "../shared/exporter";
import { REACTIONS } from "../shared/schema";
import type { NoteItem, ReactionKind } from "../shared/types";
import { escapeHtml, type Board, type Tool } from "./app";
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
  private sortedTimers: number[] = [];
  private avatarsShown = new Set<string>();

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
        <span class="sep"></span>
        <button class="tool react" aria-label="React" title="React" aria-haspopup="menu">${icon("react")}</button>
        <span class="sep desk"></span>
        <button class="tool undo desk" aria-label="Undo" title="Undo · ⌘Z">${icon("undo")}</button>
        <button class="tool redo desk" aria-label="Redo" title="Redo · ⇧⌘Z">${icon("redo")}</button>
      </nav>
      <div class="menu react-menu" role="menu">${REACTIONS.map((k) => `<button data-react="${k}" aria-label="${k}">${reactionIcon(k, "#ECE9E2")}</button>`).join("")}</div>
      <div class="selbar" role="toolbar" aria-label="Selection"></div>
      <div class="menu when-menu" role="dialog" aria-label="Pick the day"></div>
      <button class="tidy-pill" aria-label="Tidy up"><span class="grid-icon"><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="pill-text"><b>Tidy up</b><small></small></span></button>
      <div class="status" aria-live="polite"></div>
      <div class="toasts" aria-live="polite"></div>
      <div class="empty-hint">
        <p class="big">Double-click anywhere to add a note.</p>
        <p>Name a day on it — Mon, Tue… or 周一 — or pick one, and <b>Tidy up</b> files it into that day.</p>
      </div>
      <div class="follow-frame"><span></span></div>
      <div class="sorted" aria-live="polite"></div>
      <div class="demo-shield" aria-hidden="true"></div>
      <div class="corner"><span class="corner-tag"></span><button class="sample-btn" hidden></button><span class="demo-controls"></span></div>
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

    // Names in the top bar are edited in place.
    for (const key of ["client", "file"] as const) {
      const span = this.top.querySelector<HTMLElement>(`.${key}`)!;
      span.addEventListener("click", () => {
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
      if (!(e.target as HTMLElement).closest(".menu, .react, .zoom, .day-tag, [data-act='day']")) this.closeMenus();
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
    root.querySelector(".demo-controls")!.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.demo;
      if (act === "play") location.href = `/demo?back=${encodeURIComponent(location.pathname)}`;
      else if (act === "stop") board.demo?.stop();
      else if (act === "replay") board.demo?.start();
      else if (act === "own") location.href = "/new?template=pell-and-rye";
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

  private closeMenus() {
    this.reactMenu.classList.remove("open");
    this.zoomMenu.classList.remove("open");
    this.closeWhen();
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
    document.title = `${[m.client, m.file].filter(Boolean).join(" / ") || "Board"} · Longtable`;
    const tag = this.board.root.querySelector<HTMLElement>(".corner-tag")!;
    tag.textContent =
      m.template === "pell-and-rye"
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
    const av = (pid: string, name: string, color: string, me = false) =>
      `<button class="avatar${me ? " me" : ""}${seen.has(me ? "me" : pid) ? "" : " new"}${b.following === pid ? " followed" : ""}" data-pid="${me ? "me" : pid}" style="--c:${color}" title="${me ? `You (${escapeHtml(name || "Guest")}) · change name or colour` : `${escapeHtml(name)} · click to follow`}" aria-label="${me ? "You" : `Follow ${escapeHtml(name)}`}">${escapeHtml((name || "?").trim().charAt(0).toUpperCase() || "?")}</button>`;
    this.top.querySelector(".avatars")!.innerHTML =
      shown.map((p) => av(p.pid, p.name, p.color)).join("") + (extra > 0 ? `<span class="avatar more">+${extra}</span>` : "") + av("me", b.me.name, b.me.color, true);
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

  /** The demo's buttons in the corner: play it from any board; stop, replay or leave it on the demo board. */
  onDemo() {
    const slot = this.board.root.querySelector<HTMLElement>(".demo-controls")!;
    const demo = this.board.demo;
    const play = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2.5 1.5v9l8-4.5z" fill="currentColor"/></svg>';
    const stop = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';
    this.board.root.classList.toggle("demo-playing", !!demo?.playing);
    if (!demo) {
      slot.innerHTML = `<button class="sample-btn demo-btn" data-demo="play" title="Watch five made-up people plan a week on a board of its own, then tidy it">${play}Play the demo</button>`;
      return;
    }
    const back = demoBack();
    slot.innerHTML = demo.playing
      ? `<button class="sample-btn demo-btn on" data-demo="stop" title="Stop and try the board yourself · Esc">${stop}Stop demo</button>`
      : `<button class="sample-btn demo-btn" data-demo="replay">${play}Replay<span class="wide"> demo</span></button>` +
        `<button class="sample-btn demo-btn primary" data-demo="own">Make your own<span class="wide"> board</span></button>` +
        (back ? `<button class="sample-btn demo-btn" data-demo="back">Back<span class="wide"> to your board</span></button>` : "");
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
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
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
    const url = location.href.split("#")[0].split("?")[0];
    const d = this.dialog(`
      <h2>Plan it together</h2>
      <p class="muted">Anyone with this link can see the board and change it, live.</p>
      <div class="linkrow"><input readonly value="${escapeHtml(url)}" aria-label="Board link"/><button class="btn primary copy">Copy link</button></div>
      <p class="tip"><b>Trying it on your own?</b> Open the link in a second window, or on your phone, and watch your other self’s cursor arrive. Or add sample teammates: four made-up people who wander the board on your screen only.</p>
      <div class="actions"><button class="btn ghost sample">${this.board.sampleTeam.active ? "Stop sample teammates" : "Add sample teammates"}</button><button class="btn ghost" data-close>Done</button></div>
    `);
    d.el.querySelector(".sample")!.addEventListener("click", () => {
      if (this.board.sampleTeam.active) this.board.sampleTeam.stop();
      else this.board.sampleTeam.start();
      d.close();
    });
    const input = d.el.querySelector("input")!;
    input.addEventListener("focus", () => input.select());
    d.el.querySelector(".copy")!.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
        this.toast("Link copied");
      } catch {
        input.select();
        document.execCommand?.("copy");
        this.toast("Link copied");
      }
    });
  }

  exportWeek() {
    const b = this.board;
    const weekOf = b.state.meta.weekOf || nextMonday();
    const d = this.dialog(
      `
      <h2>Export the week</h2>
      <p class="muted">Every note that names a day, in day order. Notes with a time (“8 am”, “16:00”, “下午4点”) become timed events.</p>
      <label class="field">Week starting <input type="date" value="${weekOf}" /></label>
      <pre class="preview"></pre>
      <div class="actions wrap">
        <button class="btn ghost" data-close>Close</button>
        <button class="btn" data-x="csv">Spreadsheet (.csv)</button>
        <button class="btn" data-x="ics">Calendar (.ics)</button>
        <button class="btn primary" data-x="md">Copy as text</button>
      </div>`,
      "export-dialog",
    );
    const date = d.el.querySelector<HTMLInputElement>("input[type=date]")!;
    const pre = d.el.querySelector("pre")!;
    const meta = () => ({ ...b.state.meta, weekOf: /^\d{4}-\d{2}-\d{2}$/.test(date.value) ? mondayOf(date.value) : weekOf });
    const render = () => (pre.textContent = toMarkdown(meta(), b.state.list()));
    render();
    date.addEventListener("change", () => {
      const m = meta();
      date.value = m.weekOf;
      if (m.weekOf !== b.state.meta.weekOf) b.setMeta({ weekOf: m.weekOf });
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
