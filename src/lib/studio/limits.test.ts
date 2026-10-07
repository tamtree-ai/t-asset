import { describe, expect, it } from "vitest";

import { minutesLabel, RULES, retryAfterSeconds, windowStart } from "./limits";

describe("rate limit windows", () => {
  const W = 15 * 60_000;
  it("rounds down to the window's start", () => {
    expect(windowStart(0, W)).toBe(0);
    expect(windowStart(W - 1, W)).toBe(0);
    expect(windowStart(W, W)).toBe(W);
    expect(windowStart(W * 3 + 5, W)).toBe(W * 3);
  });
  it("says how long until the window ends, at least a second", () => {
    expect(retryAfterSeconds(W - 30_000, W)).toBe(30);
    expect(retryAfterSeconds(W * 2 - 1, W)).toBe(1);
    expect(retryAfterSeconds(W * 2, W)).toBe(900);
  });
  it("words minutes for people", () => {
    expect(minutesLabel(10)).toBe("a minute");
    expect(minutesLabel(60)).toBe("a minute");
    expect(minutesLabel(61)).toBe("2 minutes");
    expect(minutesLabel(900)).toBe("15 minutes");
  });
  it("has the plan's numbers", () => {
    expect(RULES.gate).toEqual({ limit: 5, windowMs: 900_000 });
    expect(RULES.comment).toEqual({ limit: 30, windowMs: 60_000 });
  });
});
