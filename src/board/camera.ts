// The view onto the board: which world point is at the middle of the screen
// and how far in we are. It can glide to a target (fit, follow, after a tidy).
import type { Box } from "../shared/geometry";

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 4;

export interface View {
  x: number;
  y: number;
  z: number;
}

/** Space the chrome takes on each side, so fitting keeps things clear of it. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const clampZ = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export class Camera {
  x = 0;
  y = 0;
  z = 1;
  w = 1;
  h = 1;
  private glide: { from: View; to: View; t0: number; ms: number } | null = null;
  /** A target that is chased rather than reached on a timer (following someone). */
  chase: View | null = null;
  version = 0;

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.version++;
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / this.z + this.x, (sy - this.h / 2) / this.z + this.y];
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.z + this.w / 2, (wy - this.y) * this.z + this.h / 2];
  }

  set(v: View) {
    this.x = v.x;
    this.y = v.y;
    this.z = clampZ(v.z);
    this.version++;
  }

  stop() {
    this.glide = null;
    this.chase = null;
  }

  /** Pan by a screen distance. */
  pan(dx: number, dy: number) {
    this.stop();
    this.x -= dx / this.z;
    this.y -= dy / this.z;
    this.version++;
  }

  /** Zoom by a factor, keeping the world point under (sx, sy) where it is. */
  zoomAt(sx: number, sy: number, factor: number) {
    this.stop();
    const [wx, wy] = this.toWorld(sx, sy);
    this.z = clampZ(this.z * factor);
    this.x = wx - (sx - this.w / 2) / this.z;
    this.y = wy - (sy - this.h / 2) / this.z;
    this.version++;
  }

  /** The view that shows a box whole, inside the given insets. */
  fitView(box: Box, insets: Insets, maxZoom = 1.2, pad = 60): View {
    const w = Math.max(1, this.w - insets.left - insets.right - pad * 2);
    const h = Math.max(1, this.h - insets.top - insets.bottom - pad * 2);
    const z = clampZ(Math.min(maxZoom, w / Math.max(1, box.x1 - box.x0), h / Math.max(1, box.y1 - box.y0)));
    // Centre the box in the free area, not the whole screen.
    const cx = (box.x0 + box.x1) / 2 - (insets.left - insets.right) / 2 / z;
    const cy = (box.y0 + box.y1) / 2 - (insets.top - insets.bottom) / 2 / z;
    return { x: cx, y: cy, z };
  }

  glideTo(to: View, ms = 650) {
    this.chase = null;
    this.glide = { from: { x: this.x, y: this.y, z: this.z }, to: { ...to, z: clampZ(to.z) }, t0: performance.now(), ms };
  }

  get moving() {
    return this.glide !== null || this.chase !== null;
  }

  /** Advance a glide or a chase. Returns true when the view changed. */
  tick(now: number, dt: number): boolean {
    if (this.glide) {
      const { from, to, t0, ms } = this.glide;
      const p = Math.min(1, (now - t0) / ms);
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      // Zoom moves in log space so it feels even.
      const z = Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * e);
      this.x = from.x + (to.x - from.x) * e;
      this.y = from.y + (to.y - from.y) * e;
      this.z = z;
      if (p >= 1) this.glide = null;
      this.version++;
      return true;
    }
    if (this.chase) {
      // Ease behind the person we follow, never quite still.
      const k = 1 - Math.exp(-dt * 5);
      const t = this.chase;
      const dx = t.x - this.x;
      const dy = t.y - this.y;
      const dz = Math.log(t.z) - Math.log(this.z);
      if (Math.abs(dx) * this.z < 0.3 && Math.abs(dy) * this.z < 0.3 && Math.abs(dz) < 0.001) return false;
      this.x += dx * k;
      this.y += dy * k;
      this.z = Math.exp(Math.log(this.z) + dz * k);
      this.version++;
      return true;
    }
    return false;
  }

  /** The world rectangle on screen. */
  visible(): Box {
    const [x0, y0] = this.toWorld(0, 0);
    const [x1, y1] = this.toWorld(this.w, this.h);
    return { x0, y0, x1, y1 };
  }
}
