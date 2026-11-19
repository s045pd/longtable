// Routes: "/" (and "/demo") is the front page, which plays the whole story
// on a board of its own; "/b/<id>" is a board; "/new?template=…" starts one;
// "/about" is the written introduction. In production boards are live (the Worker); `npm run dev`
// without a Worker keeps them on this device (add ?live to force live).
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "@fontsource-variable/caveat/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./styles/app.css";
import { Board } from "./board/app";
import { BOARD_ID, newBoardId } from "./shared/ids";
import { TEMPLATES, type TemplateName } from "./shared/templates";
import { localIso } from "./shared/plan";
import { renderLanding } from "./landing";
import { carryTo, keysFromHash, loadKeys, saveKeys } from "./board/identity";
import { askSite, siteStatus } from "./site";

const app = document.getElementById("app")!;
const params = new URLSearchParams(location.search);
export const LIVE = import.meta.env.PROD || params.has("live");

// The old team password was kept here in plain text; the site's password now lives in a cookie only the server reads.
try {
  localStorage.removeItem("longtable:team");
} catch {
  // no storage
}

/** Make a board and go to it. Without the site's password, ask for it first. */
export async function startBoard(template: TemplateName) {
  if (!LIVE) {
    const id = newBoardId();
    if (params.has("carry")) carryTo(id);
    history.pushState({}, "", `/b/${id}?t=${template}`);
    return route();
  }
  const res = await fetch("/api/boards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template, today: localIso() }) });
  if (res.status === 401 || res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; wait?: number };
    if (body.error === "too-many-boards") {
      return cantStart(`That’s a lot of new boards in one hour. You can start another in ${minutes(body.wait ?? 3600)}.`);
    }
    return askSite(app, () => startBoard(template).catch(() => cantStart()));
  }
  if (!res.ok) throw new Error(`Could not start a board (${res.status})`);
  const made = (await res.json()) as { id: string; edit: string; owner: string };
  saveKeys(made.id, { key: made.edit, owner: made.owner });
  if (params.has("carry")) carryTo(made.id);
  history.pushState({}, "", `/b/${made.id}#k=${made.edit}`);
  route();
}

/**
 * Everything but a board link waits for the site's password: the front page,
 * the demo, the introduction and starting a board. Coming in with the initial
 * one asks for a password of your own first.
 */
async function inside(go: () => void) {
  if (!LIVE) return go();
  const site = await siteStatus();
  if (!site.gate || site.in) return go();
  askSite(app, go);
}

const minutes = (s: number) => (s < 60 ? `${s} s` : `${Math.ceil(s / 60)} min`);

/** Starting a board didn't work: say so, rather than leave a blank page. */
function cantStart(why = "Longtable couldn’t reach its server. Check your connection and try again.") {
  app.className = "landing";
  app.innerHTML = `<main class="lost"><h1>The board didn’t start</h1><p></p><div class="actions"><a class="btn ghost" href="/">Go to Longtable</a><button class="btn primary" type="button">Try again</button></div></main>`;
  app.querySelector("p")!.textContent = why;
  app.querySelector("button")!.addEventListener("click", () => location.reload());
}

function route() {
  const m = /^\/b\/([^/]+)\/?$/.exec(location.pathname);
  if (m) {
    if (!BOARD_ID.test(m[1])) {
      app.className = "landing";
      app.innerHTML = `<main class="lost"><h1>That link doesn’t lead to a board.</h1><p>Board links look like <code>/b/</code> followed by ten letters and numbers.</p><a class="btn primary" href="/">Go to Longtable</a></main>`;
      return;
    }
    const t = params.get("t");
    const template = (TEMPLATES as readonly string[]).includes(t ?? "") ? (t as TemplateName) : "blank";
    if (t) history.replaceState({}, "", `/b/${m[1]}`);
    // A link's keys win over what this device kept.
    const keys = { ...loadKeys(m[1]), ...keysFromHash(location.hash) };
    new Board(app, m[1], { live: LIVE, template, keys });
    return;
  }
  // The front page is the demo: it plays as soon as you arrive.
  if (location.pathname === "/" || location.pathname === "/demo" || location.pathname === "/demo/") {
    inside(() => new Board(app, "demo", { live: false, demo: true }));
    return;
  }
  if (location.pathname === "/new") {
    const t = params.get("template");
    inside(() => startBoard((TEMPLATES as readonly string[]).includes(t ?? "") ? (t as TemplateName) : "blank").catch(() => cantStart()));
    return;
  }
  // The old front page, with the pitch and the feature cards.
  if (location.pathname === "/about") {
    inside(() => renderLanding(app, startBoard));
    return;
  }
  app.className = "landing";
  app.innerHTML = `<main class="lost"><h1>There’s nothing here.</h1><p>Longtable lives at the front page and on board links.</p><a class="btn primary" href="/">Go to Longtable</a></main>`;
}

addEventListener("popstate", () => location.reload());
// Pasting another board's link into the address bar only changes the hash.
addEventListener("hashchange", () => location.reload());
route();
