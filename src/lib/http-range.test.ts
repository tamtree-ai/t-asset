import { describe, expect, it } from "vitest";

import { attachment, parseRange } from "./http-range";

describe("parseRange", () => {
  it("serves whole when there is no range or it is not a bytes range", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("items=0-5", 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
  });
  it("reads closed, open and suffix ranges", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });
  it("clamps the end to the file", () => {
    expect(parseRange("bytes=50-999", 100)).toEqual({ start: 50, end: 99 });
  });
  it("is unsatisfiable past the end, backwards, or for an empty file", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=9-3", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1", 0)).toBe("unsatisfiable");
  });
});

describe("attachment", () => {
  it("falls back to ASCII and carries the UTF-8 name", () => {
    expect(attachment("Café “poster”.png")).toBe(`attachment; filename="Cafe poster.png"; filename*=UTF-8''Caf%C3%A9%20%E2%80%9Cposter%E2%80%9D.png`);
  });
});
