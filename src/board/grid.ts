// The dark canvas and its dot grid. Fine dots show when you are close; far
// out they fade and a coarser grid takes over, so the board never turns to
// noise. Drawn on one screen-sized canvas whenever the view changes.
import { CANVAS } from "../shared/colors";
import type { Camera } from "./camera";

const DOT = "#2A2C33";

export class Grid {
  private ctx: CanvasRenderingContext2D;
  private drawn = -1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
  }

  draw(cam: Camera) {
    if (cam.version === this.drawn) return;
    this.drawn = cam.version;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(cam.w * dpr);
    const H = Math.round(cam.h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = CANVAS;
    ctx.fillRect(0, 0, cam.w, cam.h);
    const fine = Math.min(1, Math.max(0, (cam.z - 0.45) / 0.4));
    if (fine > 0.02) this.dots(cam, 40, Math.min(2.2, Math.max(0.9, 1.3 * cam.z)), fine, DOT);
    const coarse = cam.z < 0.16 ? 1000 : 200;
    this.dots(cam, coarse, Math.min(3, Math.max(1.2, 2.4 * cam.z * (coarse / 200) ** 0.5)), 1, fine > 0.5 ? "#30323B" : "#353842");
  }

  private dots(cam: Camera, step: number, r: number, a: number, color: string) {
    const ctx = this.ctx;
    const [left, top] = cam.toWorld(0, 0);
    const [right, bottom] = cam.toWorld(cam.w, cam.h);
    const x0 = Math.ceil(left / step) * step;
    const y0 = Math.ceil(top / step) * step;
    if ((right - left) / step * ((bottom - top) / step) > 40000) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let wx = x0; wx <= right; wx += step) {
      const sx = (wx - cam.x) * cam.z + cam.w / 2;
      for (let wy = y0; wy <= bottom; wy += step) {
        const sy = (wy - cam.y) * cam.z + cam.h / 2;
        if (r < 1.6) ctx.rect(sx - r / 2, sy - r / 2, r, r);
        else {
          ctx.moveTo(sx + r / 2, sy);
          ctx.arc(sx, sy, r / 2, 0, 7);
        }
      }
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
