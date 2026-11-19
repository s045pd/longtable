// What a deploy ends with: where your Longtable is, how to get in, and how
// long it took. Used by `npm run deploy` (and so by the Deploy to Cloudflare
// button) and by `npm run setup`. Nothing but Node itself.

/** The password every new Longtable starts with. Keep in step with INITIAL_SITE_PASSWORD in worker/access.ts. */
export const INITIAL_PASSWORD = "longtable";

/** The workers.dev address wrangler printed, if it printed one. */
export function addressIn(output) {
  const m = /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev\b/i.exec(output);
  return m ? m[0] : null;
}

/**
 * Ask the new Longtable whether it asks for a password. A new workers.dev
 * address can take a little while to answer, so try for up to `seconds`.
 */
export async function askHealth(url, seconds = 30) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    try {
      const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return await r.json();
    } catch {
      // not answering yet
    }
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/**
 * The closing box. `password`: "initial" (nothing set in Cloudflare), "fixed"
 * (SITE_PASSWORD set to a password), "off", or "unknown" when the site didn't answer.
 */
export function banner({ url, password, seconds }) {
  const rule = "─".repeat(64);
  const lines = ["", rule, `  Longtable is live${seconds ? ` · deployed in ${seconds} s` : ""}`, ""];
  lines.push(`  Address   ${url ?? "see the workers.dev address above, or Workers → your worker → Settings → Domains & Routes"}`);
  if (password === "off") {
    lines.push("  Password  none: anyone with the address can open it (SITE_PASSWORD is off)");
  } else if (password === "fixed") {
    lines.push("  Password  the one set in Cloudflare as SITE_PASSWORD");
  } else {
    lines.push(`  Password  ${INITIAL_PASSWORD}`);
    lines.push("            The initial password, the same for every new Longtable.");
    lines.push("            Open the address, come in with it, and it asks you to pick");
    lines.push("            your own. Already picked one? Then it's yours.");
  }
  lines.push("", "  Board links you send people open without the password.", rule, "");
  return lines.join("\n");
}
