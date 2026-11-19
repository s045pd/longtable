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
// can be stopped. Then privacy: a board's address alone opens nothing; the
// watch link can't change anything, even sent straight to the server; a
// password asks everyone but the owner, wrong guesses are slowed down; new
// links shut the old ones out; clearing can be undone; a deleted board is
// gone for everyone; with a team password nobody else can start boards; the
// security headers are there. A chat becomes a plan and the week a calendar;
// notes with dates of their own go to their own weeks, whose a note is shows
// as a tag, and the export, picture and calendar can be just one person's;
// an AI assistant plans on the board over MCP. No page errors anywhere.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright";

const PORT = 8790 + Math.floor(Math.random() * 100);
let base = process.env.BASE_URL;
// The local server gets a team password; against BASE_URL, pass the deployment's own (if it has one).
const TEAM = process.env.BASE_URL ? process.env.TEAM_PASSWORD : "e2e-team-password";
let server = null;
let store = null;
/** Stop wrangler dev and everything it started, and drop its store. */
function stopServer() {
  if (server) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // already gone
    }
    server = null;
  }
  try {
    if (store) rmSync(store, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // a temp folder; the system clears it
  }
  store = null;
}
process.on("exit", stopServer);
const failures = [];
const errors = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  // A fresh store each run, so boards and counts from an earlier run don't carry over.
  store = mkdtempSync(join(tmpdir(), "longtable-e2e-"));
  // Its own process group, so stopping it also stops wrangler's workerd.
  // --local: no Cloudflare login needed; Workers AI is then off and chats are read line by line.
  server = spawn("npx", ["wrangler", "dev", "--local", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", store, "--var", `CREATE_PASSWORD:${TEAM}`], {
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
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

/** The browser's own line for a refusal this run asks for on purpose. */
const expected = (name, text) => name === "Eve" && /status of 429/.test(text);

async function person(browser, name, color, options = { viewport: { width: 1280, height: 800 } }) {
  const ctx = await browser.newContext(options);
  await ctx.addInitScript(
    ([n, c]) => localStorage.setItem("longtable:me", JSON.stringify({ cid: `e2e-${n}`, name: n, color: c })),
    [name, color],
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !expected(name, m.text()) && errors.push(`${name} console: ${m.text()}`));
  return page;
}

const transformOf = (page, id) => page.$eval(`.item[data-id="${id}"]`, (e) => e.style.transform);

const makeBoard = (template, password = TEAM) =>
  fetch(`${base}/api/boards`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template, ...(password ? { password } : {}) }) });
const api = (path, headers = {}) => fetch(`${base}${path}`, { headers });
/** Which screen stands in front of the board (locked, link, missing, deleted), or null if none comes. */
const gateKind = (page, ms = 6000) =>
  page.waitForSelector(".gate:not([hidden])", { timeout: ms }).then(
    () => page.$eval(".gate", (g) => g.dataset.kind),
    () => null,
  );
const settle = (promise, what) => promise.then(() => check(true, what), () => check(false, what));

/** A bare WebSocket to a board, as a script would open it. */
async function rawSession(id, hello) {
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/api/boards/${id}/ws`);
  const inbox = [];
  let poke = () => {};
  ws.onmessage = (e) => {
    inbox.push(JSON.parse(e.data));
    poke();
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.send(JSON.stringify({ t: "hello", name: "Script", color: "#FFB38A", cid: "script", ...hello }));
  const next = async (types, ms = 6000) => {
    const end = Date.now() + ms;
    for (;;) {
      const i = inbox.findIndex((m) => types.includes(m.t));
      if (i >= 0) return inbox.splice(i, 1)[0];
      if (Date.now() > end) return null;
      await new Promise((r) => {
        poke = r;
        setTimeout(r, 100);
      });
    }
  };
  return { next, send: (m) => ws.send(JSON.stringify(m)), close: () => ws.close() };
}

try {
  if (!base) await startServer();
  const res = await makeBoard("pell-and-rye");
  check(res.status === 201, "POST /api/boards makes a board");
  const { id, edit, owner } = await res.json();
  check(/^[a-z0-9]{26}$/.test(edit) && /^[a-z0-9]{26}$/.test(owner) && edit !== owner, "it comes with an edit key and an owner key");
  const url = `${base}/b/${id}#k=${edit}`;

  const browser = await chromium.launch();
  const A = await person(browser, "Ana", "#FFB38A");
  const B = await person(browser, "Eli", "#8FD0FF");
  // Ana made the board: she opens its owner link.
  await A.goto(`${base}/b/${id}#o=${owner}`);
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
  const centred = await B.$eval(".sorted .line", (e) => {
    const r = e.getBoundingClientRect();
    return Math.abs(r.left + r.width / 2 - innerWidth / 2) < 40 && e.parentElement.getBoundingClientRect().height > r.height;
  });
  check(centred, "and stands centred, over its count");

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
  const top = await P.$$eval(".topbar .right > *", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { c: e.className, w: r.width, right: r.right }; }));
  check(top.some((t) => /export/.test(t.c) && t.w > 0 && t.right <= 390) && top.every((t) => t.right <= 390), "on a phone Export (and the calendar) is in the top bar, inside the screen");

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
  check(demoEnd.buttons.join(",") === "replay,own,blank,back", `then offers Replay, Make your own board, Blank board and Back to your board (${demoEnd.buttons})`);
  const after = await (await api(`/api/boards/${id}/snapshot`, { "x-longtable-key": edit })).json();
  check(!after.items.some((it) => it.id === "n-double-sun"), "the demo never touches a real board");
  await D.click(".demo-controls [data-demo='replay']");
  await D.waitForSelector(".board-app.demo-playing", { timeout: 3000 });
  await wait(2500);
  await D.keyboard.press("Escape");
  check(!(await D.evaluate(() => document.querySelector(".board-app").classList.contains("demo-playing"))), "Esc stops the demo and hands the board over");

  // Sharing from the demo: it makes a real board first, so the link brings people onto it, live.
  await D.click(".topbar .share");
  check(await D.isVisible(".demo-share [data-act='real']"), "on the demo, Share says it lives in this tab only and offers to make it a real board");
  await D.keyboard.press("Escape");
  await wait(300);
  const spot = await D.evaluate(() => {
    for (let y = 200; y < 700; y += 20) for (let x = 200; x < 1100; x += 20) if (document.elementFromPoint(x, y)?.classList.contains("grid")) return [x, y];
    return [640, 400];
  });
  check(!(await D.isVisible(".demo-note")), "the demo doesn't nag before you change anything");
  await D.mouse.dblclick(spot[0], spot[1]);
  await D.keyboard.type("Window paint Thu", { delay: 10 });
  await D.keyboard.press("Escape");
  await settle(D.waitForSelector(".demo-note", { state: "visible", timeout: 3000 }), "once you change the demo, it says only you can see it");
  const demoCount = await D.$$eval(".item", (e) => e.length);
  await D.click(".demo-note [data-demo='real']");
  if (TEAM) {
    await D.waitForSelector(".team-form");
    await D.fill(".team-form input", TEAM);
    await D.click(".team-form button[type=submit]");
  }
  await D.waitForSelector(".share-dialog.open input[readonly]", { timeout: 8000 });
  const realLink = await D.$eval(".share-dialog.open input[readonly]", (e) => e.value);
  check(/\/b\/[a-z0-9]{10}#k=[a-z0-9]{26}$/.test(realLink), "“Make it a real board” opens a real board with its Share dialog and edit link");
  await wait(600);
  const realCount = await D.$$eval(".item", (e) => e.length);
  const words = (page) => page.$$eval(".item.note .words", (els) => els.map((e) => e.textContent.replace(/\s/g, "")).join("|"));
  check(realCount === demoCount && (await words(D)).includes("WindowpaintThu"), `everything on the demo came along, your change too (${realCount} of ${demoCount})`);
  const E = await person(browser, "Bo", "#B8E986");
  await E.goto(realLink);
  await E.waitForSelector(".item.note", { state: "attached" });
  await wait(500);
  check((await E.$$eval(".item", (e) => e.length)) === realCount && (await words(E)).includes("WindowpaintThu"), "someone opening that link gets the same board, not the demo");
  await D.keyboard.press("Escape");
  await E.mouse.move(400, 300);
  await E.mouse.move(520, 380, { steps: 6 });
  await settle(
    D.waitForFunction(() => [...document.querySelectorAll(".someone:not(.away) .flag")].some((f) => f.textContent === "Bo"), null, { timeout: 5000 }),
    "and the two of them see each other live",
  );

  // The front page is the demo, playing as soon as it opens; with reduced motion it shows the ending instead.
  const F = await person(browser, "Visitor", "#C9B6FF");
  await F.goto(`${base}/`);
  await F.waitForSelector(".board-app.demo-playing", { timeout: 5000 }).then(
    () => check(true, "the front page opens on the demo, already playing"),
    () => check(false, "the front page opens on the demo, already playing"),
  );
  const calm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const R = await calm.newPage();
  R.on("pageerror", (e) => errors.push(`reduced motion: ${e.message}`));
  await R.goto(`${base}/`);
  await R.waitForSelector(".item.week", { state: "attached", timeout: 5000 }).catch(() => {});
  const still = await R.evaluate(() => ({
    playing: document.querySelector(".board-app").classList.contains("demo-playing"),
    notes: document.querySelectorAll(".item.note").length,
    play: document.querySelector(".demo-controls [data-demo='replay']")?.textContent,
  }));
  check(!still.playing && still.notes === 24 && /Play/.test(still.play ?? ""), "with reduced motion it shows the tidied week and waits for Play");

  // ---------------------------------------------------------------- privacy
  await A.keyboard.press("Escape");
  await wait(300);
  check(new URL(A.url()).hash === `#k=${edit}`, "the owner's address bar shows the edit link, never the owner key");
  check((await api(`/api/boards/${id}/snapshot`)).status === 403, "a board's address alone opens nothing on the server");
  check((await api(`/api/boards/${id}/snapshot`, { "x-longtable-key": "a".repeat(26) })).status === 403, "nor does a made-up key");
  const N = await person(browser, "Nosy", "#C9B6FF");
  await N.goto(`${base}/b/${id}`);
  check((await gateKind(N)) === "link", "the address without a key shows “This link doesn’t open the board any more”");
  check((await N.$$eval(".item", (e) => e.length)) === 0, "and nothing of the board");
  await N.goto(`${base}/b/zzzzzzzzzz#k=${edit}`);
  check((await gateKind(N)) === "missing", "a board id that doesn’t exist says there’s no board at the link");
  check((await api(`/api/boards/zzzzzzzzzz/snapshot`, { "x-longtable-key": edit })).status === 404, "and opening it did not make one");
  const wsFromElsewhere = await api(`/api/boards/${id}/ws`, { Origin: "https://elsewhere.example" });
  check(wsFromElsewhere.status === 403, "another site's page can't open a board's socket");

  const head = await api(`/b/${id}`);
  const h = (k) => head.headers.get(k) ?? "";
  check(h("content-security-policy").includes("frame-ancestors 'none'") && h("referrer-policy") === "no-referrer" && h("x-robots-tag").includes("noindex"), "pages carry the security headers (CSP, no referrer, no indexing)");

  // The watch link.
  await A.click(".topbar .share");
  const links = await A.$$eval(".share-dialog .share-link input[readonly]", (els) => els.map((e) => e.value));
  check(links.length === 2 && links[0].endsWith(`#k=${edit}`) && /#v=[a-z0-9]{26}$/.test(links[1]), "Share offers an edit link and a watch link");
  const viewLink = links[1];
  const viewKey = viewLink.split("#v=")[1];
  await A.click(".share-dialog [data-close]");
  const V = await person(browser, "Cy", "#C9B6FF");
  await V.goto(viewLink);
  await V.waitForSelector(".item.note", { state: "attached" });
  check(await V.evaluate(() => document.querySelector(".board-app").classList.contains("view-only")), "the watch link opens the board view-only");
  check(!(await V.isVisible(".toolbar [data-tool='note']")) && !(await V.isVisible(".tidy-pill")), "with no note tool and no Tidy up");
  await settle(A.waitForSelector(".avatars .avatar.watching", { timeout: 5000 }), "Ana sees Cy as watching");
  const rv = await rawSession(id, { key: viewKey });
  const vInit = await rv.next(["init"]);
  check(vInit?.access.role === "viewer" && !vInit.access.edit, "the watch key makes a viewer, and never reveals the edit key");
  rv.send({ t: "ops", tx: 1, ops: [{ op: "put", item: { id: "sneakysneaky", type: "note", x: 0, y: 0, rot: 0, z: 1, by: "x", color: "#FFB38A", text: "sneaky" } }] });
  check((await rv.next(["ack"]))?.rejected === 1, "the server refuses a change sent straight to it with the watch key");
  rv.close();
  const snap = await (await api(`/api/boards/${id}/snapshot`, { "x-longtable-key": edit })).json();
  check(!snap.items.some((it) => it.id === "sneakysneaky"), "and the board doesn't have it");

  // A password.
  await A.click(".topbar .share");
  await A.click(".share-dialog [data-act='settings']");
  await settle(A.waitForSelector(".settings-dialog.open", { timeout: 3000 }), "Share still leads to Board settings");
  await A.click(".settings-dialog [data-close]");
  // Board settings has a button of its own in the top bar.
  const settings = async () => {
    await A.click(".topbar .settings-btn");
    await A.waitForSelector(".settings-dialog.open");
  };
  await settle(settings(), "the top bar's Settings button opens Board settings straight away");
  await A.click(".settings-dialog [data-act='pw']");
  await A.fill(".pw-dialog input[name=pw]", "rye-and-pell");
  await A.click(".pw-dialog button[type=submit]");
  check((await gateKind(B)) === "locked", "when Ana sets a password, Eli (on the board) is asked for it");
  check((await B.$eval(".gate-why", (e) => e.textContent)).includes("just changed"), "and told the owner just changed it");
  check((await gateKind(V)) === "locked", "so is Cy, on the watch link");
  check(!(await A.isVisible(".gate")), "Ana, the owner, is not");
  await B.fill(".gate input[name=pw]", "a-wrong-guess");
  await B.click(".gate button[type=submit]");
  await settle(B.waitForFunction(() => document.querySelector(".gate .form-error")?.textContent.includes("not it"), null, { timeout: 5000 }), "a wrong password is turned away");
  await B.fill(".gate input[name=pw]", "rye-and-pell");
  await B.click(".gate button[type=submit]");
  await settle(B.waitForSelector(".gate", { state: "hidden", timeout: 5000 }), "the right one opens the board again");
  await B.reload();
  await B.waitForSelector(".item.note", { state: "attached" });
  check((await gateKind(B, 1500)) === null, "and Eli's browser remembers it after a reload");
  const C = await person(browser, "Bo", "#B8E986");
  await C.goto(url);
  check((await gateKind(C)) === "locked", "someone new with the edit link is asked for the password");
  check((await C.$$eval(".item", (e) => e.length)) === 0, "and sees nothing of the board until then");
  check((await api(`/api/boards/${id}/snapshot`, { "x-longtable-key": edit })).status === 401, "the server won't hand the board over without it either");
  await A.click(".settings-dialog [data-act='pw-off']");
  await settle(C.waitForSelector(".gate", { state: "hidden", timeout: 5000 }), "when Ana turns the password off, Bo comes straight in");

  // New links.
  await A.click(".settings-dialog [data-act='links']");
  await A.click(".confirm-dialog .yes");
  check((await gateKind(C)) === "link", "after Make new links, Bo's old link stops working at once");
  check((await gateKind(B)) === "link", "and Eli's");
  await A.waitForSelector(".share-dialog.open input[readonly]");
  const fresh = await A.$$eval(".share-dialog.open input[readonly]", (els) => els.map((e) => e.value));
  check(!fresh[0].includes(edit) && /#k=[a-z0-9]{26}$/.test(fresh[0]), "Ana's share dialog opens on the new link");
  check(new URL(A.url()).hash === new URL(fresh[0]).hash, "and her address bar follows it");
  await C.goto(url);
  check((await gateKind(C)) === "link", "the old link, opened again, still doesn't open the board");
  await C.goto(fresh[0]);
  await settle(C.waitForSelector(".item.note", { state: "attached", timeout: 5000 }), "the new link does");
  await A.click(".share-dialog.open [data-close]");

  // Clear, then undo.
  await settings();
  await A.click(".settings-dialog [data-act='clear']");
  await A.click(".confirm-dialog .yes");
  await settle(C.waitForFunction(() => document.querySelectorAll(".item").length === 0, null, { timeout: 5000 }), "Clear the board empties it for everyone");
  await wait(300);
  await A.keyboard.press("Control+z");
  await settle(C.waitForFunction(() => document.querySelectorAll(".item.note").length > 20, null, { timeout: 5000 }), "and Undo brings it all back");

  // Delete.
  await settings();
  await A.click(".settings-dialog [data-act='delete']");
  check(await A.$eval(".confirm-dialog .yes", (b) => b.disabled), "deleting waits until “delete” is typed");
  await A.fill(".confirm-dialog input[name=typed]", "delete");
  await A.click(".confirm-dialog .yes");
  check((await gateKind(A)) === "deleted", "Ana deletes the board: it’s gone");
  check((await gateKind(C)) === "deleted", "and everyone on it sees so");
  check((await api(`/api/boards/${id}/snapshot`, { "x-longtable-key": fresh[0].split("#k=")[1] })).status === 404, "the server no longer has it");
  await C.goto(fresh[0]);
  check((await gateKind(C)) === "deleted", "its link now says it was deleted");
  check(!((await C.evaluate(() => localStorage.getItem("longtable:keys"))) ?? "").includes(id), "and the browser forgot its keys");

  // Guessing a password is slowed down.
  const two = await (await makeBoard("blank")).json();
  const ro = await rawSession(two.id, { owner: two.owner });
  check((await ro.next(["init"]))?.access.role === "owner", "the owner key makes an owner");
  ro.send({ t: "admin", act: "password", pw: "correct horse" });
  check((await ro.next(["done"]))?.ok === true, "an owner can set a password over the socket");
  const rg = await rawSession(two.id, { key: two.edit });
  check((await rg.next(["locked"])) !== null, "a script with the edit key meets the password too");
  let last = null;
  for (let i = 0; i < 5; i++) {
    rg.send({ t: "unlock", pw: `guess ${i}` });
    last = await rg.next(["locked"]);
  }
  check(last?.wrong && last.wait >= 30, `after five wrong passwords it has to wait (${last?.wait} s)`);
  rg.send({ t: "unlock", pw: "correct horse" });
  const during = await rg.next(["locked", "pass"]);
  check(during?.t === "locked" && during.wait > 0, "even the right password waits out the cooldown");
  rg.close();

  // Guesses sent all at once are counted as they come in, not once checked.
  const three = await (await makeBoard("blank")).json();
  const ro3 = await rawSession(three.id, { owner: three.owner });
  await ro3.next(["init"]);
  ro3.send({ t: "admin", act: "password", pw: "correct horse" });
  await ro3.next(["done"]);
  const burst = await rawSession(three.id, { key: three.edit });
  await burst.next(["locked"]);
  for (let i = 0; i < 7; i++) burst.send({ t: "unlock", pw: `guess ${i}` });
  burst.send({ t: "unlock", pw: "correct horse" });
  const replies = [];
  for (let i = 0; i < 8; i++) replies.push(await burst.next(["locked", "pass"]));
  check(replies.every((r) => r?.t === "locked") && replies.at(-1)?.wait > 0, "eight guesses sent at once: the eighth waits, even when it’s right");
  burst.close();
  ro3.send({ t: "admin", act: "delete" });
  await ro3.next(["done"]);
  ro3.close();
  ro.send({ t: "admin", act: "delete" });
  await ro.next(["done"]);
  ro.close();

  // A team password keeps strangers from starting boards.
  if (TEAM) {
    check((await makeBoard("blank", null)).status === 401, "with a team password set, nobody else can start a board");
    check((await makeBoard("blank", "not-the-password")).status === 401, "nor with a wrong one");
    const T = await person(browser, "Dee", "#FFE38A");
    await T.goto(`${base}/new?template=blank`);
    await T.waitForSelector(".team-form");
    await T.fill(".team-form input", TEAM);
    await T.click(".team-form button[type=submit]");
    await settle(T.waitForSelector(".board-app .empty-hint.show", { timeout: 6000 }), "the team password page lets the team start a board");
  }

  // A chat becomes a plan; the week goes into calendars.
  {
    const made = await (await makeBoard("blank")).json();
    const P = await person(browser, "Fen", "#A8E6B8");
    await P.goto(`${base}/b/${made.id}#o=${made.owner}`);
    await P.waitForSelector(".board-app .empty-hint.show", { timeout: 6000 });
    const Q = await person(browser, "Gil", "#FF9FC0");
    await Q.goto(`${base}/b/${made.id}#k=${made.edit}`);
    await Q.waitForSelector(".board-app .empty-hint.show", { timeout: 6000 });
    const chat = [
      "[19/11 12:03] Ana: Flyers out Wed 8 am",
      "[19/11 12:04] Bo: I'll bring the cake stand Friday",
      "[19/11 12:05] Cy: 👍",
      "[19/11 12:06] 小王：周四下午4点试吃，我来订蛋糕",
      "[19/11 12:07] Dee: ok",
      "[19/11 12:08] Eli: count the till on Sunday",
    ].join("\n");
    // Pasting a chat opens the plan, filled in.
    await P.evaluate((text) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, chat);
    await settle(P.waitForSelector(".plan-dialog.open textarea", { timeout: 3000 }), "pasting a chat opens “Turn a chat into a plan”");
    check((await P.$eval(".plan-dialog textarea", (t) => t.value)) === chat, "with the chat already in it");
    await P.click(".plan-dialog button[type=submit]");
    await P.waitForSelector(".plan-list", { timeout: 70_000 });
    const listed = await P.$$eval(".plan-list .what", (els) => els.map((e) => e.textContent));
    const why = await P.$eval(".plan-dialog", (d) => d.querySelector(".plan-why")?.textContent ?? "");
    if (process.env.BASE_URL) {
      check(!why, `Workers AI reads the chat${why ? ` (it said: ${why})` : ""}`);
      check(listed.length >= 3 && listed.length <= 6, `and picks out the things to do (${listed.length}: ${listed.join(" | ")})`);
      check(!listed.some((t) => /^(ok|👍)$/i.test(t)), "leaving out the small talk");
    } else {
      check(/isn’t set up/.test(why), "without Workers AI, the dialog says each line became a note");
      check(listed.length === 4 && listed[0] === "Flyers out Wed 8 am", `names, times and small talk are taken off (${listed.join(" | ")})`);
    }
    await P.click(".plan-dialog [data-act='add']");
    await settle(
      Q.waitForFunction((n) => document.querySelectorAll(".item.note").length === n, listed.length, { timeout: 6000 }),
      "the notes reach everyone on the board",
    );
    await settle(Q.waitForSelector(".item.week", { state: "attached", timeout: 6000 }), "and are tidied into the week");

    // A script with the edit key asks too.
    const rs = await rawSession(made.id, { key: made.edit });
    const init = await rs.next(["init"]);
    rs.send({ t: "plan", text: "Ana: flyers out on Wednesday at 8\nBo: 👍", today: "2026-11-19" });
    const answer = await rs.next(["plan"], 70_000);
    if (process.env.BASE_URL) check(answer?.ok === true && answer.notes.some((n) => n.date === "2026-11-25"), `the room answers with notes and their dates (the Wednesday after Thursday 19th) (${JSON.stringify(answer?.notes ?? answer)})`);
    else check(answer?.ok === false && answer.why === "off", "the room says when Workers AI isn’t there");
    const rv = await rawSession(made.id, { key: init.access.view });
    const vinit = await rv.next(["init"]);
    rv.send({ t: "plan", text: "anything", today: "2026-11-19" });
    check((await rv.next(["plan"]))?.why === "view", "the watch link can’t have chats read");

    // The calendar feed.
    const cal = init.access.cal;
    check(/^[a-z0-9]{26}$/.test(cal ?? "") && vinit.access.cal === cal, "every link gets the board’s calendar link");
    const feedUrl = (k) => `/api/boards/${made.id}/cal/${k}.ics?tz=Asia/Tokyo`;
    const feed = await api(feedUrl(cal));
    const ics = await feed.text();
    check(feed.status === 200 && /^text\/calendar/.test(feed.headers.get("content-type") ?? ""), "the calendar feed is a calendar");
    check(ics.includes("X-WR-TIMEZONE:Asia/Tokyo") && ics.includes("REFRESH-INTERVAL") && /SUMMARY:.*(Flyers|flyers)/.test(ics), "with the week’s notes, refreshed hourly, in the asker’s time zone");
    check((await api(feedUrl("a".repeat(26)))).status === 404, "a made-up calendar key gets nothing");
    await P.click(".topbar .export");
    await P.waitForSelector(".export-dialog.open .subscribe");
    const links = await P.$$eval(".subscribe [data-cal]", (els) => Object.fromEntries(els.map((e) => [e.dataset.cal, e.getAttribute("href") ?? e.dataset.url])));
    check(
      links.google?.startsWith("https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2F") && links.apple?.startsWith("webcal://") && links.outlook?.includes("addfromweb") && links.copy?.includes(`/cal/${cal}.ics`),
      "Export offers Google, Apple and Outlook calendars and the link",
    );
    await P.keyboard.press("Escape");
    const ro = await rawSession(made.id, { owner: made.owner });
    await ro.next(["init"]);
    ro.send({ t: "admin", act: "links" });
    await ro.next(["done"]);
    const fresh = (await ro.next(["access"]))?.access?.cal;
    check((await api(feedUrl(cal))).status === 404 && fresh && fresh !== cal && (await api(feedUrl(fresh))).status === 200, "new links give the board a new calendar link and switch the old one off");
    ro.send({ t: "admin", act: "delete" });
    await ro.next(["done"]);
    check((await api(feedUrl(fresh))).status === 410, "and a deleted board’s calendar says it’s gone");
    for (const x of [rs, rv, ro]) x.close();
  }

  // Dates of their own: today's note stays in this week, next week's gets a
  // week of its own; whose it is is a tag; the export can be just mine.
  {
    const iso = (d) => d.toISOString().slice(0, 10);
    const plus = (day, n) => {
      const d = new Date(`${day}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return iso(d);
    };
    const today = iso(new Date());
    const monday = plus(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    const nextWeek = plus(today, 7);
    const res = await fetch(`${base}/api/boards`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template: "blank", today, ...(TEAM ? { password: TEAM } : {}) }) });
    const made = await res.json();
    const rs = await rawSession(made.id, { key: made.edit });
    const init = await rs.next(["init"]);
    check(init.meta.weekOf === monday, `a new blank board is this week’s (${init.meta.weekOf})`);
    const note = (id, text, x, more) => ({ op: "put", item: { id, type: "note", x, y: 0, rot: 0, z: 1, by: "Fen", color: "#FFE38A", text, ...more } });
    rs.send({
      t: "ops",
      tx: 1,
      ops: [
        note("dated-today", "Call the printer", 0, { date: today, who: "Fen" }),
        note("dated-next", "Flyers out", 260, { date: nextWeek, time: 480, who: "Gil" }),
        note("dated-sunday", "Count the till", 520, { day: 6 }),
      ],
    });
    check(!(await rs.next(["ack"]))?.rejected, "notes take a date and a name of their own");
    const P = await person(browser, "Fen", "#A8E6B8");
    await P.goto(`${base}/b/${made.id}#k=${made.edit}`);
    await P.waitForFunction(() => document.querySelectorAll(".item.note").length === 3, null, { timeout: 6000 });
    await P.click(".tidy-pill");
    await settle(P.waitForFunction(() => document.querySelectorAll(".item.week").length === 2, null, { timeout: 6000 }), "a note dated next week gets a week of its own on the tidy");
    await wait(1200);
    const top = (id) => P.$eval(`.item[data-id="${id}"] .shape`, (e) => e.getBoundingClientRect().top);
    check((await top("dated-next")) > (await top("dated-today")) + 40 && Math.abs((await top("dated-sunday")) - (await top("dated-today"))) < 4, "and sits a week down, while today’s and Sunday’s stay in this week");
    const tag = await P.$eval('.item[data-id="dated-today"] .who-tag', (e) => e.textContent);
    const words = await P.$eval('.item[data-id="dated-today"] .words', (e) => e.textContent);
    check(tag === "FFen" && !words.includes("@"), `whose it is shows as a tag, not words in the note (${tag})`);
    const stamp = await P.$eval('.item[data-id="dated-next"] .day-tag', (e) => e.textContent);
    check(/^[A-Z]{3} \d{1,2} [A-Z]{3} · 08:00$/.test(stamp), `next week’s note says its date (${stamp})`);
    await P.click(".topbar .export");
    await P.waitForSelector(".export-dialog.open");
    const all = await P.$eval(".export-dialog pre", (e) => e.textContent);
    check(all.includes("Call the printer · Fen") && all.includes("08:00 Flyers out · Gil") && all.indexOf("Call the printer") < all.indexOf("Flyers out"), "the export goes by date, with whose each note is");
    await P.click(".export-dialog .seg [data-who='me']");
    const mine = await P.$eval(".export-dialog pre", (e) => e.textContent);
    const feedMine = await P.$eval(".export-dialog [data-cal='copy']", (e) => e.dataset.url);
    check(mine.includes("Call the printer") && !mine.includes("Flyers out") && !mine.includes("Count the till"), "“Just Fen’s” keeps only Fen’s notes");
    check(/[?&]who=Fen(&|$)/.test(feedMine), "and the calendar link follows it");
    const [dl] = await Promise.all([P.waitForEvent("download", { timeout: 10_000 }), P.click(".export-dialog [data-x='png']")]);
    const size = statSync(await dl.path()).size;
    check(/\.png$/.test(dl.suggestedFilename()) && size > 20_000, `the week comes out as a picture (${dl.suggestedFilename()}, ${Math.round(size / 1024)} KB)`);
    await P.keyboard.press("Escape");
    const feed = (who) => api(`/api/boards/${made.id}/cal/${init.access.cal}.ics${who ? `?who=${encodeURIComponent(who)}` : ""}`).then((r) => r.text());
    const everyone = await feed("");
    const gil = await feed("Gil");
    check(everyone.includes(`DTSTART:${nextWeek.replaceAll("-", "")}T080000`) && everyone.includes("SUMMARY:Flyers out · Gil"), "the calendar puts next week’s note on its own date");
    check(gil.includes("SUMMARY:Flyers out") && !gil.includes("Call the printer") && gil.includes("X-WR-CALNAME:") && /X-WR-CALNAME:.*Gil/.test(gil), "and a calendar of just Gil’s notes has only Gil’s");
    const ro = await rawSession(made.id, { owner: made.owner });
    await ro.next(["init"]);
    ro.send({ t: "admin", act: "delete" });
    await ro.next(["done"]);
    for (const x of [rs, ro]) x.close();
  }

  // Your boards: the logo opens the boards opened on this device, to jump
  // straight to another one without going through the front page.
  {
    const one = await (await makeBoard("blank")).json();
    const two = await (await makeBoard("blank")).json();
    const named = [];
    for (const [b, file] of [[one, "Launch party"], [two, "Q1 roadmap"]]) {
      const r = await rawSession(b.id, { owner: b.owner });
      await r.next(["init"]);
      r.send({ t: "ops", tx: 1, ops: [{ op: "meta", set: { file } }] });
      await r.next(["ack"]);
      named.push(r);
    }
    const H = await person(browser, "Hal", "#8FD0FF");
    await H.goto(`${base}/b/${one.id}#o=${one.owner}`);
    await H.waitForSelector(".board-app .empty-hint.show", { timeout: 6000 });
    await H.goto(`${base}/b/${two.id}#o=${two.owner}`);
    await H.waitForSelector(".board-app .empty-hint.show", { timeout: 6000 });
    await H.click(".topbar .home");
    await settle(H.waitForSelector(".boards-menu.open", { timeout: 2000 }), "the logo opens Your boards");
    const menu = await H.$eval(".boards-menu", (m) => ({
      here: m.querySelector(".here")?.textContent ?? "",
      links: [...m.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.textContent.trim()]),
      settings: !!m.querySelector("[data-menu='settings']"),
    }));
    check(/Q1 roadmap/.test(menu.here) && /Open now/.test(menu.here), "with this board first, marked Open now");
    check(menu.links.some(([href, t]) => href === `/b/${one.id}` && /Launch party/.test(t)), "and the other board by its name");
    check(menu.links.some(([href]) => href === "/new?template=blank") && menu.settings && menu.links.some(([href]) => href === "/"), "plus New blank board, Board settings and the front page");
    await H.keyboard.press("Escape");
    check(!(await H.$eval(".boards-menu", (m) => m.classList.contains("open"))), "Escape closes it");
    await H.click(".topbar .home");
    await H.click(`.boards-menu a[href="/b/${one.id}"]`);
    await settle(H.waitForFunction((id) => location.pathname === `/b/${id}` && document.querySelector(".names .file")?.textContent === "Launch party", one.id, { timeout: 6000 }), "one click opens the other board, no link needed");
    check((await gateKind(H, 1500)) === null && (await H.$(".topbar .settings-btn")) !== null, "as its owner still (the keys stay on the device)");
    await H.click(".topbar .home");
    await H.click(".boards-menu [data-menu='settings']");
    await settle(H.waitForSelector(".settings-dialog.open [data-act='delete']", { timeout: 3000 }), "Board settings is in the menu too, with Delete for the owner");
    await H.context().close();
    for (const r of named) {
      r.send({ t: "admin", act: "delete" });
      await r.next(["done"]);
      r.close();
    }
  }

  // An AI assistant plans on the board over MCP.
  {
    const res = await fetch(`${base}/api/boards`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template: "blank", ...(TEAM ? { password: TEAM } : {}) }) });
    const made = await res.json();
    const rs = await rawSession(made.id, { key: made.edit });
    const init = await rs.next(["init"]);
    const rv = await rawSession(made.id, { key: init.access.view });
    const vinit = await rv.next(["init"]);
    check(/^[a-z0-9]{26}$/.test(init.access.mcp ?? "") && !vinit.access.mcp, "the edit link gets the board’s MCP address, the watch link doesn’t");
    const mcpUrl = (k) => `${base}/api/boards/${made.id}/mcp/${k}`;
    let rpcId = 0;
    const rpc = async (method, params, k = init.access.mcp) => {
      const r = await fetch(mcpUrl(k), { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, ...(params ? { params } : {}) }) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const tool = async (name, args = {}) => (await rpc("tools/call", { name, arguments: args })).body?.result;
    const hi = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
    check(hi.status === 200 && hi.body?.result?.protocolVersion === "2025-06-18" && hi.body.result.serverInfo?.name === "longtable", "an MCP client connects to the board’s address");
    const listed = (await rpc("tools/list")).body?.result?.tools?.map((t) => t.name) ?? [];
    check(["read_board", "add_notes", "update_note", "delete_notes", "tidy_up", "week_as_text", "week_picture", "calendar_link"].every((t) => listed.includes(t)), `and finds the board’s tools (${listed.join(", ")})`);
    check((await rpc("tools/list", null, "a".repeat(26))).status === 404, "a made-up MCP key gets nothing");
    const P = await person(browser, "Fen", "#A8E6B8");
    await P.goto(`${base}/b/${made.id}#k=${made.edit}`);
    await P.waitForSelector(".board-app .empty-hint.show", { timeout: 6000 });
    const iso = (d) => d.toISOString().slice(0, 10);
    const today = iso(new Date());
    const later = iso(new Date(Date.now() + 7 * 86_400_000));
    const added = await tool("add_notes", { notes: [{ text: "Call the printer", date: today, who: "Fen" }, { text: "Flyers out", date: later, time: "08:00", who: "Gil" }] });
    check(added?.structuredContent?.added?.length === 2 && !added.isError, "the assistant adds notes with dates, times and people");
    await settle(
      P.waitForFunction(() => document.querySelectorAll(".item.note").length === 2 && document.querySelectorAll(".item.week").length === 2, null, { timeout: 6000 }),
      "and they arrive live on the board, tidied into this week and next",
    );
    const tag = await P.$$eval(".item.note .who-tag span", (els) => els.map((e) => e.textContent).sort().join(","));
    check(tag === "Fen,Gil", `with name tags (${tag})`);
    const read = await tool("read_board");
    const notes = read?.structuredContent?.notes ?? [];
    check(notes.length === 2 && notes[0].text === "Call the printer" && notes[1].time === "08:00" && notes[1].date === later, "it reads the board back, in date order");
    const flyers = notes[1]?.id;
    await tool("update_note", { id: flyers, date: today, who: "" });
    await settle(P.waitForFunction(() => document.querySelectorAll(".item.week").length === 1 && document.querySelectorAll(".item.note .who-tag").length === 1, null, { timeout: 6000 }), "moving a note to today closes next week’s row and drops its tag");
    const mine = await tool("week_as_text", { who: "Fen" });
    check(/Call the printer/.test(mine?.content?.[0]?.text ?? "") && !/Flyers/.test(mine.content[0].text), "the week as text, just Fen’s");
    const cal = await tool("calendar_link", { who: "Fen" });
    check(cal?.structuredContent?.feed?.includes(`/cal/${init.access.cal}.ics?who=Fen`), "the calendar link, just Fen’s");
    const pic = await tool("week_picture");
    if (process.env.BASE_URL) check(pic?.content?.[0]?.type === "image" && pic.content[0].mimeType === "image/png" && pic.content[0].data.length > 20_000, `the week as a picture (${pic?.content?.[0]?.type} ${pic?.content?.[0]?.data?.length ?? pic?.content?.[0]?.text})`);
    else check(pic?.content?.[0]?.type === "image" || /Browser Rendering|didn’t work/.test(pic?.content?.[0]?.text ?? ""), `the week as a picture, or without Browser Rendering why not and the text (${(pic?.content?.[0]?.text ?? pic?.content?.[0]?.type ?? "").slice(0, 60)})`);
    await tool("delete_notes", { ids: [flyers] });
    await settle(P.waitForFunction(() => document.querySelectorAll(".item.note").length === 1, null, { timeout: 6000 }), "and removes a note for everyone");
    // The address is in Share, folded away.
    await P.click(".topbar .share");
    await P.click(".share-ai summary");
    const shown = await P.$eval(".share-ai input", (e) => e.value);
    check(shown === mcpUrl(init.access.mcp), "Share shows the MCP address to people who can edit");
    await P.keyboard.press("Escape");
    const ro = await rawSession(made.id, { owner: made.owner });
    await ro.next(["init"]);
    ro.send({ t: "admin", act: "links" });
    await ro.next(["done"]);
    check((await rpc("tools/list")).status === 404, "new links switch the old MCP address off");
    ro.send({ t: "admin", act: "delete" });
    await ro.next(["done"]);
    for (const x of [rs, rv, ro]) x.close();
  }

  // One address can't start boards without end (only here: it would use up the quota of a real deployment).
  if (!process.env.BASE_URL) {
    let res = null;
    for (let i = 0; i < 40; i++) {
      res = await makeBoard("blank");
      if (res.status !== 201) break;
    }
    const body = await res.json().catch(() => ({}));
    check(res.status === 429 && body.error === "too-many-boards" && Number(res.headers.get("retry-after")) > 0, "starting dozens of boards in an hour is slowed down");
    const T = await person(browser, "Eve", "#FFE38A");
    await T.goto(`${base}/new?template=blank`);
    await T.waitForSelector(".team-form");
    await T.fill(".team-form input", TEAM);
    await T.click(".team-form button[type=submit]");
    await settle(T.waitForFunction(() => /didn’t start/.test(document.body.innerText) && /new boards in one hour/.test(document.body.innerText), null, { timeout: 6000 }), "and the page says why, instead of going blank");
  }

  await browser.close();
} catch (e) {
  failures.push(String(e?.stack ?? e));
  console.error(e);
} finally {
  stopServer();
}

check(errors.length === 0, `no page errors${errors.length ? `:\n  ${errors.join("\n  ")}` : ""}`);
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
