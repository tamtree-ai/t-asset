import { describe, expect, it } from "vitest";

import { brandCss, brandVars, contrast, inkOn, luminance, normaliseHex, readableAccent } from "./color";

describe("brand colour", () => {
  it("accepts 3 and 6 digit hex, with or without #, any case", () => {
    expect(normaliseHex("#1F6FEB")).toBe("#1f6feb");
    expect(normaliseHex("1f6feb")).toBe("#1f6feb");
    expect(normaliseHex("f80")).toBe("#ff8800");
    expect(normaliseHex("#12345")).toBeNull();
    expect(normaliseHex("blue")).toBeNull();
    expect(normaliseHex("")).toBeNull();
  });

  it("measures contrast the WCAG way", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(contrast("#ffffff", "#777777"));
  });

  it("picks readable ink for the accent", () => {
    expect(inkOn("#ffe14d")).toBe("#111114");
    expect(inkOn("#0b3d91")).toBe("#ffffff");
    for (const accent of ["#ffe14d", "#ff6a3d", "#1f6feb", "#222222", "#fafafa"]) expect(contrast(accent, inkOn(accent))).toBeGreaterThanOrEqual(4.5);
  });

  it("darkens a light accent until text in it is AA on the surface", () => {
    for (const accent of ["#ffe14d", "#9be564", "#ffb6c1"]) {
      const text = readableAccent(accent, "#ffffff");
      expect(contrast(text, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
    expect(readableAccent("#0b3d91", "#ffffff")).toBe("#0b3d91");
  });

  it("brightens it on a dark surface", () => {
    expect(contrast(readableAccent("#0b3d91", "#17171b"), "#17171b")).toBeGreaterThanOrEqual(4.5);
  });

  it("falls back to the default accent for junk, and always sets every variable", () => {
    const v = brandVars("nonsense", "light");
    expect(v["--brand-accent"]).toBe("#1f6feb");
    for (const k of ["--room-bg", "--room-surface", "--room-fg", "--brand-accent-hover", "--brand-accent-ink", "--brand-accent-text", "--brand-accent-soft"]) expect(v[k]).toBeTruthy();
  });

  it("writes light, dark, or both behind prefers-color-scheme for auto", () => {
    expect(brandCss("#ff6a3d", "light")).toContain("color-scheme:light");
    expect(brandCss("#ff6a3d", "light")).not.toContain("prefers-color-scheme");
    expect(brandCss("#ff6a3d", "dark")).toContain("color-scheme:dark");
    const auto = brandCss("#ff6a3d", "auto");
    expect(auto).toContain("@media (prefers-color-scheme:dark)");
    expect(auto.indexOf("color-scheme:light")).toBeLessThan(auto.indexOf("color-scheme:dark"));
  });
});
