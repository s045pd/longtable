// Setting a note's words: the largest size (28 down to 13) at which every
// line fits the note's square. Lines break at spaces, and anywhere in
// Chinese or Japanese text; a line the writer broke stays broken.
const BOX = 164;
const HEIGHT = 162;
const MAX = 28;
const MIN = 13;
export const NOTE_FONT = (px: number) => `600 ${px}px "Inter Variable", "PingFang SC", "Noto Sans SC", system-ui, sans-serif`;
export const LABEL_FONT = `700 46px "Inter Variable", "PingFang SC", "Noto Sans SC", system-ui, sans-serif`;

const ctx = document.createElement("canvas").getContext("2d")!;
const cache = new Map<string, Fit>();

export interface Fit {
  size: number;
  lines: string[];
  /** True when even the smallest size could not hold everything. */
  clipped: boolean;
}

const TOKENS = /[⺀-鿿豈-﫿＀-￯　-〿]|[^\s⺀-鿿豈-﫿＀-￯　-〿]+|[ \t]+/g;

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const tokens = para.match(TOKENS) ?? [""];
    let line = "";
    for (const tok of tokens) {
      const next = line + tok;
      if (!line || ctx.measureText(next.trimEnd()).width <= width) {
        line = next;
        // One word wider than the note breaks by letters.
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
  return out;
}

export function fitNote(text: string): Fit {
  const hit = cache.get(text);
  if (hit) return hit;
  let fit: Fit | null = null;
  for (let size = MAX; size >= MIN; size--) {
    ctx.font = NOTE_FONT(size);
    const lines = wrap(text, BOX);
    if (lines.length * size * 1.16 <= HEIGHT) {
      fit = { size, lines, clipped: false };
      break;
    }
  }
  if (!fit) {
    ctx.font = NOTE_FONT(MIN);
    const lines = wrap(text, BOX);
    const room = Math.floor(HEIGHT / (MIN * 1.16));
    const kept = lines.slice(0, room);
    kept[room - 1] = (kept[room - 1] ?? "").replace(/.?$/, "…");
    fit = { size: MIN, lines: kept, clipped: true };
  }
  if (cache.size > 2000) cache.clear();
  cache.set(text, fit);
  return fit;
}

export function measureLabel(text: string): number {
  ctx.font = LABEL_FONT;
  return ctx.measureText(text).width;
}

/** Forget measurements made before the web fonts arrived. */
export function resetFits() {
  cache.clear();
}
