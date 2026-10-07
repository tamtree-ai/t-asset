/**
 * Geometry for pins and boxes on the work (plan §4.3). Everything is normalised 0..1 of the
 * displayed picture, so it holds at any size and zoom. Pure, so it can be tested without a browser.
 */
import type { Annotation } from "./annotation";

export type Point = { x: number; y: number };
export type Box = { left: number; top: number; width: number; height: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A pointer position as a fraction of a rectangle (the picture's bounding box, which already includes zoom and pan). */
export function toNormalised(clientX: number, clientY: number, rect: Box): Point {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return { x: clamp01((clientX - rect.left) / rect.width), y: clamp01((clientY - rect.top) / rect.height) };
}

/** Less than this (as a fraction of the picture) in both directions is a click, not a drag: it drops a pin. */
export const DRAG_THRESHOLD = 0.012;

/** A press at `a` and a release at `b`: a pin for a click, a box (top-left origin, positive size) for a drag. */
export function shapeFromDrag(a: Point, b: Point): Pick<Annotation, "shape" | "x" | "y" | "w" | "h"> {
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (w < DRAG_THRESHOLD && h < DRAG_THRESHOLD) return { shape: "pin", x: clamp01(a.x), y: clamp01(a.y) };
  return { shape: "rect", x: clamp01(Math.min(a.x, b.x)), y: clamp01(Math.min(a.y, b.y)), w, h };
}

/** How long a point-in-time comment stays on screen after its timecode, so a pin isn't a one-frame flash. */
export const PIN_HOLD_S = 1.5;

/** Is this annotation shown at video time `t`? Image comments (no `t`) are always shown. A range shows for its whole length. */
export function visibleAt(a: Pick<Annotation, "t" | "tEnd">, t: number): boolean {
  if (a.t === undefined) return true;
  const end = a.tEnd ?? a.t + PIN_HOLD_S;
  return t >= a.t - 0.001 && t <= end + 0.001;
}

/** The time to jump to for a comment: its start, backed off a hair so the first frame has been decoded. */
export function seekTarget(a: Pick<Annotation, "t">): number | null {
  return a.t === undefined ? null : Math.max(0, a.t);
}

/** Where on a 0..1 timeline a comment's marker sits, and how wide it is (a range is a bar, a moment is a dot). */
export function markerSpan(a: Pick<Annotation, "t" | "tEnd">, duration: number): { left: number; width: number } | null {
  if (a.t === undefined || !(duration > 0)) return null;
  const left = clamp01(a.t / duration);
  const width = a.tEnd !== undefined ? clamp01((a.tEnd - a.t) / duration) : 0;
  return { left, width };
}

/** The zoom that fits `content` inside `frame`, never above 1 (we don't enlarge pictures past their pixels). */
export function fitScale(content: { w: number; h: number }, frame: { w: number; h: number }): number {
  if (content.w <= 0 || content.h <= 0 || frame.w <= 0 || frame.h <= 0) return 1;
  return Math.min(1, frame.w / content.w, frame.h / content.h);
}

/** The largest rectangle with `aspect` (w/h) that fits in `frame`. Used to size the picture and the pin layer to match. */
export function containSize(aspect: number, frame: { w: number; h: number }): { w: number; h: number } {
  if (!(aspect > 0) || frame.w <= 0 || frame.h <= 0) return { w: 0, h: 0 };
  const byWidth = { w: frame.w, h: frame.w / aspect };
  return byWidth.h <= frame.h ? byWidth : { w: frame.h * aspect, h: frame.h };
}

/** Zoom about a screen point so the spot under the cursor stays put. `pan` is the translate in px. */
export function zoomAbout(state: { scale: number; x: number; y: number }, factor: number, at: Point, limits = { min: 1, max: 8 }): { scale: number; x: number; y: number } {
  const scale = Math.min(limits.max, Math.max(limits.min, state.scale * factor));
  const k = scale / state.scale;
  // `at` is relative to the stage centre; the point under it moves by (1-k) of its offset from the pan origin.
  return { scale, x: at.x - (at.x - state.x) * k, y: at.y - (at.y - state.y) * k };
}
