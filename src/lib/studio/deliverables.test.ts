import { describe, expect, it } from "vitest";

import { sniffDeliverable } from "./deliverables";

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("deliverables are told apart by their first bytes", () => {
  it("takes each type with its real signature", () => {
    expect(sniffDeliverable("logo.svg", bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toMatchObject({ ok: true, mime: "image/svg+xml" });
    expect(sniffDeliverable("logo.svg", bytes([0xef, 0xbb, 0xbf], '<?xml version="1.0"?>\n<!-- Illustrator -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg>'))).toMatchObject({ ok: true });
    expect(sniffDeliverable("logo.ai", bytes("%PDF-1.6"))).toMatchObject({ ok: true, mime: "application/illustrator" });
    expect(sniffDeliverable("old.ai", bytes("%!PS-Adobe-3.0"))).toMatchObject({ ok: true });
    expect(sniffDeliverable("logo.eps", bytes("%!PS-Adobe-3.0 EPSF-3.0"))).toMatchObject({ ok: true, mime: "application/postscript" });
    expect(sniffDeliverable("logo.eps", bytes([0xc5, 0xd0, 0xd3, 0xc6]))).toMatchObject({ ok: true });
    expect(sniffDeliverable("guide.pdf", bytes("%PDF-1.7"))).toMatchObject({ ok: true, mime: "application/pdf" });
    expect(sniffDeliverable("pack.ZIP", bytes([0x50, 0x4b, 0x03, 0x04]))).toMatchObject({ ok: true, ext: "zip" });
    expect(sniffDeliverable("a.png", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toMatchObject({ ok: true });
    expect(sniffDeliverable("a.jpeg", bytes([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(sniffDeliverable("a.tif", bytes([0x49, 0x49, 0x2a, 0x00]))).toMatchObject({ ok: true });
    expect(sniffDeliverable("Brand.otf", bytes("OTTO"))).toMatchObject({ ok: true, mime: "font/otf" });
    expect(sniffDeliverable("Brand.ttf", bytes([0x00, 0x01, 0x00, 0x00]))).toMatchObject({ ok: true });
    expect(sniffDeliverable("Brand.woff2", bytes("wOF2"))).toMatchObject({ ok: true });
  });

  it("refuses a file that isn't what its extension says", () => {
    expect(sniffDeliverable("logo.svg", bytes("%PDF-1.4"))).toMatchObject({ ok: false, error: expect.stringMatching(/real SVG/) });
    expect(sniffDeliverable("guide.pdf", bytes("<html><script>"))).toMatchObject({ ok: false });
    expect(sniffDeliverable("logo.eps", bytes("%PDF-1.4"))).toMatchObject({ ok: false });
    expect(sniffDeliverable("pack.zip", bytes("MZ"))).toMatchObject({ ok: false });
    expect(sniffDeliverable("page.html", bytes("<svg>"))).toMatchObject({ ok: false, error: expect.stringMatching(/isn't a type we deliver/) });
    expect(sniffDeliverable("noext", bytes("%PDF-"))).toMatchObject({ ok: false });
    expect(sniffDeliverable("evil.svg", bytes("<html><svg>"))).toMatchObject({ ok: false });
  });
});
