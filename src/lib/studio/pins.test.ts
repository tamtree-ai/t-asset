import { describe, expect, it } from "vitest";

import { containSize, DRAG_THRESHOLD, fitScale, markerSpan, PIN_HOLD_S, seekTarget, shapeFromDrag, toNormalised, visibleAt, zoomAbout } from "./pins";

describe("pointer to picture", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };
  it("normalises against the picture's box", () => {
    expect(toNormalised(300, 150, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(toNormalised(100, 50, rect)).toEqual({ x: 0, y: 0 });
  });
  it("clamps a point outside the picture onto its edge", () => {
    expect(toNormalised(0, 999, rect)).toEqual({ x: 0, y: 1 });
  });
  it("doesn't divide by zero for a collapsed box", () => {
    expect(toNormalised(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("click or drag", () => {
  it("a click is a pin", () => {
    expect(shapeFromDrag({ x: 0.4, y: 0.4 }, { x: 0.4 + DRAG_THRESHOLD / 2, y: 0.4 })).toEqual({ shape: "pin", x: 0.4, y: 0.4 });
  });
  it("a drag is a box, from the top-left, whichever way it was drawn", () => {
    const down = shapeFromDrag({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.6 });
    const up = shapeFromDrag({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.2 });
    expect(down).toEqual(up);
    expect(down.shape).toBe("rect");
    expect(down).toMatchObject({ x: 0.2, y: 0.2 });
    expect(down.w).toBeCloseTo(0.3);
    expect(down.h).toBeCloseTo(0.4);
  });
  it("a long thin drag is still a box", () => {
    expect(shapeFromDrag({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }).shape).toBe("rect");
  });
});

describe("video time", () => {
  it("shows an image comment always", () => {
    expect(visibleAt({}, 999)).toBe(true);
  });
  it("holds a moment on screen briefly, then lets it go", () => {
    expect(visibleAt({ t: 10 }, 9.9)).toBe(false);
    expect(visibleAt({ t: 10 }, 10)).toBe(true);
    expect(visibleAt({ t: 10 }, 10 + PIN_HOLD_S)).toBe(true);
    expect(visibleAt({ t: 10 }, 10 + PIN_HOLD_S + 0.5)).toBe(false);
  });
  it("shows a range for its whole length", () => {
    expect(visibleAt({ t: 10, tEnd: 20 }, 19.9)).toBe(true);
    expect(visibleAt({ t: 10, tEnd: 20 }, 20.5)).toBe(false);
  });
  it("seeks to the start, or nowhere for an image", () => {
    expect(seekTarget({ t: 12.5 })).toBe(12.5);
    expect(seekTarget({})).toBeNull();
  });
  it("places timeline marks as fractions, ranges with a width", () => {
    expect(markerSpan({ t: 5 }, 20)).toEqual({ left: 0.25, width: 0 });
    expect(markerSpan({ t: 5, tEnd: 10 }, 20)).toEqual({ left: 0.25, width: 0.25 });
    expect(markerSpan({ t: 30 }, 20)).toEqual({ left: 1, width: 0 });
    expect(markerSpan({}, 20)).toBeNull();
    expect(markerSpan({ t: 5 }, 0)).toBeNull();
  });
});

describe("fitting", () => {
  it("never enlarges past the picture's own pixels", () => {
    expect(fitScale({ w: 400, h: 300 }, { w: 1000, h: 1000 })).toBe(1);
    expect(fitScale({ w: 2000, h: 1000 }, { w: 1000, h: 1000 })).toBe(0.5);
    expect(fitScale({ w: 0, h: 0 }, { w: 1, h: 1 })).toBe(1);
  });
  it("finds the biggest box with the picture's proportions", () => {
    expect(containSize(2, { w: 1000, h: 1000 })).toEqual({ w: 1000, h: 500 });
    expect(containSize(0.5, { w: 1000, h: 1000 })).toEqual({ w: 500, h: 1000 });
    expect(containSize(1, { w: 0, h: 10 })).toEqual({ w: 0, h: 0 });
    expect(containSize(0, { w: 10, h: 10 })).toEqual({ w: 0, h: 0 });
  });
});

describe("zoom", () => {
  it("keeps the point under the cursor still", () => {
    const at = { x: 100, y: -40 };
    const before = { scale: 2, x: 30, y: 10 };
    const after = zoomAbout(before, 1.5, at, { min: 1, max: 8 });
    // The picture-space point under the cursor: (at - pan) / scale, before and after.
    expect((at.x - before.x) / before.scale).toBeCloseTo((at.x - after.x) / after.scale);
    expect((at.y - before.y) / before.scale).toBeCloseTo((at.y - after.y) / after.scale);
  });
  it("stays within its limits", () => {
    expect(zoomAbout({ scale: 7, x: 0, y: 0 }, 5, { x: 0, y: 0 }).scale).toBe(8);
    expect(zoomAbout({ scale: 1.2, x: 0, y: 0 }, 0.1, { x: 0, y: 0 }).scale).toBe(1);
  });
});
