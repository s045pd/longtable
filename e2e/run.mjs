// End-to-end check of a live board: two people in two browsers, one phone.
// It starts `wrangler dev` on its own (after `npm run build`) unless BASE_URL
// points at a running Longtable. Run with: npm run e2e
//
// What it checks: cursors and names reach the other person; a note typed by
// one appears for the other; a drag lands in the same place for both; Tidy up
// lays the notes out in day columns for everyone; undo takes it back; the
// board survives a reload; a day picked by hand, or by dragging a note into
// a column, reaches the other person and decides the tidy and the export;
// the phone layout loads; the demo plays through on a board of its own and
// can be stopped; no page errors anywhere.
import { spawn } from "node:child_process";
import { chromium, devices } from "playwright";

const PORT = 8790 + Math.floor(Math.random() * 100);
let base = process.env.BASE_URL;
let server = null;
const failures = [];
const errors = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  server = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"], {
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await wait(500);
  }
  throw new Error("wrangler dev did not start");
}

async function person(browser, name, color, options = { viewport: { width: 1280, height: 800 } }) {
  const ctx = await browser.newContext(options);
  await ctx.addInitScript(
    ([n, c]) => localStorage.setItem("longtable:me", JSON.stringify({ cid: `e2e-${n}`, name: n, color: c })),
    [name, color],
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name} console: ${m.text()}`));
  return page;
}

const transformOf = (page, id) => page.$eval(`.item[data-id="${id}"]`, (e) => e.style.transform);

try {
  if (!base) await startServer();
  const res = await fetch(`${base}/api/boards`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template: "pell-and-rye" }) });
  check(res.status === 201, "POST /api/boards makes a board");
  const { id } = await res.json();
  const url = `${base}/b/${id}`;

  const browser = await chromium.launch();
  const A = await person(browser, "Ana", "#FFB38A");
  const B = await person(browser, "Eli", "#8FD0FF");
  await A.goto(url);
  await B.goto(url);
  await A.waitForSelector(".item.note", { state: "attached" });
  await B.waitForSelector(".item.note", { state: "attached" });
  const notes0 = await A.$$eval(".item.note", (els) => els.length);
  check(notes0 === 23, `the example board opens with 23 notes (got ${notes0})`);

  // Presence: B's cursor and name reach A.
  await B.mouse.move(500, 400);
  await B.mouse.move(620, 460, { steps: 6 });
  await A.waitForFunction(() => [...document.querySelectorAll(".someone:not(.away) .flag")].some((f) => f.textContent === "Eli"), null, { timeout: 5000 }).then(
    () => check(true, "Ana sees Eli's cursor and name"),
    () => check(false, "Ana sees Eli's cursor and name"),
  );
  check((await A.$$eval(".avatars .avatar", (a) => a.length)) === 2, "both people show in the top bar");

  // A types a new note; B watches it appear.
  const empty = await A.evaluate(() => {
    for (let y = 120; y < 700; y += 20) for (let x = 120; x < 1200; x += 20) if (document.elementFromPoint(x, y)?.classList.contains("grid")) return [x, y];
    return [640, 400];
  });
  await A.mouse.dblclick(empty[0], empty[1]);
  await A.keyboard.type("Soft opening Tue 3 pm", { delay: 10 });
  await B.waitForFunction(() => [...document.querySelectorAll(".item.note .words")].some((w) => w.textContent.replace(/\s/g, "").includes("Softopening")), null, { timeout: 5000 }).then(
    () => check(true, "Eli sees Ana's note while she types"),
    () => check(false, "Eli sees Ana's note while she types"),
  );
  await A.keyboard.press("Escape");
  await wait(300);

  // A drags a note; it ends up in the same place for B.
  const noteId = "n-oven";
  const box = await A.locator(`.item[data-id="${noteId}"] .shape`).boundingBox();
  await A.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await A.mouse.down();
  await A.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 60, { steps: 8 });
  await A.mouse.up();
  await wait(500);
  check((await transformOf(A, noteId)) === (await transformOf(B, noteId)), "a dragged note lands in the same place for both");

  // B tidies; A sees the week.
  await B.keyboard.press("Escape");
  await B.click(".tidy-pill");
  await A.waitForSelector(".item.week", { state: "attached", timeout: 5000 }).then(
    () => check(true, "Ana sees the week Eli tidied"),
    () => check(false, "Ana sees the week Eli tidied"),
  );
  await wait(1800);
  const columns = await A.$$eval(".item.note", (els) => new Set(els.map((e) => /translate\(([-\d.]+)px/.exec(e.style.transform)?.[1])).size);
  check(columns === 7, `every note sits in one of seven day columns (got ${columns})`);
  const sorted = await B.$eval(".sorted", (e) => e.textContent);
  check(sorted.includes("Opening week, sorted."), "the closing line reads “Opening week, sorted.”");

  // Undo on B takes the tidy back for A.
  await B.keyboard.press("Control+z");
  await A.waitForSelector(".item.week", { state: "detached", timeout: 5000 }).then(
    () => check(true, "undo takes the tidy back for everyone"),
    () => check(false, "undo takes the tidy back for everyone"),
  );

  // The board survives a reload.
  await A.reload();
  await A.waitForSelector(".item.note", { state: "attached" });
  const notes1 = await A.$$eval(".item.note", (els) => els.length);
  check(notes1 === 24, `after a reload the board still has the new note (24, got ${notes1})`);

  // Export.
  await A.click(".topbar .export");
  const md = await A.$eval(".preview", (e) => e.textContent);
  check(md.includes("15:00 Soft opening Tue 3 pm"), "the export lists the new note at 15:00 on Tuesday");

  // Ana picks a day by hand; Eli sees it, and his tidy follows it.
  const noteOf = (page, words) => page.$$eval(".item.note", (els, w) => els.find((e) => e.textContent.includes(w))?.dataset.id, words);
  await A.keyboard.press("Escape");
  await wait(300);
  await A.keyboard.press("Escape");
  const band = await noteOf(A, "Brass band");
  const bandBox = await A.locator(`.item[data-id="${band}"] .shape`).boundingBox();
  await A.mouse.click(bandBox.x + bandBox.width / 2, bandBox.y + bandBox.height / 2);
  await A.click(".selbar [data-act='day']");
  await A.click(".when-menu [data-day='1']");
  await B.waitForFunction((id) => document.querySelector(`.item[data-id="${id}"] .day-tag.picked`)?.textContent.startsWith("TUE"), band, { timeout: 5000 }).then(
    () => check(true, "a day Ana picks by hand shows on the note for Eli"),
    () => check(false, "a day Ana picks by hand shows on the note for Eli"),
  );
  await A.click(".when-menu [data-when='done']");
  await A.keyboard.press("Escape");
  check((await A.$(".selbar.show")) === null, "after Done, the board's keys work again (Escape clears the selection)");
  await B.keyboard.press("Escape");
  await B.click(".tidy-pill");
  await A.waitForSelector(".item.week", { state: "attached", timeout: 5000 });
  await wait(1800);
  const colOf = (page, id) =>
    page.evaluate((id) => {
      const x = (el) => Number(/translate\(([-\d.]+)px/.exec(el.style.transform)[1]);
      return Math.round((x(document.querySelector(`.item[data-id="${id}"]`)) - x(document.querySelector(".item.week"))) / 232);
    }, id);
  check((await colOf(A, band)) === 1, "the tidy files “Brass band Sat” under Tuesday, the day picked for it");

  // Ana drags a note into Sunday's column: it becomes a Sunday note for both.
  await A.keyboard.press("!");
  await wait(900);
  const balloons = await noteOf(A, "Balloons");
  const from = await A.locator(`.item[data-id="${balloons}"] .shape`).boundingBox();
  const sun = await A.locator(".day-head[data-col='6']").boundingBox();
  await A.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await A.mouse.down();
  await A.mouse.move(sun.x + sun.width / 2, sun.y + sun.height + from.height * 0.7, { steps: 10 });
  await A.mouse.up();
  await B.waitForFunction((id) => document.querySelector(`.item[data-id="${id}"] .day-tag`)?.textContent.startsWith("SUN"), balloons, { timeout: 5000 }).then(
    () => check(true, "a note dragged into Sunday's column becomes a Sunday note for Eli too"),
    () => check(false, "a note dragged into Sunday's column becomes a Sunday note for Eli too"),
  );
  await wait(900);
  check((await colOf(A, balloons)) === 6 && (await colOf(B, balloons)) === 6, "it slots into the Sunday column on both screens");
  await A.click(".topbar .export");
  const md2 = await A.$eval(".preview", (e) => e.textContent);
  check(/## Tuesday[^#]*Brass band/.test(md2) && /## Sunday[^#]*Balloons up Fri/.test(md2), "the export follows the picked days");
  await A.keyboard.press("Escape");

  // A phone.
  const P = await person(browser, "Dee", "#FFE38A", { ...devices["iPhone 13"] });
  await P.goto(url);
  await P.waitForSelector(".item.note", { state: "attached" });
  const bar = await P.locator(".toolbar").boundingBox();
  const vh = P.viewportSize().height;
  check(bar && bar.y > vh - 120 && bar.x >= 0 && bar.x + bar.width <= 390, "on a phone the toolbar sits at the bottom, inside the screen");
  check((await P.evaluate(() => document.documentElement.scrollWidth)) <= 390, "no sideways scroll on a phone");

  // The demo: a button in the corner of every board, and the whole story on a board of its own.
  check((await A.$eval(".demo-controls [data-demo='play']", (b) => b.textContent)).includes("Play the demo"), "every board has a Play the demo button in the corner");
  const D = await person(browser, "Viewer", "#8FD0FF");
  await D.goto(`${base}/demo?back=/b/${id}`);
  await D.waitForSelector(".board-app.demo-playing", { timeout: 5000 });
  await D.waitForFunction(() => !document.querySelector(".board-app").classList.contains("demo-playing"), null, { timeout: 60000, polling: 500 }).then(
    () => check(true, "the demo plays to the end on its own"),
    () => check(false, "the demo plays to the end on its own"),
  );
  const demoEnd = await D.evaluate(() => ({
    notes: document.querySelectorAll(".item.note").length,
    week: !!document.querySelector(".item.week"),
    buttons: [...document.querySelectorAll(".demo-controls button")].map((b) => b.dataset.demo),
  }));
  check(demoEnd.notes === 24 && demoEnd.week, `it ends on the tidied week (${demoEnd.notes} notes, week ${demoEnd.week})`);
  check(demoEnd.buttons.join(",") === "replay,own,back", "then offers Replay, Make your own board and Back to your board");
  const after = await (await fetch(`${base}/api/boards/${id}/snapshot`)).json();
  check(!after.items.some((it) => it.id === "n-double-sun"), "the demo never touches a real board");
  await D.click(".demo-controls [data-demo='replay']");
  await D.waitForSelector(".board-app.demo-playing", { timeout: 3000 });
  await wait(2500);
  await D.keyboard.press("Escape");
  check(!(await D.evaluate(() => document.querySelector(".board-app").classList.contains("demo-playing"))), "Esc stops the demo and hands the board over");

  await browser.close();
} catch (e) {
  failures.push(String(e?.stack ?? e));
  console.error(e);
} finally {
  server?.kill();
}

check(errors.length === 0, `no page errors${errors.length ? `:\n  ${errors.join("\n  ")}` : ""}`);
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
