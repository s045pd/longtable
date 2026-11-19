// The week as a picture for an AI assistant (the week_picture MCP tool). A
// headless browser from Cloudflare Browser Rendering opens this Longtable's
// own picture page (picture.html), which draws the week exactly like Export →
// Picture, fonts and all, and hands back the PNG. The board's notes go to the
// page in the call, never in an address.
import puppeteer from "@cloudflare/puppeteer";
import type { Item, Meta } from "../src/shared/types";

export interface PictureRequest {
  meta: Meta;
  items: Item[];
  who?: string;
  today?: string;
}

/** How long the whole drawing may take. */
const TIMEOUT_MS = 30_000;
/** The longest wait for a browser worth making the assistant sit through, and how often to ask meanwhile. */
const WAIT_MAX_MS = 22_000;
const RETRY_MS = 5_000;

/** No browser to be had for a while (the free plan starts one every 20 seconds, three at once). */
export class BrowserBusy extends Error {
  constructor(public wait: number) {
    super(`no browser for ${wait} s`);
  }
}

/**
 * A browser, closed again as soon as the picture is drawn: browser time is
 * what the free plan counts (10 minutes a day), and a picture takes a few
 * seconds of it. When the last one started moments ago, keep trying for up to
 * 20 seconds rather than fail.
 */
async function browserFor(binding: Fetcher) {
  const b = binding as never;
  // Browser Rendering's own count of what is allowed lags behind, so just try again a few times.
  for (let waited = 0; ; waited += RETRY_MS) {
    try {
      return await puppeteer.launch(b);
    } catch (e) {
      if (!/429|rate limit/i.test(String((e as Error)?.message ?? e))) throw e;
      if (waited + RETRY_MS > WAIT_MAX_MS) throw new BrowserBusy(20);
    }
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
}

/** Draw the week; returns the PNG as base64. Throws when the browser can't be had or the drawing fails. */
export async function drawWeek(binding: Fetcher, origin: string, req: PictureRequest): Promise<string> {
  const browser = await browserFor(binding);
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    await page.goto(`${origin}/picture.html`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof (globalThis as { drawWeek?: unknown }).drawWeek === "function");
    const png = await page.evaluate((r: PictureRequest) => (globalThis as unknown as { drawWeek: (r: PictureRequest) => Promise<string> }).drawWeek(r), req);
    if (typeof png !== "string" || !png) throw new Error("the picture page drew nothing");
    return png;
  } finally {
    await browser.close().catch(() => {});
  }
}
