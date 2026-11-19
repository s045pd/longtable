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
import { renderLanding } from "./landing";

const app = document.getElementById("app")!;
const params = new URLSearchParams(location.search);
export const LIVE = import.meta.env.PROD || params.has("live");

/** Make a board and go to it. */
export async function startBoard(template: TemplateName) {
  let id: string;
  if (LIVE) {
    const res = await fetch("/api/boards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template }) });
    if (!res.ok) throw new Error(`Could not start a board (${res.status})`);
    id = ((await res.json()) as { id: string }).id;
  } else id = newBoardId();
  const url = `/b/${id}${LIVE ? "" : `?t=${template}`}`;
  history.pushState({}, "", url);
  route();
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
    new Board(app, m[1], { live: LIVE, template });
    return;
  }
  // The front page is the demo: it plays as soon as you arrive.
  if (location.pathname === "/" || location.pathname === "/demo" || location.pathname === "/demo/") {
    new Board(app, "demo", { live: false, demo: true });
    return;
  }
  if (location.pathname === "/new") {
    const t = params.get("template");
    startBoard((TEMPLATES as readonly string[]).includes(t ?? "") ? (t as TemplateName) : "blank").catch(() => (location.href = "/"));
    return;
  }
  // The old front page, with the pitch and the feature cards.
  if (location.pathname === "/about") {
    renderLanding(app, startBoard);
    return;
  }
  app.className = "landing";
  app.innerHTML = `<main class="lost"><h1>There’s nothing here.</h1><p>Longtable lives at the front page and on board links.</p><a class="btn primary" href="/">Go to Longtable</a></main>`;
}

addEventListener("popstate", () => location.reload());
route();
