// The people palette: light sherbet colours, so dark ink reads on every note.
// The first five are the example board's five people.
export const PALETTE = ["#FFB38A", "#C9B6FF", "#9DF0C4", "#FFE38A", "#8FD0FF", "#FF9FC0", "#7FE3D6", "#D6EE8A"];
export const INK = "#1B1B1F";
export const CANVAS = "#17181C";
export const CHALK = "#ECE9E2";
export const PAPER = "#F4EFE6";

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hex = (c: number[]) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase();

/** a → b by t. */
export const mix = (a: string, b: string, t: number) => {
  const A = rgb(a);
  const B = rgb(b);
  return hex(A.map((v, i) => v + (B[i] - v) * t));
};
export const alpha = (c: string, a: number) => {
  const [r, g, b] = rgb(c);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** A note's three tones: its paper, the lit top edge and the shade under a curled corner. */
export const tones = (c: string) => ({ base: c, light: mix(c, "#FFFFFF", 0.45), dark: mix(c, "#000000", 0.2) });

/** The first palette colour nobody in the room has taken yet. */
export function freeColor(taken: string[]): string {
  const used = new Set(taken.map((c) => c.toUpperCase()));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[taken.length % PALETTE.length];
}
