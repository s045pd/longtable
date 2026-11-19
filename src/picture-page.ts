// The page a headless browser opens to draw a board's week for an AI that
// asked for it over MCP (worker/picture.ts): the same drawing as Export →
// Picture, with the same fonts. It holds no board of its own: the Worker
// hands it the board's notes, and it hands back the PNG.
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "@fontsource-variable/caveat/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import { weekPicture } from "./board/picture";
import type { Item, Meta } from "./shared/types";

export interface PictureRequest {
  meta: Meta;
  items: Item[];
  who?: string;
  today?: string;
}

declare global {
  interface Window {
    drawWeek?: (req: PictureRequest) => Promise<string>;
  }
}

window.drawWeek = async (req) => {
  const blob = await weekPicture(req.meta, req.items, { who: req.who, today: req.today, scale: 1 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
document.documentElement.dataset.ready = "1";
