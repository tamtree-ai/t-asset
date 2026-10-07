import { describe, expect, it } from "vitest";

import { watermarkSvg, watermarkText } from "./watermark";

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
});
