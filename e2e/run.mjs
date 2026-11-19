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
// security headers are there. No page errors anywhere.
import { spawn } from "node:child_process";
import { chromium, devices } from "playwright";

const PORT = 8790 + Math.floor(Math.random() * 100);
let base = process.env.BASE_URL;
// The local server gets a team password; against BASE_URL, pass the deployment's own (if it has one).
const TEAM = process.env.BASE_URL ? process.env.TEAM_PASSWORD : "e2e-team-password";
let server = null;
const failures = [];
const errors = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  server = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--var", `CREATE_PASSWORD:${TEAM}`], {
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
  const links = await A.$$eval(".share-dialog input[readonly]", (els) => els.map((e) => e.value));
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
  const settings = async () => {
    await A.click(".topbar .share");
    await A.click(".share-dialog [data-act='settings']");
    await A.waitForSelector(".settings-dialog.open");
  };
  await settings();
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
