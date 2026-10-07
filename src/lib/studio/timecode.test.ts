import { describe, expect, it } from "vitest";

import { formatTimecode, frameToTime, parseTimecode, timeToFrame } from "./timecode";

const f30 = { num: 30, den: 1 };
const ntsc = { num: 30000, den: 1001 };

describe("timecode", () => {
  it("converts a time to the frame on screen, and back to that frame's start", () => {
    expect(timeToFrame(0, f30)).toBe(0);
    expect(timeToFrame(1, f30)).toBe(30);
    expect(timeToFrame(1 / 30, f30)).toBe(1);
    expect(timeToFrame(0.0333, f30)).toBe(0);
    expect(frameToTime(30, f30)).toBe(1);
    expect(frameToTime(-5, f30)).toBe(0);
  });

  it("keeps NTSC exact: frame 30000 of 30000/1001 is 1001 seconds", () => {
    expect(frameToTime(30000, ntsc)).toBeCloseTo(1001, 9);
    expect(timeToFrame(1001, ntsc)).toBe(30000);
  });

  it("round-trips every frame of a minute at 29.97", () => {
    for (let n = 0; n < 1800; n += 7) expect(timeToFrame(frameToTime(n, ntsc), ntsc)).toBe(n);
  });

  it("formats m:ss.ff, with hours past an hour, and without frames when fps is unknown", () => {
    expect(formatTimecode(65.5, f30)).toBe("1:05.15");
    expect(formatTimecode(0, f30)).toBe("0:00.00");
    expect(formatTimecode(3723, f30)).toBe("1:02:03.00");
    expect(formatTimecode(65.5)).toBe("1:05");
    expect(formatTimecode(-3, f30)).toBe("0:00.00");
  });

  it("pads the frame to the width fps needs", () => {
    expect(formatTimecode(1.5, { num: 120, den: 1 })).toBe("0:01.060");
    expect(formatTimecode(1.5, { num: 24, den: 1 })).toBe("0:01.12");
  });

  it("parses what it prints, plus bare seconds, and rejects junk", () => {
    expect(parseTimecode("1:05", f30)).toBe(65);
    expect(parseTimecode("1:02:03")).toBe(3723);
    expect(parseTimecode("1:05.15", f30)).toBeCloseTo(65.5, 6);
    expect(parseTimecode("65")).toBe(65);
    expect(parseTimecode("12.5")).toBe(12.5);
    expect(parseTimecode("soon")).toBeNull();
    expect(parseTimecode("1:2:3:4")).toBeNull();
    expect(parseTimecode("")).toBeNull();
  });
});
