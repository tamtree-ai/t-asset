import { describe, expect, it } from "vitest";

import { counts, describePlace, filterThreads, linkify } from "./comment-filter";

const t = (resolved: boolean) => ({ resolved });

describe("rail filters", () => {
  const list = [t(false), t(true), t(false)];
  it("filters and counts", () => {
    expect(filterThreads(list, "all")).toHaveLength(3);
    expect(filterThreads(list, "open")).toHaveLength(2);
    expect(filterThreads(list, "resolved")).toHaveLength(1);
    expect(counts(list)).toEqual({ all: 3, open: 2, resolved: 1 });
    expect(counts([])).toEqual({ all: 0, open: 0, resolved: 0 });
  });
});

describe("where a comment lands", () => {
  const fps = { num: 30, den: 1 };
  it("says what the composer will attach", () => {
    expect(describePlace(null)).toBe("General comment");
    expect(describePlace({ v: 1, shape: "pin", x: 0.1, y: 0.1 })).toBe("Pin");
    expect(describePlace({ v: 1, shape: "rect", x: 0, y: 0, w: 0.1, h: 0.1 })).toBe("Box");
    expect(describePlace({ v: 1, shape: "pin", x: 0, y: 0, t: 12 }, fps)).toBe("Pin at 0:12.00");
    expect(describePlace({ v: 1, shape: "time", x: 0, y: 0, t: 12 }, fps)).toBe("At 0:12.00");
    expect(describePlace({ v: 1, shape: "rect", x: 0, y: 0, w: 0.1, h: 0.1, t: 12, tEnd: 15 }, fps)).toBe("Box at 0:12.00 – 0:15.00");
  });
});

describe("linkify", () => {
  it("links plain urls and leaves the rest as text", () => {
    expect(linkify("see https://example.com/a?b=1 now")).toEqual([{ text: "see " }, { href: "https://example.com/a?b=1", text: "https://example.com/a?b=1" }, { text: " now" }]);
  });
  it("doesn't swallow trailing punctuation", () => {
    const parts = linkify("Look: https://example.com/x.");
    expect(parts[1]).toEqual({ href: "https://example.com/x", text: "https://example.com/x" });
    expect(parts[2]).toEqual({ text: "." });
  });
  it("never turns html or javascript: into a link", () => {
    expect(linkify("<a href=\"javascript:alert(1)\">x</a>")).toEqual([{ text: "<a href=\"javascript:alert(1)\">x</a>" }]);
    expect(linkify("javascript:alert(1)")).toEqual([{ text: "javascript:alert(1)" }]);
  });
  it("returns plain text as one piece, and nothing for empty", () => {
    expect(linkify("hello")).toEqual([{ text: "hello" }]);
    expect(linkify("")).toEqual([]);
  });
});
