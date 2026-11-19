// Sizes and outlines of board items, in world units.
import type { Item } from "./types";

export const NOTE = 200;
export const PHOTO = { w: 184, h: 212 };
export const CHECK = { w: 236, head: 70, row: 44, foot: 22 };
export const LABEL_SIZE = 46;
/** The tidy's grid: one column per day, one row per note. */
export const PITCH_X = 232;
export const PITCH_Y = 224;
/** From a week's first cell centre up to its header baseline. */
export const HEADER_GAP = 132;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

let measureLabel = (text: string) => Math.max(1, text.length) * LABEL_SIZE * 0.56;
/** The browser swaps in a real text measure once the fonts are ready. */
export function setLabelMeasure(fn: (text: string) => number) {
  measureLabel = fn;
}

export const checkHeight = (rows: number) => CHECK.head + Math.max(1, rows) * CHECK.row + CHECK.foot;

/** An item's outline, ignoring its small tilt. */
export function bounds(item: Item): Box {
  const { x, y } = item;
  switch (item.type) {
    case "note":
      return { x0: x - NOTE / 2, y0: y - NOTE / 2, x1: x + NOTE / 2, y1: y + NOTE / 2 };
    case "photo":
      return { x0: x - PHOTO.w / 2, y0: y - PHOTO.h / 2, x1: x + PHOTO.w / 2, y1: y + PHOTO.h / 2 };
    case "check": {
      const h = checkHeight(item.rows.length);
      return { x0: x - CHECK.w / 2, y0: y - h / 2, x1: x + CHECK.w / 2, y1: y + h / 2 };
    }
    case "label": {
      const w = measureLabel(item.text || " ") + 8;
      return { x0: x - w / 2, y0: y - LABEL_SIZE * 0.72, x1: x + w / 2, y1: y + LABEL_SIZE * 0.5 };
    }
    case "stroke": {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < item.pts.length; i += 2) {
        x0 = Math.min(x0, item.pts[i]);
        x1 = Math.max(x1, item.pts[i]);
        y0 = Math.min(y0, item.pts[i + 1]);
        y1 = Math.max(y1, item.pts[i + 1]);
      }
      if (!Number.isFinite(x0)) return { x0: x, y0: y, x1: x, y1: y };
      const r = item.width / 2 + 2;
      return { x0: x + x0 - r, y0: y + y0 - r, x1: x + x1 + r, y1: y + y1 + r };
    }
    case "week": {
      const w = (item.cols - 1) * PITCH_X + NOTE;
      return { x0: x - NOTE / 2, y0: y - HEADER_GAP - 34, x1: x - NOTE / 2 + w, y1: y - HEADER_GAP + 22 };
    }
  }
}

export function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return boxes.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
}

export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
