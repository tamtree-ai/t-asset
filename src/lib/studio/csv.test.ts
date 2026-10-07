import { describe, expect, it } from "vitest";

import { safeCell, toCsv } from "./csv";

describe("csv", () => {
  it("quotes commas, quotes and newlines, and doubles inner quotes", () => {
    expect(safeCell("a,b")).toBe('"a,b"');
    expect(safeCell('say "hi"')).toBe('"say ""hi"""');
    expect(safeCell("two\nlines")).toBe('"two\nlines"');
    expect(safeCell("plain")).toBe("plain");
  });

  it("writes numbers, and nothing for null and undefined", () => {
    expect(safeCell(3)).toBe("3");
    expect(safeCell(null)).toBe("");
    expect(safeCell(undefined)).toBe("");
  });

  it("stops a comment from running as a spreadsheet formula", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) expect(safeCell(evil).startsWith("'") || safeCell(evil).startsWith('"\'')).toBe(true);
    expect(safeCell("a-b")).toBe("a-b");
  });

  it("starts with a BOM, ends each row with CRLF", () => {
    const out = toCsv(["A", "B"], [[1, "x,y"]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toBe("﻿A,B\r\n1,\"x,y\"\r\n");
  });
});
