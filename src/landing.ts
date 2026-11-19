// The front page: what Longtable is, a small board that tidies itself on a
// loop, the example board and a blank one, and the boards you opened lately.
import { findDay } from "./shared/days";
import { recentBoards } from "./board/identity";
import { markSvg } from "./board/chrome";
import { SPRING } from "./board/views";
import { PALETTE } from "./shared/colors";
import type { TemplateName } from "./shared/templates";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const MINI = [
  ["Opening week starts Mon", 0, 60, 40, -6],
  ["Oven check Mon 6 am", 1, 420, 210, 4],
  ["Flyers to print Tue", 0, 250, 60, 3],
  ["Rota draft by Tue", 3, 560, 40, -3],
  ["Test bake Wed", 2, 120, 200, 5],
  ["Flyers out Wed 8 am", 4, 330, 190, -5],
  ["Sourdough × 120 Thu", 1, 30, 120, 2],
  ["Taste panel Thu 4 pm", 4, 500, 140, 6],
  ["Croissants × 200 Fri", 2, 200, 130, -2],
  ["Balloons up Fri", 3, 610, 210, -6],
  ["Brass band Sat 10 am", 0, 400, 50, 2],
  ["Hire Saturday barista", 1, 470, 250, -4],
  ["Kids' bun class Sun", 4, 150, 250, 5],
  ["Thank-you party Sun", 2, 290, 270, -3],
] as const;

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function heroBoard(): string {
  const counts = new Array(7).fill(0);
  const notes = MINI.map(([text, who, mx, my, rot], i) => {
    const day = findDay(text)!.day;
    const row = counts[day]++;
    const tx = 8 + day * 94;
    const ty = 54 + row * 92;
    const delay = day * 0.068 + row * 0.034;
    return `<div class="mini" style="--c:${PALETTE[who]};--mx:${mx}px;--my:${my}px;--mr:${rot}deg;--tx:${tx}px;--ty:${ty}px;--d:${delay}s;--i:${i}">${esc(text)}</div>`;
  });
  const heads = DAYS.map((d, i) => `<div class="mini-head" style="left:${8 + i * 94}px;--d:${i * 0.068 + 0.3}s">${d}</div>`).join("");
  return `<div class="hero-board" aria-hidden="true"><div class="hero-stage">${heads}${notes.join("")}
    <div class="ghost-cursor a" style="--c:${PALETTE[0]}"><svg viewBox="0 0 20 31" width="16"><path d="M0 0L0 25.5L6.2 19.8L11.2 30.6L15.9 28.4L10.9 17.9L19.4 17.9Z"/></svg><span>Ana</span></div>
    <div class="ghost-cursor b" style="--c:${PALETTE[1]}"><svg viewBox="0 0 20 31" width="16"><path d="M0 0L0 25.5L6.2 19.8L11.2 30.6L15.9 28.4L10.9 17.9L19.4 17.9Z"/></svg><span>Bo</span></div>
    <div class="ghost-cursor c" style="--c:${PALETTE[4]}"><svg viewBox="0 0 20 31" width="16"><path d="M0 0L0 25.5L6.2 19.8L11.2 30.6L15.9 28.4L10.9 17.9L19.4 17.9Z"/></svg><span>Eli</span></div>
    </div><div class="hero-pill"><span class="grid-icon"><i></i><i></i><i></i><i></i><i></i><i></i></span>Tidy up</div></div>`;
}

export function renderLanding(app: HTMLElement, start: (t: TemplateName) => Promise<void>) {
  app.className = "landing";
  document.title = "Longtable · plan it together";
  const recent = recentBoards();
  app.innerHTML = `
    <header class="land-top">
      <a href="/" class="brand">${markSvg(PALETTE.slice(0, 5), 1.15)}<span>Longtable</span></a>
      <span class="badge">Preview</span>
    </header>
    <main>
      <section class="hero">
        <div class="hero-copy">
          <h1>Plan it <em>together.</em></h1>
          <p class="lede">A shared board for the week ahead. Everyone writes notes at once and sees each other’s cursors live. Then one click tidies the mess into the days the notes name.</p>
          <div class="cta">
            <button class="btn primary big" data-start="pell-and-rye">Open the Pell &amp; Rye example</button>
            <button class="btn big" data-start="blank">Start a blank board</button>
            <a class="btn big ghost" href="/demo"><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 1.5v9l8-4.5z" fill="currentColor"/></svg>Watch the demo</a>
          </div>
          <p class="small muted">No sign-up. A board is a link: whoever has it can plan with you. Each example opens as your own copy.</p>
        </div>
        ${heroBoard()}
      </section>
      <section class="features">
        <article>
          <h3>Everyone at once</h3>
          <p>Names ride on cursors, words appear as they’re typed, and you can follow someone’s view with one click.</p>
        </article>
        <article>
          <h3>One click, one week</h3>
          <p>Write “Flyers out Wed 8 am” and Tidy up files it under Wednesday, in time order. Works with 周一 to 周日 too.</p>
        </article>
        <article>
          <h3>Out to your calendar</h3>
          <p>Export the week as text for a chat, a spreadsheet, or a calendar file with timed and all-day events.</p>
        </article>
      </section>
      ${
        recent.length
          ? `<section class="recent"><h2>Your boards</h2><ul>${recent
              .map((b) => `<li><a href="/b/${esc(b.id)}"><span>${esc(b.title || "Untitled board")}</span><time>${new Date(b.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</time></a></li>`)
              .join("")}</ul></section>`
          : ""
      }
    </main>
    <footer class="land-foot"><span>Pell &amp; Rye, and everyone on its board, are fictional.</span></footer>`;

  app.querySelectorAll<HTMLButtonElement>("[data-start]").forEach((b) =>
    b.addEventListener("click", async () => {
      app.querySelectorAll<HTMLButtonElement>("[data-start]").forEach((x) => (x.disabled = true));
      b.classList.add("busy");
      try {
        await start(b.dataset.start as TemplateName);
      } catch {
        b.classList.remove("busy");
        app.querySelectorAll<HTMLButtonElement>("[data-start]").forEach((x) => (x.disabled = false));
        b.textContent = "Couldn’t start a board. Try again";
      }
    }),
  );

  // The little board tidies itself, then scatters again, on a loop.
  const hero = app.querySelector<HTMLElement>(".hero-board")!;
  const stage = hero.querySelector<HTMLElement>(".hero-stage")!;
  stage.style.setProperty("--spring", SPRING);
  const fit = () => stage.style.setProperty("--s", String(Math.min(1, hero.clientWidth / 676)));
  new ResizeObserver(fit).observe(hero);
  fit();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) hero.classList.add("tidy");
  else {
    let tidy = false;
    const step = () => {
      tidy = !tidy;
      hero.classList.toggle("tidy", tidy);
      setTimeout(step, tidy ? 3600 : 2600);
    };
    setTimeout(step, 1400);
  }
}
