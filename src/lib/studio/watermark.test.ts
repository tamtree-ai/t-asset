import { describe, expect, it } from "vitest";

import { proofFooter, proofText, watermarkSvg, watermarkText } from "./watermark";

describe("watermark", () => {
  it("names the studio, or says only PREVIEW", () => {
    expect(watermarkText("Dilhan Studio")).toBe("DILHAN STUDIO · PREVIEW");
    expect(watermarkText("  ")).toBe("PREVIEW");
    expect(watermarkText(null)).toBe("PREVIEW");
    expect(watermarkText("x".repeat(60)).length).toBeLessThan(45);
  });
  it("escapes the name into valid SVG of the asked size", () => {
    const svg = watermarkSvg(800, 600, watermarkText(`A&B <"Co">`));
    expect(svg).toContain('width="800" height="600"');
    expect(svg).toContain("A&amp;B &lt;&quot;CO&quot;&gt; · PREVIEW");
    expect(svg).not.toContain("<\"CO\">");
  });
  it("names the studio and the client on a proof, and says it isn't licensed", () => {
    expect(proofText("Photodynamics", "Acme Co")).toBe("PHOTODYNAMICS · PROOF · ACME CO");
    expect(proofText(null, null)).toBe("PROOF");
    expect(proofText("x".repeat(60), "y".repeat(60)).length).toBeLessThan(70);
    expect(proofFooter("Acme Co", "2026-10-31")).toBe("Proof for Acme Co · 2026-10-31 · not licensed for use until paid");
    expect(proofFooter("", "2026-10-31")).toBe("Proof · 2026-10-31 · not licensed for use until paid");
  });
  it("draws a stronger mark for proofs, visible on white", () => {
    expect(watermarkSvg(800, 600, "P", { strong: true })).toContain('fill="#7a7a7a"');
    expect(watermarkSvg(800, 600, "P")).toContain('fill="#ffffff"');
  });
});

