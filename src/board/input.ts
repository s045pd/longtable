// Pointer, touch and keyboard. One gesture at a time: pan, pinch, marquee,
// drag, or draw. A press only becomes a drag after it has moved a few
// pixels, so a click stays a click.
import type { Item, Op } from "../shared/types";
import type { Board } from "./app";

type Gesture =
  | { kind: "none" }
  | { kind: "pan"; id: number; lx: number; ly: number }
  | { kind: "pinch"; d0: number; z0: number; cx: number; cy: number }
  | { kind: "marquee"; id: number; x0: number; y0: number; add: Set<string> }
  | {
      kind: "press";
      id: number;
      sx: number;
      sy: number;
      target: string;
      alt: boolean;
      wasSelected: boolean;
      shift: boolean;
    }
  | { kind: "drag"; id: number; wx: number; wy: number; start: Map<string, { x: number; y: number }>; lastSend: number; raise: Op[] }
  | { kind: "draw"; id: number; stroke: string; ox: number; oy: number; pts: number[]; lastSend: number };

const DRAG_SLOP = 4;
const SEND_MS = 40;

export function attachInput(board: Board) {
  const stage = board.stage;
  const pointers = new Map<number, { x: number; y: number; type: string }>();
  let g: Gesture = { kind: "none" };
  let space = false;
  let lastTap = { t: 0, x: 0, y: 0, target: "" };

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const world = (e: { clientX: number; clientY: number }) => {
    const [sx, sy] = local(e);
    return board.cam.toWorld(sx, sy);
  };
  const itemAt = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>(".item")?.dataset.id ?? null;

  const stopFollowing = () => {
    if (board.following) board.follow(null);
  };

  stage.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    // The board handles its own presses: no text selection, and no focus
    // jumping to the page (which would close an editor opened by this press).
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement && !board.editor.id) document.activeElement.blur();
    stage.setPointerCapture(e.pointerId);
    const [sx, sy] = local(e);
    pointers.set(e.pointerId, { x: sx, y: sy, type: e.pointerType });

    // A second finger turns whatever was happening into a pinch.
    if (pointers.size === 2) {
      cancelGesture();
      const [a, b] = [...pointers.values()];
      g = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), z0: board.cam.z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (pointers.size > 2) return;

    const target = itemAt(e);
    const tick = (e.target as HTMLElement).closest<HTMLElement>(".tick");
    const [wx, wy] = world(e);

    if (board.editor.id && board.editor.id !== target) board.editor.commit();

    if (e.button === 1 || space || board.tool === "hand") {
      stopFollowing();
      g = { kind: "pan", id: e.pointerId, lx: sx, ly: sy };
      board.root.classList.add("panning");
      return;
    }

    if (board.tool === "pen") {
      const id = board.newItemId();
      const z = board.topZ();
      board.commit([{ op: "put", item: { id, type: "stroke", x: Math.round(wx), y: Math.round(wy), rot: 0, z, by: board.me.name, color: board.me.color, width: 6, pts: [0, 0] } }], { history: false });
      g = { kind: "draw", id: e.pointerId, stroke: id, ox: Math.round(wx), oy: Math.round(wy), pts: [0, 0], lastSend: performance.now() };
      board.link.presence({ pen: true });
      return;
    }

    if (board.tool === "note" || board.tool === "text" || board.tool === "check") {
      if (board.tool === "note") board.addNote(wx, wy);
      else if (board.tool === "text") board.addLabel(wx, wy);
      else board.addChecklist(wx, wy);
      board.setTool("select");
      return;
    }

    // Select tool.
    if (tick && target) {
      board.toggleRow(target, Number(tick.dataset.row));
      return;
    }
    if (target) {
      if (board.editor.id === target) return;
      g = { kind: "press", id: e.pointerId, sx, sy, target, alt: e.altKey, wasSelected: board.sel.has(target), shift: e.shiftKey };
      if (e.shiftKey) {
        const next = new Set(board.sel);
        if (next.has(target)) next.delete(target);
        else next.add(target);
        board.setSelection(next);
      } else if (!board.sel.has(target)) board.setSelection([target]);
      return;
    }
    // Empty canvas: a mouse draws a marquee; a finger pans.
    if (e.pointerType === "mouse") {
      g = { kind: "marquee", id: e.pointerId, x0: sx, y0: sy, add: e.shiftKey ? new Set(board.sel) : new Set() };
      if (!e.shiftKey) board.setSelection([]);
    } else {
      g = { kind: "pan", id: e.pointerId, lx: sx, ly: sy };
      board.setSelection([]);
    }
  });

  stage.addEventListener("pointermove", (e) => {
    const [sx, sy] = local(e);
    const p = pointers.get(e.pointerId);
    if (p) {
      p.x = sx;
      p.y = sy;
    }
    const [wx, wy] = board.cam.toWorld(sx, sy);
    if (e.pointerType === "mouse" || p) {
      board.pointer = [wx, wy];
      board.link.presence({ c: [Math.round(wx), Math.round(wy)] });
    }

    switch (g.kind) {
      case "pinch": {
        const [a, b] = [...pointers.values()];
        if (!a || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        stopFollowing();
        board.cam.pan(cx - g.cx, cy - g.cy);
        board.cam.zoomAt(cx, cy, (g.z0 * (d / Math.max(1, g.d0))) / board.cam.z);
        g.cx = cx;
        g.cy = cy;
        return;
      }
      case "pan":
        if (e.pointerId !== g.id) return;
        stopFollowing();
        board.cam.pan(sx - g.lx, sy - g.ly);
        g.lx = sx;
        g.ly = sy;
        return;
      case "marquee": {
        if (e.pointerId !== g.id) return;
        const x = Math.min(g.x0, sx);
        const y = Math.min(g.y0, sy);
        const w = Math.abs(sx - g.x0);
        const h = Math.abs(sy - g.y0);
        Object.assign(board.marquee.style, { display: "block", left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        const [ax, ay] = board.cam.toWorld(x, y);
        const [bx, by] = board.cam.toWorld(x + w, y + h);
        board.setSelection(new Set([...g.add, ...board.itemsIn({ x0: ax, y0: ay, x1: bx, y1: by })]));
        return;
      }
      case "press": {
        if (e.pointerId !== g.id || Math.hypot(sx - g.sx, sy - g.sy) < DRAG_SLOP) return;
        startDrag(g, e);
        return;
      }
      case "drag": {
        if (e.pointerId !== g.id) return;
        const dx = wx - g.wx;
        const dy = wy - g.wy;
        const ops: Op[] = [];
        for (const [id, s] of g.start) ops.push({ op: "patch", id, set: { x: Math.round(s.x + dx), y: Math.round(s.y + dy) } });
        const now = performance.now();
        const send = now - g.lastSend > SEND_MS;
        board.commit(ops, { history: false, send });
        if (send) g.lastSend = now;
        edgeScroll(sx, sy);
        return;
      }
      case "draw": {
        if (e.pointerId !== g.id) return;
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
        for (const ce of events.length ? events : [e]) {
          const [cx, cy] = world(ce);
          const px = cx - g.ox;
          const py = cy - g.oy;
          const n = g.pts.length;
          if (Math.hypot(px - g.pts[n - 2], py - g.pts[n - 1]) < 2.5 / board.cam.z) continue;
          g.pts.push(Math.round(px * 10) / 10, Math.round(py * 10) / 10);
        }
        const now = performance.now();
        const send = now - g.lastSend > 60;
        board.commit([{ op: "patch", id: g.stroke, set: { pts: g.pts.slice() } }], { history: false, send });
        if (send) g.lastSend = now;
        return;
      }
    }
  });

  function startDrag(press: Extract<Gesture, { kind: "press" }>, e: PointerEvent) {
    let ids = [...board.sel];
    // Option-drag leaves the originals and carries copies.
    if (press.alt) ids = board.duplicate(ids, 0, 0, true);
    // A week carries the notes in its columns.
    const carried = new Set(ids);
    for (const id of ids) if (board.state.items.get(id)?.type === "week") for (const n of board.weekNotes(id)) carried.add(n);
    const start = new Map<string, { x: number; y: number }>();
    for (const id of carried) {
      const it = board.state.items.get(id);
      if (it) start.set(id, { x: it.x, y: it.y });
    }
    const raise = board.raise([...carried]);
    const zBefore = raise.map((op) => (op.op === "patch" ? { op: "patch", id: op.id, set: { z: board.state.items.get(op.id)!.z } } : op)) as Op[];
    if (raise.length) board.commit(raise, { history: false });
    for (const id of carried) board.views.get(id)?.el.classList.add("lifted");
    const [wx, wy] = world(e);
    g = { kind: "drag", id: e.pointerId, wx, wy, start, lastSend: 0, raise: zBefore };
    board.root.classList.add("dragging");
  }

  let scrollTimer = 0;
  function edgeScroll(sx: number, sy: number) {
    // Near an edge, the board slides under a dragged note.
    const m = 36;
    const vx = sx < m ? 1 : sx > board.cam.w - m ? -1 : 0;
    const vy = sy < m + 50 ? 1 : sy > board.cam.h - m ? -1 : 0;
    clearTimeout(scrollTimer);
    if (!vx && !vy) return;
    scrollTimer = window.setTimeout(() => {
      if (g.kind !== "drag") return;
      board.cam.pan(vx * 14, vy * 14);
      const fake = new PointerEvent("pointermove", { pointerId: g.id, clientX: sx + stage.getBoundingClientRect().left, clientY: sy + stage.getBoundingClientRect().top, pointerType: "mouse" });
      stage.dispatchEvent(fake);
    }, 30);
  }

  function endGesture(e: PointerEvent, cancelled = false) {
    const [sx, sy] = local(e);
    switch (g.kind) {
      case "pan":
        board.root.classList.remove("panning");
        if (!cancelled && e.pointerType !== "mouse" && Math.hypot(sx - g.lx, sy - g.ly) < 2) maybeDoubleTap(e, null);
        break;
      case "marquee":
        board.marquee.style.display = "none";
        if (Math.hypot(sx - g.x0, sy - g.y0) < 3) maybeDoubleTap(e, null);
        break;
      case "press":
        // A click on an already-selected item, without shift, narrows the selection to it.
        if (!g.shift && g.wasSelected) board.setSelection([g.target]);
        maybeDoubleTap(e, g.target);
        break;
      case "drag": {
        const undo: Op[] = [...g.raise];
        const redo: Op[] = [];
        for (const [id, s] of g.start) {
          const it = board.state.items.get(id);
          board.views.get(id)?.el.classList.remove("lifted");
          if (!it) continue;
          undo.push({ op: "patch", id, set: { x: s.x, y: s.y } });
          redo.push({ op: "patch", id, set: { x: it.x, y: it.y, z: it.z } });
        }
        // Send the final resting place for sure.
        board.link.ops(redo);
        board.remember(undo, redo);
        board.root.classList.remove("dragging");
        break;
      }
      case "draw": {
        const it = board.state.items.get(g.stroke);
        board.link.presence({ pen: false });
        if (it && it.type === "stroke") {
          if (g.pts.length <= 2) {
            // A tap with the pen leaves a dot.
            g.pts.push(0.5, 0.5);
          }
          board.commit([{ op: "patch", id: it.id, set: { pts: g.pts } }], { history: false });
          board.remember([{ op: "del", id: it.id }], [{ op: "put", item: structuredClone(board.state.items.get(it.id)!) as Item }]);
        }
        break;
      }
    }
    g = { kind: "none" };
  }

  function cancelGesture() {
    if (g.kind === "drag" || g.kind === "draw" || g.kind === "marquee" || g.kind === "pan") {
      const fake = { clientX: 0, clientY: 0, pointerType: "touch" } as PointerEvent;
      endGesture(fake, true);
    }
    g = { kind: "none" };
  }

  function maybeDoubleTap(e: PointerEvent, target: string | null) {
    const now = performance.now();
    const [sx, sy] = local(e);
    const again = now - lastTap.t < 320 && Math.hypot(sx - lastTap.x, sy - lastTap.y) < 24 && lastTap.target === (target ?? "");
    lastTap = { t: again ? 0 : now, x: sx, y: sy, target: target ?? "" };
    if (!again) return;
    if (target) board.editor.open(target, { caret: "end" });
    else {
      const [wx, wy] = board.cam.toWorld(sx, sy);
      board.addNote(wx, wy);
    }
  }

  const up = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (g.kind === "pinch") {
      if (pointers.size < 2) g = { kind: "none" };
      return;
    }
    endGesture(e);
  };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", (e) => {
    pointers.delete(e.pointerId);
    cancelGesture();
  });
  stage.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !pointers.size) {
      board.pointer = null;
      board.link.presence({ c: null });
    }
  });
  stage.addEventListener("contextmenu", (e) => e.preventDefault());

  // Trackpads pan with two fingers and zoom with a pinch (sent as ctrl+wheel).
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      stopFollowing();
      const [sx, sy] = local(e);
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? board.cam.h : 1;
      if (e.ctrlKey || e.metaKey) board.cam.zoomAt(sx, sy, Math.exp(-e.deltaY * scale * 0.0085));
      else if (e.shiftKey && !e.deltaX) board.cam.pan(-e.deltaY * scale, 0);
      else board.cam.pan(-e.deltaX * scale, -e.deltaY * scale);
    },
    { passive: false },
  );
  // Safari's own pinch gesture.
  stage.addEventListener("gesturestart", (e) => e.preventDefault());

  // ---------------------------------------------------------------- keys
  const typing = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
  };
  addEventListener("keydown", (e) => {
    if (typing() || board.root.querySelector(".dialog.open")) return;
    // While something is being edited, keys belong to it, not to the shortcuts.
    if (board.editor.id) {
      if (e.key === "Escape") board.editor.commit();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (e.key === " " && !space) {
      space = true;
      board.root.classList.add("space");
      e.preventDefault();
      return;
    }
    if (mod && k === "z") {
      e.preventDefault();
      if (e.shiftKey) board.redo();
      else board.undo();
      return;
    }
    if (mod && k === "y") {
      e.preventDefault();
      board.redo();
      return;
    }
    if (mod && k === "d") {
      e.preventDefault();
      board.duplicate([...board.sel]);
      return;
    }
    if (mod && k === "a") {
      e.preventDefault();
      board.setSelection(board.state.items.keys());
      return;
    }
    if (mod) return;
    switch (e.key) {
      case "Delete":
      case "Backspace":
        e.preventDefault();
        board.deleteSelected();
        return;
      case "Escape":
        if (board.following) board.follow(null);
        else if (board.tool !== "select") board.setTool("select");
        else board.setSelection([]);
        return;
      case "Enter": {
        const [only] = board.sel;
        if (board.sel.size === 1 && only) {
          e.preventDefault();
          board.editor.open(only, { caret: "end" });
        }
        return;
      }
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        if (!board.sel.size) return;
        e.preventDefault();
        const step = e.shiftKey ? 40 : 4;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        board.commit(board.selected().map((it) => ({ op: "patch", id: it.id, set: { x: it.x + dx, y: it.y + dy } }) as Op));
        return;
      }
      case "+":
      case "=":
        board.zoomBy(1.25);
        return;
      case "-":
      case "_":
        board.zoomBy(0.8);
        return;
      case "!":
        board.fitAll();
        return;
      case ")":
        board.cam.glideTo({ x: board.cam.x, y: board.cam.y, z: 1 }, 300);
        return;
    }
    if (e.altKey) return;
    const tools: Record<string, Board["tool"]> = { v: "select", n: "note", p: "pen", t: "text", c: "check", h: "hand" };
    if (tools[k]) board.setTool(tools[k]);
    else if (k === "u") board.tidy();
  });
  addEventListener("keyup", (e) => {
    if (e.key === " ") {
      space = false;
      board.root.classList.remove("space");
    }
  });
  addEventListener("blur", () => {
    space = false;
    board.root.classList.remove("space");
  });

  // Paste plain text: one note per line (up to 30), laid out in a row.
  addEventListener("paste", (e) => {
    if (typing()) return;
    const text = e.clipboardData?.getData("text/plain")?.trim();
    if (!text) return;
    e.preventDefault();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30);
    const [cx, cy] = board.pointer ?? board.cam.toWorld(board.cam.w / 2, board.cam.h / 2);
    let z = board.topZ();
    const ops: Op[] = lines.map((line, i) => ({
      op: "put",
      item: {
        id: board.newItemId(),
        type: "note",
        x: Math.round(cx + (i % 6) * 232 - Math.min(5, lines.length - 1) * 116),
        y: Math.round(cy + Math.floor(i / 6) * 224),
        rot: Math.round((Math.random() * 6 - 3) * 10) / 10,
        z: z++,
        by: board.me.name,
        color: board.me.color,
        text: line.slice(0, 400),
      },
    }));
    board.commit(ops);
    board.setSelection(ops.map((op) => (op.op === "put" ? op.item.id : "")));
  });
}
