#!/usr/bin/env node
// Put Longtable on your own Cloudflare account, on the free plan, with one
// command and one API token:
//
//   npm run setup
//
// It asks for a Cloudflare API token (or reads CLOUDFLARE_API_TOKEN), finds
// your account, installs, builds, deploys, checks the result and prints your
// address and password (the initial one is "longtable"; the site asks you to
// pick your own). Run it again to update; it remembers the account and name
// (never the token) in .longtable-deploy.json.
//
// Without questions (CI, scripts):
//   CLOUDFLARE_API_TOKEN=… npm run setup -- --yes [--name longtable] [--account <id>]
//                                                 [--password <pw> | --password off | --password reset]
// --password fixes the site's password in Cloudflare (the SITE_PASSWORD secret);
// "off" opens the site to everyone; "reset" removes it, so the one picked on
// the site counts again (or the initial one, if none was).
// (CLOUDFLARE_ACCOUNT_ID and LONGTABLE_SITE_PASSWORD work as well as the flags.)
// This file uses nothing but Node itself, so it runs before `npm install`.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { INITIAL_PASSWORD, askHealth, banner } from "./banner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const API = "https://api.cloudflare.com/client/v4";
const SAVED = ".longtable-deploy.json";
const PERMISSIONS = [
  { key: "workers_scripts", type: "edit" },
  { key: "account_settings", type: "read" },
];
const TOKEN_URL =
  "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=" +
  encodeURIComponent(JSON.stringify(PERMISSIONS)) +
  "&accountId=*&zoneId=all&name=" +
  encodeURIComponent("Longtable deploy");

// ------------------------------------------------------------------ helpers
const color = (n) => (s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = color(1);
const dim = color(2);
const green = color(32);
const red = color(31);
const say = (s = "") => console.log(s);
const step = (n, s) => say(`\n${bold(`${n}.`)} ${bold(s)}`);
const fail = (s) => {
  say(`\n${red("✗")} ${s}`);
  process.exit(1);
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const started = Date.now();
const interactive = process.stdin.isTTY && !args.yes;

function ask(question, { hidden = false, def = "" } = {}) {
  if (!interactive) return Promise.resolve(def);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(`${question}${def ? dim(` [${def}]`) : ""} `, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim() || def);
    });
    muted = hidden;
  });
}

function run(cmd, cmdArgs, { input, env, quiet } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
      stdio: [input === undefined ? "inherit" : "pipe", quiet ? "pipe" : "inherit", quiet ? "pipe" : "inherit"],
    });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    }
    child.on("close", (code) => resolve({ code, out }));
  });
}

async function cf(token, method, url, body) {
  let res;
  try {
    res = await fetch(`${API}${url}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    fail(`Could not reach Cloudflare (${e.message}). Check the internet connection and try again.`);
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && data.success !== false, result: data.result, errors: data.errors ?? [] };
}

function loadSaved() {
  try {
    return JSON.parse(readFileSync(SAVED, "utf8"));
  } catch {
    return {};
  }
}

// --------------------------------------------------------------------- main
const saved = loadSaved();
say(bold("\nLongtable · deploy to your Cloudflare account"));
say(dim("Everything runs on Cloudflare's free plan: a Worker for the app, a Durable Object with its own SQLite storage for each board."));

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) fail(`Longtable needs Node 20 or newer (this is ${process.versions.node}). Get it from https://nodejs.org`);

// 1. The token.
step(1, "Cloudflare API token");
let token = process.env.CLOUDFLARE_API_TOKEN?.trim();
if (token) say(`Using the token in ${bold("CLOUDFLARE_API_TOKEN")}.`);
else {
  if (!interactive) fail("Set CLOUDFLARE_API_TOKEN to an API token (see DEPLOY.md).");
  say("Make one (it takes a minute; this link fills in the two permissions it needs):");
  say(`\n  ${TOKEN_URL}\n`);
  say(dim("  Permissions: Account · Workers Scripts · Edit, and Account · Account Settings · Read."));
  say(dim("  Or use the “Edit Cloudflare Workers” template. Then press “Continue to summary” and “Create Token”."));
  token = await ask("Paste the token here (it isn't shown or saved):", { hidden: true });
  if (!token) fail("No token given.");
}

const accounts = await cf(token, "GET", "/accounts?per_page=50");
if (accounts.status === 401 || accounts.status === 403 || (!accounts.ok && accounts.errors.some((e) => e.code === 1000 || e.code === 9109)))
  fail("Cloudflare didn't accept that token. Check it was copied whole, and that it hasn't expired.");
if (!accounts.ok) fail(`Cloudflare said: ${accounts.errors.map((e) => e.message).join("; ") || accounts.status}`);
if (!accounts.result?.length) fail("The token can't see any account. Give it the account permissions above, for your account.");
say(`${green("✓")} Token works.`);

// 2. Which account.
step(2, "Account");
let account =
  accounts.result.find((a) => a.id === (args.account ?? process.env.CLOUDFLARE_ACCOUNT_ID)) ??
  accounts.result.find((a) => a.id === saved.accountId) ??
  (accounts.result.length === 1 ? accounts.result[0] : null);
if (!account) {
  if (!interactive) fail("The token sees several accounts: pass --account <id> or set CLOUDFLARE_ACCOUNT_ID.");
  accounts.result.forEach((a, i) => say(`  ${i + 1}. ${a.name} ${dim(a.id)}`));
  const pick = Number(await ask("Which one?", { def: "1" }));
  account = accounts.result[pick - 1];
  if (!account) fail("No such account.");
}
say(`${green("✓")} ${account.name} ${dim(account.id)}`);

// 3. The workers.dev address.
const sub = await cf(token, "GET", `/accounts/${account.id}/workers/subdomain`);
let subdomain = sub.ok ? sub.result?.subdomain : null;
if (!sub.ok && sub.status === 403) fail("The token can't use Workers on this account. It needs Account · Workers Scripts · Edit.");
if (!subdomain) {
  say("\nThis account has no workers.dev address yet. Pick one: your boards will live at <name>.<this>.workers.dev.");
  const want = (await ask("workers.dev name:", { def: account.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "my-team" })).toLowerCase();
  const made = await cf(token, "PUT", `/accounts/${account.id}/workers/subdomain`, { subdomain: want });
  if (!made.ok) fail(`Couldn't claim “${want}.workers.dev”: ${made.errors.map((e) => e.message).join("; ")}. Try another name.`);
  subdomain = made.result?.subdomain ?? want;
  say(`${green("✓")} ${subdomain}.workers.dev`);
}

// 4. The name.
step(3, "Name");
let name = String(args.name ?? saved.name ?? "");
if (!name) name = await ask("Worker name (part of the address):", { def: "longtable" });
name = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || "longtable";
const url = `https://${name}.${subdomain}.workers.dev`;
say(`${green("✓")} ${url}`);

// 5. The site's password: left as it is unless asked (the old team-password flags still work).
let password = [args.password, args["team-password"], process.env.LONGTABLE_SITE_PASSWORD, process.env.LONGTABLE_TEAM_PASSWORD].find((v) => typeof v === "string" && v !== "");
if (args["no-team-password"]) password = "off";
/** off: no password; reset: back to the one picked on the site; set: fix this one in Cloudflare. */
const mode = password === undefined ? undefined : /^\s*(off|none)\s*$/i.test(password) ? "off" : /^\s*reset\s*$/i.test(password) ? "reset" : "set";
if (mode === "set") {
  if (password.length < 6) fail("Make the password at least 6 characters.");
  if (password.trim().toLowerCase() === INITIAL_PASSWORD) fail(`“${INITIAL_PASSWORD}” is the password every new Longtable starts with. Pick another.`);
}

// 6. Install, build, deploy.
const env = { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account.id, WRANGLER_SEND_METRICS: "false" };
step(4, "Install and build");
if (!existsSync("node_modules/wrangler") || !existsSync("node_modules/vite")) {
  const inst = await run("npm", ["ci", "--no-audit", "--no-fund"]);
  if (inst.code !== 0) fail("npm couldn't install the packages (see above).");
}
const built = await run("npm", ["run", "build"]);
if (built.code !== 0) fail("The build failed (see above).");

step(5, "Deploy");
const dep = await run("npx", ["wrangler", "deploy", "--name", name], { env });
if (dep.code !== 0) fail("wrangler couldn't deploy (see above). If it's about permissions, make the token with the link in step 1.");

const secret = (verb, key, input) => run("npx", ["wrangler", "secret", verb, key, "--name", name], { env: { ...env, CI: "true" }, quiet: true, input });
if (mode === "reset") {
  await secret("delete", "SITE_PASSWORD", "y\n");
  await secret("delete", "CREATE_PASSWORD", "y\n");
  say(`${green("✓")} The password is the one picked on the site again (or ${INITIAL_PASSWORD}, if none was).`);
} else if (mode) {
  const s = await secret("put", "SITE_PASSWORD", mode === "off" ? "off" : password);
  if (s.code !== 0) fail(`Couldn't set the password:\n${s.out}`);
  say(`${green("✓")} ${mode === "off" ? "No password: anyone with the address can open it." : "Password set in Cloudflare (SITE_PASSWORD)."}`);
}

writeFileSync(SAVED, `${JSON.stringify({ accountId: account.id, name, url }, null, 2)}\n`);

// 7. Check it.
step(6, "Check");
const seconds = Math.round((Date.now() - started) / 1000);
// A password just set or removed takes a few seconds to reach every Cloudflare location.
const want = mode === undefined ? undefined : mode === "off" ? "off" : mode === "reset" ? "site" : "fixed";
const stateOf = (h) => (h.password === false ? "off" : h.fixed ? "fixed" : "site");
let healthy = null;
for (let i = 0; i < 20; i++) {
  healthy = await askHealth(url, 0);
  if (healthy && (want === undefined || stateOf(healthy) === want)) break;
  await new Promise((r) => setTimeout(r, 3000));
}
if (!healthy) say(`${red("!")} Deployed, but ${url} doesn't answer yet. New workers.dev addresses can take a few minutes; try it shortly.`);
else say(`${green("✓")} ${url} is up.`);

const state = healthy ? stateOf(healthy) : want;
say(banner({ url, seconds, password: state === "off" ? "off" : state === "fixed" ? "fixed" : "initial" }));
say(dim("Boards are stored in your Cloudflare account. To update later, get the new code and run npm run setup again."));
say(dim("Your own domain, or a company login in front: see DEPLOY.md."));
