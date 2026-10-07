/**
 * The annotation on a root comment (plan §4.4). Versioned so shapes can be added later with no
 * migration; every coordinate is normalised 0..1 so it holds at any display size. Clamped, not
 * rejected: a pin dragged a pixel past the edge is still a pin.
 */
import { z } from "zod";

export type Annotation = { v: 1; shape: "pin" | "rect" | "time"; x: number; y: number; w?: number; h?: number; t?: number; tEnd?: number; frame?: number };

const unit = z.number().finite().transform((n) => Math.min(1, Math.max(0, n)));
const seconds = z.number().finite().min(0).max(86400);

export const annotationV1 = z
  .object({
    v: z.literal(1),
    /** `time` is a comment on a moment of a video with no spot on the picture (x and y are ignored). */
    shape: z.enum(["pin", "rect", "time"]),
    x: unit.default(0),
    y: unit.default(0),
    w: unit.optional(),
    h: unit.optional(),
    t: seconds.optional(),
    tEnd: seconds.optional(),
    frame: z.number().int().min(0).max(10_000_000).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.shape === "rect" && (a.w === undefined || a.h === undefined)) ctx.addIssue({ code: "custom", message: "A box needs a width and a height." });
    if (a.shape === "time" && a.t === undefined) ctx.addIssue({ code: "custom", message: "A comment on a moment needs a time." });
    if (a.tEnd !== undefined && a.t === undefined) ctx.addIssue({ code: "custom", message: "A range needs a start time." });
    if (a.tEnd !== undefined && a.t !== undefined && a.tEnd < a.t) ctx.addIssue({ code: "custom", message: "A range cannot end before it starts." });
  })
  .transform((a): Annotation => {
    // A box never leaves the frame: shrink it to fit instead of letting it overhang.
    if (a.shape === "rect") return { ...a, w: Math.min(a.w!, 1 - a.x), h: Math.min(a.h!, 1 - a.y) };
    const { w: _w, h: _h, ...pin } = a;
    void _w;
    void _h;
    return a.shape === "time" ? { ...pin, x: 0, y: 0 } : pin;
  });

/** Parses untrusted input; null for "no annotation" (a general comment); throws a zod error for a malformed one. */
export function parseAnnotation(raw: unknown): Annotation | null {
  if (raw === null || raw === undefined) return null;
  return annotationV1.parse(raw);
}

/** For rendering stored JSON: a bad or future-version shape is skipped rather than crashing the room. */
export function readAnnotation(raw: unknown): Annotation | null {
  const r = annotationV1.safeParse(raw);
  return r.success ? r.data : null;
}
