#!/usr/bin/env node
// npm run deploy: build, deploy with wrangler, then say where your Longtable
// is, its password and how long it took. Cloudflare's own builds (the Deploy
// to Cloudflare button) run this as their deploy command; there the build
// step has already made dist/, so it isn't built a second time.
// Anything after `--` goes to wrangler deploy (for example --name).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addressIn, askHealth, banner } from "./banner.mjs";

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const started = Date.now();

/** Run a command, showing its output as it goes; resolves with its exit code and everything it printed. */
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: process.platform === "win32", stdio: ["inherit", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      out += d;
      process.stderr.write(d);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

if (!(process.env.WORKERS_CI && existsSync("dist/index.html"))) {
  const built = await run("npm", ["run", "build"]);
  if (built.code !== 0) process.exit(built.code);
}

const deployed = await run("npx", ["wrangler", "deploy", ...process.argv.slice(2)]);
if (deployed.code !== 0) process.exit(deployed.code);

const seconds = Math.round((Date.now() - started) / 1000);
const url = addressIn(deployed.out);
// A brand-new workers.dev address can take a minute to answer; don't hold the deploy up for long.
const health = url ? await askHealth(url, 20) : null;
console.log(banner({ url, seconds, password: health?.password === false ? "off" : health?.fixed ? "fixed" : "initial" }));
