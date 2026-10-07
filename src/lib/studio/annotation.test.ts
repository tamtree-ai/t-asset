import { describe, expect, it } from "vitest";

import { parseAnnotation, readAnnotation } from "./annotation";

describe("annotation v1", () => {
  it("passes a pin through and drops fields a pin doesn't use", () => {
    expect(parseAnnotation({ v: 1, shape: "pin", x: 0.25, y: 0.5, w: 0.3, h: 0.3 })).toEqual({ v: 1, shape: "pin", x: 0.25, y: 0.5 });
  });

  it("clamps coordinates into 0..1 instead of refusing a pin dragged past the edge", () => {
    expect(parseAnnotation({ v: 1, shape: "pin", x: -0.2, y: 1.7 })).toMatchObject({ x: 0, y: 1 });
  });

  it("shrinks a box that overhangs the frame", () => {
    const a = parseAnnotation({ v: 1, shape: "rect", x: 0.8, y: 0.9, w: 0.5, h: 0.5 });
    expect(a).toMatchObject({ x: 0.8, y: 0.9 });
    expect(a!.w).toBeCloseTo(0.2);
    expect(a!.h).toBeCloseTo(0.1);
  });

  it("needs a size for a box", () => {
    expect(() => parseAnnotation({ v: 1, shape: "rect", x: 0.1, y: 0.1 })).toThrow(/width and a height/);
  });

  it("keeps a video moment and a range, and refuses a range that ends before it starts", () => {
    expect(parseAnnotation({ v: 1, shape: "pin", x: 0.5, y: 0.5, t: 12.5, tEnd: 15, frame: 375 })).toMatchObject({ t: 12.5, tEnd: 15, frame: 375 });
    expect(() => parseAnnotation({ v: 1, shape: "pin", x: 0.5, y: 0.5, t: 12, tEnd: 10 })).toThrow(/cannot end before/);
    expect(() => parseAnnotation({ v: 1, shape: "pin", x: 0.5, y: 0.5, tEnd: 10 })).toThrow(/start time/);
  });

  it("takes a time-only comment, and ignores any position it carries", () => {
    expect(parseAnnotation({ v: 1, shape: "time", x: 0.9, y: 0.9, t: 3 })).toEqual({ v: 1, shape: "time", x: 0, y: 0, t: 3 });
    expect(() => parseAnnotation({ v: 1, shape: "time" })).toThrow(/needs a time/);
  });

  it("refuses other versions, other shapes, NaN and negative or absurd times", () => {
    expect(() => parseAnnotation({ v: 2, shape: "pin", x: 0, y: 0 })).toThrow();
    expect(() => parseAnnotation({ v: 1, shape: "arrow", x: 0, y: 0 })).toThrow();
    expect(() => parseAnnotation({ v: 1, shape: "pin", x: Number.NaN, y: 0 })).toThrow();
    expect(() => parseAnnotation({ v: 1, shape: "pin", x: 0, y: 0, t: -1 })).toThrow();
    expect(() => parseAnnotation({ v: 1, shape: "pin", x: 0, y: 0, t: 1e9 })).toThrow();
  });

  it("treats null and undefined as a general comment", () => {
    expect(parseAnnotation(null)).toBeNull();
    expect(parseAnnotation(undefined)).toBeNull();
  });

  it("readAnnotation skips stored JSON it can't read instead of throwing", () => {
    expect(readAnnotation({ v: 9, shape: "squiggle" })).toBeNull();
    expect(readAnnotation("nonsense")).toBeNull();
    expect(readAnnotation({ v: 1, shape: "pin", x: 0.1, y: 0.2 })).toMatchObject({ x: 0.1 });
  });
});
