// The site's own password: a Longtable asks for it before the front page,
// the demo or a new board. Board links never need it (their keys are the
// lock). The server keeps it; this browser keeps only a cookie it can't read.
import type { SiteStatus } from "./shared/types";
import { recentBoards } from "./board/identity";
import { markSvg } from "./board/chrome";
import { PALETTE } from "./shared/colors";

const OPEN: SiteStatus = { gate: false, in: true };
/** The logo and name over the password screens. */
const brand = () => `<header class="land-top"><span class="brand">${markSvg(PALETTE.slice(0, 5), 1.15)}<span>Longtable</span></span></header>`;
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
let asked: Promise<SiteStatus> | null = null;
let known: SiteStatus | null = null;

/** Whether this browser is in. Asked once a page; when the server can't be reached, the page goes ahead (the server still checks). */
export function siteStatus(fresh = false): Promise<SiteStatus> {
  if (!asked || fresh) {
    asked = fetch("/api/site", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<SiteStatus>) : OPEN))
      .catch(() => OPEN)
      .then((s) => (known = s));
  }
  return asked;
}

/** What the last answer said, without asking. */
export const siteKnown = () => known;

type Answer = { ok: true; initial?: boolean } | { ok: false; error: string; message?: string; wait?: number };

async function post(path: string, body: unknown): Promise<Answer> {
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await r.json().catch(() => ({}))) as { initial?: boolean; error?: string; message?: string; wait?: number };
    if (r.ok) return { ok: true, initial: data.initial };
    return { ok: false, error: data.error ?? String(r.status), message: data.message, wait: data.wait };
  } catch {
    return { ok: false, error: "offline" };
  }
}

export const unlockSite = (password: string) => post("/api/site/unlock", { password });
export const changeSitePassword = (current: string, next: string) =>
  post("/api/site/password", { current, next }).then((a) => {
    if (a.ok) known = { gate: true, in: true, initial: false, fixed: false };
    return a;
  });

export const waitText = (s: number) => (s < 60 ? `${s} s` : `${Math.ceil(s / 60)} min`);

/** Why a password didn't work, in words. */
export function troubleText(a: Extract<Answer, { ok: false }>, wrong = "That’s not it. Try again."): string {
  if (a.wait) return `Too many tries: wait ${waitText(a.wait)}.`;
  if (a.error === "offline") return "Longtable couldn’t reach its server. Check your connection and try again.";
  if (a.error === "weak") return a.message ?? "Pick a longer password.";
  if (a.error === "fixed") return "This password is set in Cloudflare (SITE_PASSWORD). Change it there.";
  if (a.error === "wrong" || a.error === "wrong-password") return wrong;
  return `That didn’t work (${a.error}). Try again.`;
}

/**
 * The screen in front of the site: the password, and the boards this device
 * has opened before (their links open without it). Calls `then` once in,
 * with whether it was the initial password and what was typed.
 */
export function showSiteGate(app: HTMLElement, then: (initial: boolean, typed: string) => void) {
  const mine = recentBoards();
  const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  app.className = "landing";
  app.innerHTML = `${brand()}<main class="lost team site-gate">
    <h1>This Longtable has a password</h1>
    <p>Ask whoever set it up for it. Boards someone sent you a link to open without it.</p>
    <form class="team-form site-form">
      <label class="field"><span>Password</span><input type="password" name="pw" autocomplete="current-password" maxlength="200" required /></label>
      <p class="form-error" aria-live="polite"></p>
      <div class="actions"><button class="btn primary" type="submit">Come in</button></div>
    </form>
    ${
      mine.length
        ? `<div class="gate-boards">
            <div class="gate-boards-head"><span>Your boards on this device</span></div>
            ${mine
              .slice(0, 6)
              .map((r) => `<a href="/b/${escapeHtml(r.id)}"><span>${escapeHtml(r.title || "Untitled board")}</span><time>${day(r.at)}</time></a>`)
              .join("")}
          </div>`
        : ""
    }
  </main>`;
  const form = app.querySelector<HTMLFormElement>(".site-form")!;
  const input = form.querySelector("input")!;
  const error = form.querySelector<HTMLElement>(".form-error")!;
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  input.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!input.value) return;
    button.disabled = true;
    const a = await unlockSite(input.value);
    button.disabled = false;
    if (a.ok) {
      known = { gate: true, in: true, initial: !!a.initial };
      asked = Promise.resolve(known);
      return then(!!a.initial, input.value);
    }
    error.textContent = troubleText(a);
    input.select();
  });
}

/**
 * Right after coming in with the initial password: everyone can read it in
 * the README, so ask for one of their own. "Later" goes on; Settings has it
 * too (Your boards → Site password).
 */
export function showPickPassword(app: HTMLElement, current: string, then: () => void) {
  app.className = "landing";
  app.innerHTML = `${brand()}<main class="lost team site-pick">
    <h1>Now pick your own password</h1>
    <p>You came in with <b>longtable</b>, the password every new Longtable starts with. It’s in the README, so anyone could guess it. Pick one only your team knows: everyone types it once on each device, and board links keep working without it.</p>
    <form class="team-form site-form">
      <label class="field"><span>New password</span><input type="password" name="next" autocomplete="new-password" minlength="6" maxlength="200" required /></label>
      <label class="field"><span>Again</span><input type="password" name="again" autocomplete="new-password" minlength="6" maxlength="200" required /></label>
      <p class="form-error" aria-live="polite"></p>
      <div class="actions"><button class="btn ghost" type="button" data-later>Later</button><button class="btn primary" type="submit">Save it</button></div>
    </form>
  </main>`;
  const form = app.querySelector<HTMLFormElement>(".site-form")!;
  const [next, again] = [...form.querySelectorAll("input")];
  const error = form.querySelector<HTMLElement>(".form-error")!;
  next.focus();
  form.querySelector("[data-later]")!.addEventListener("click", then);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (next.value !== again.value) {
      error.textContent = "The two don’t match.";
      return again.select();
    }
    const a = await changeSitePassword(current, next.value);
    if (a.ok) return then();
    error.textContent = troubleText(a);
  });
}

/** Ask for the site's password, then (coming in with the initial one) for one of their own, then go on. */
export function askSite(app: HTMLElement, go: () => void) {
  showSiteGate(app, (initial, typed) => (initial ? showPickPassword(app, typed, go) : go()));
}
