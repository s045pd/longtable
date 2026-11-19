// The week as a picture: every note that names a day as a card in its day's
// column, a band for each week, the board's photos and checklists underneath.
// Drawn on a canvas with the app's own fonts, so it looks like the board and
// can go into a chat, a slide or a printout. With `who`, only that person's
// notes, as their own week.
import { DAY_HEADERS, addDays, formatTime, isFor, mondayOf, noteDay, noteTime, noteWeek, noteWho, parseIso } from "../shared/days";
import { localIso } from "../shared/plan";
import { boardTitle } from "../shared/exporter";
import type { CheckItem, Item, Meta, NoteItem, PhotoItem } from "../shared/types";
import { artSvg } from "./art";
import { nameColor } from "./views";

const SANS = `"Inter Variable", "PingFang SC", "Noto Sans SC", system-ui, sans-serif`;
const DISPLAY = `"Bricolage Grotesque Variable", ${SANS}`;
const MONO = `"JetBrains Mono Variable", ui-monospace, Menlo, monospace`;
const HAND = `"Caveat Variable", "Bradley Hand", cursive`;
const INK = "#1B1B1F";
const CHALK = "#ECE9E2";
const MUTED = "#8E919C";
const BG = "#17181C";

const PAD = 56;
const COL = 212;
const PITCH = 228;
const CARD_PAD = 14;
const LINE = 21;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Card {
  note: NoteItem;
  time: number | null;
  who: string;
  lines: string[];
  h: number;
}

const TOKENS = /[⺀-鿿豈-﫿＀-￯　-〿]|[^\s⺀-鿿豈-﫿＀-￯　-〿]+|[ \t]+/g;

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines = 6): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const tok of para.match(TOKENS) ?? [""]) {
      const next = line + tok;
      if (!line || ctx.measureText(next.trimEnd()).width <= width) {
        line = next;
        while (ctx.measureText(line.trimEnd()).width > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > width) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
        continue;
      }
      out.push(line.trimEnd());
      line = tok.trimStart();
    }
    out.push(line.trimEnd());
  }
  const lines = out.filter((l, i) => l || i < out.length - 1);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.?$/, "…");
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const short = (iso: string) => {
  const d = parseIso(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

function loadArt(art: PhotoItem["art"]): Promise<HTMLImageElement | null> {
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artSvg(art).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '))}`;
  });
}

/** The picture, as a PNG. */
export async function weekPicture(meta: Meta, items: Item[], opts: { who?: string; scale?: number; today?: string } = {}): Promise<Blob> {
  await Promise.all(
    [`600 17px ${SANS}`, `700 20px ${SANS}`, `700 38px ${DISPLAY}`, `500 12px ${MONO}`, `600 22px ${HAND}`].map((f) => document.fonts.load(f).catch(() => [])),
  );
  const who = opts.who?.trim() ?? "";
  const weekOf = meta.weekOf;
  const notes = items.filter((it): it is NoteItem => it.type === "note" && it.text.trim() !== "" && (!who || isFor(it, who)));
  const photos = who ? [] : items.filter((it): it is PhotoItem => it.type === "photo");
  const checks = who ? [] : items.filter((it): it is CheckItem => it.type === "check");

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `600 17px ${SANS}`;

  // Weeks → columns → cards, in date and time order.
  const weeks = new Map<string, Card[][]>();
  for (const n of notes) {
    const key = noteWeek(n, weekOf);
    if (!weeks.has(key)) weeks.set(key, Array.from({ length: 8 }, () => []));
    const time = noteTime(n);
    const tag = noteWho(n);
    const lines = wrap(measure, n.text.trim(), COL - CARD_PAD * 2);
    const h = CARD_PAD + (time !== null ? 20 : 0) + lines.length * LINE + (tag || n.votes ? 40 : 6) + CARD_PAD - 4;
    weeks.get(key)![noteDay(n) ?? 7].push({ note: n, time, who: tag, lines, h: Math.max(h, 92) });
  }
  for (const cols of weeks.values())
    for (const col of cols)
      col.sort((a, b) => (a.time === null ? -1 : b.time === null ? 1 : a.time - b.time) || (Math.abs(a.note.y - b.note.y) > 60 ? a.note.y - b.note.y : a.note.x - b.note.x));
  const keys = [...weeks.keys()].sort();
  if (!keys.length) keys.push(weekOf);
  const cols = Math.max(7, ...keys.map((k) => (weeks.get(k)?.[7].length ? 8 : 7)));

  // Layout, top to bottom.
  const width = PAD * 2 + (cols - 1) * PITCH + COL;
  let y = PAD + 92;
  const bands = keys.map((key) => {
    const columns = weeks.get(key) ?? Array.from({ length: 8 }, () => []);
    const top = y + (keys.length > 1 ? 26 : 0);
    const cardsTop = top + 46;
    const tallest = Math.max(92, ...columns.map((c) => c.reduce((s, card) => s + card.h + 12, 0)));
    y = cardsTop + tallest + 40;
    return { key, columns, top, cardsTop };
  });
  const extras = photos.length + checks.length;
  const extraTop = y + 10;
  let extraH = 0;
  if (extras) {
    const checkH = (c: CheckItem) => 58 + Math.max(1, c.rows.length) * 30;
    extraH = 36 + Math.max(photos.length ? 236 : 0, ...checks.map(checkH));
    y = extraTop + extraH + 24;
  }
  const height = y + 40;

  const scale = Math.min(opts.scale ?? 2, 14000 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // The board's dark canvas and dot grid.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#24262D";
  for (let gy = 12; gy < height; gy += 24) for (let gx = 12; gx < width; gx += 24) ctx.fillRect(gx, gy, 1.6, 1.6);

  // Title.
  ctx.fillStyle = CHALK;
  ctx.font = `700 38px ${DISPLAY}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(boardTitle(meta) + (who ? ` · ${who}` : ""), PAD, PAD + 34);
  ctx.font = `500 13px ${MONO}`;
  ctx.fillStyle = MUTED;
  const first = keys[0];
  const last = keys[keys.length - 1];
  const span = first ? (keys.length > 1 ? `${short(first)} – ${short(addDays(last, 6))}` : `WEEK OF ${short(first)}`) : "";
  const count = `${notes.length} NOTE${notes.length === 1 ? "" : "S"}`;
  ctx.fillText([span.toUpperCase(), count].filter(Boolean).join("  ·  "), PAD, PAD + 64);

  // The weeks.
  for (const band of bands) {
    if (keys.length > 1 && band.key) {
      ctx.font = `600 12px ${MONO}`;
      ctx.fillStyle = MUTED;
      const now = mondayOf(opts.today || localIso());
      const label = band.key === now ? "THIS WEEK" : band.key === addDays(now, 7) ? "NEXT WEEK" : "";
      ctx.fillText(`${label ? `${label} · ` : ""}${short(band.key).toUpperCase()} – ${short(addDays(band.key, 6)).toUpperCase()}`, PAD, band.top - 10);
    }
    const n = band.columns[7].length ? 8 : 7;
    for (let c = 0; c < n; c++) {
      const x = PAD + c * PITCH;
      ctx.font = `700 20px ${SANS}`;
      ctx.fillStyle = CHALK;
      const head = c < 7 ? DAY_HEADERS[c] : "ANY DAY";
      ctx.save();
      ctx.letterSpacing = "3px";
      ctx.fillText(head, x, band.top + 20);
      ctx.restore();
      if (c < 7 && band.key) {
        ctx.font = `500 12px ${MONO}`;
        ctx.fillStyle = MUTED;
        const d = short(addDays(band.key, c)).toUpperCase();
        ctx.fillText(d, x + COL - ctx.measureText(d).width, band.top + 18);
      }
      ctx.fillStyle = "#4A4D59";
      roundRect(ctx, x, band.top + 30, COL, 2.5, 1.25);
      ctx.fill();
      let cy = band.cardsTop;
      for (const card of band.columns[c]) {
        drawCard(ctx, card, x, cy);
        cy += card.h + 12;
      }
    }
  }

  // Photos and checklists.
  if (extras) {
    ctx.font = `600 12px ${MONO}`;
    ctx.fillStyle = MUTED;
    ctx.fillText("ALSO ON THE BOARD", PAD, extraTop);
    let x = PAD;
    const top = extraTop + 20;
    const arts = await Promise.all(photos.map((p) => loadArt(p.art)));
    photos.forEach((p, i) => {
      if (x + 184 > width - PAD) return;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.45)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = "#F5F1E8";
      roundRect(ctx, x, top, 184, 212, 4);
      ctx.fill();
      ctx.restore();
      const img = arts[i];
      if (img) ctx.drawImage(img, x + 12, top + 12, 160, 132);
      ctx.fillStyle = "#2B2B30";
      ctx.font = `600 24px ${HAND}`;
      const cap = p.caption.trim();
      ctx.fillText(cap, x + 92 - Math.min(160, ctx.measureText(cap).width) / 2, top + 184, 160);
      x += 184 + 24;
    });
    for (const c of checks) {
      if (x + 236 > width - PAD) break;
      const h = 58 + Math.max(1, c.rows.length) * 30;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.45)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = "#F3EFE7";
      roundRect(ctx, x, top, 236, h, 6);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = c.color;
      roundRect(ctx, x, top, 236, 7, 3);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.font = `700 17px ${SANS}`;
      ctx.fillText(c.title || "Checklist", x + 16, top + 36, 204);
      c.rows.forEach((r, i) => {
        const ry = top + 52 + i * 30;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        roundRect(ctx, x + 16, ry + 2, 17, 17, 4);
        ctx.stroke();
        if (r.done) {
          ctx.fillStyle = "#6B4CE6";
          roundRect(ctx, x + 16, ry + 2, 17, 17, 4);
          ctx.fill();
          ctx.strokeStyle = "#FFFFFF";
          ctx.beginPath();
          ctx.moveTo(x + 20, ry + 11);
          ctx.lineTo(x + 23.5, ry + 14.5);
          ctx.lineTo(x + 29, ry + 7);
          ctx.stroke();
        }
        ctx.fillStyle = r.done ? "#6E6C68" : INK;
        ctx.font = `500 15px ${SANS}`;
        ctx.fillText(r.text, x + 42, ry + 16, 180);
      });
      x += 236 + 24;
    }
  }

  // Signed, small.
  ctx.font = `600 12px ${MONO}`;
  ctx.fillStyle = "#5C5F6B";
  const sign = "LONGTABLE · PLAN IT TOGETHER";
  ctx.fillText(sign, width - PAD - ctx.measureText(sign).width, height - 24);

  return new Promise((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error("No picture"))), "image/png"));
}

function drawCard(ctx: CanvasRenderingContext2D, card: Card, x: number, y: number) {
  const n = card.note;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.42)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = n.color;
  roundRect(ctx, x, y, COL, card.h, 5);
  ctx.fill();
  ctx.restore();
  let ty = y + CARD_PAD;
  if (card.time !== null) {
    ctx.font = `600 12px ${MONO}`;
    ctx.fillStyle = "rgba(27,27,31,.62)";
    ctx.fillText(formatTime(card.time), x + CARD_PAD, ty + 11);
    ty += 20;
  }
  ctx.fillStyle = INK;
  ctx.font = `600 17px ${SANS}`;
  for (const line of card.lines) {
    ctx.fillText(line, x + CARD_PAD, ty + 16);
    ty += LINE;
  }
  const bottom = y + card.h - CARD_PAD;
  // Votes: dots in each voter's colour.
  const votes = Object.values(n.votes ?? {}).slice(0, 6);
  votes.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(x + CARD_PAD + 9 + i * 15, bottom - 11, 8, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  });
  if (card.who) {
    ctx.font = `600 12.5px ${SANS}`;
    const name = card.who.length > 16 ? `${card.who.slice(0, 15)}…` : card.who;
    const w = 26 + ctx.measureText(name).width + 10;
    const px = x + COL - CARD_PAD - w + 4;
    const py = bottom - 24;
    ctx.fillStyle = "rgba(23,24,28,.86)";
    roundRect(ctx, px, py, w, 24, 12);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px + 12, py + 12, 9, 0, Math.PI * 2);
    ctx.fillStyle = nameColor(card.who);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = `700 10.5px ${SANS}`;
    const initial = card.who.charAt(0).toUpperCase();
    ctx.fillText(initial, px + 12 - ctx.measureText(initial).width / 2, py + 16);
    ctx.fillStyle = "#ECEBE6";
    ctx.font = `600 12.5px ${SANS}`;
    ctx.fillText(name, px + 26, py + 16.5);
  }
}

/** A file name for the picture. */
export const pictureName = (stem: string, who?: string) => `${stem}${who ? `-${who.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-")}` : ""}.png`;
