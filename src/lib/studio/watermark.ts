/** The "PREVIEW" watermark: a tiled diagonal SVG, drawn over images by the owner's browser (or sharp) and over video as a PNG overlay. No imports. */

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Tile text: the studio name, a dot, PREVIEW. Capped so a long name can't overflow a tile. */
export function watermarkText(studioName: string | null | undefined): string {
  const name = (studioName ?? "").replace(/\s+/g, " ").trim().slice(0, 28).toUpperCase();
  return name ? `${name} · PREVIEW` : "PREVIEW";
}

/**
 * An SVG of exactly `width`×`height`, tiled with the text at about 12% opacity, light with a dark
 * edge so it reads on any picture. `strong` is for proofs and logos, which are often on white: a
 * mid grey at about a quarter opacity with a light edge, so it shows on white and on black alike.
 */
export function watermarkSvg(width: number, height: number, text: string, opts: { strong?: boolean } = {}): string {
  // Tile and type scale with the short edge, so a thumbnail and a 4K frame look alike.
  const unit = Math.max(Math.min(width, height) / 18, 14);
  const tileW = Math.round(unit * 14);
  const tileH = Math.round(unit * 6);
  const t = xml(text);
  const ink = opts.strong ? { fill: "#7a7a7a", fillOpacity: 0.26, stroke: "#ffffff", strokeOpacity: 0.3 } : { fill: "#ffffff", fillOpacity: 0.14, stroke: "#000000", strokeOpacity: 0.1 };
  const label = (x: number, y: number) =>
    `<text x="${x}" y="${y}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-weight="700" font-size="${unit.toFixed(1)}" text-anchor="middle" fill="${ink.fill}" fill-opacity="${ink.fillOpacity}" stroke="${ink.stroke}" stroke-opacity="${ink.strokeOpacity}" stroke-width="${(unit / 22).toFixed(2)}">${t}</text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><pattern id="wm" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">` +
    `${label(tileW / 2, tileH * 0.4)}${label(0, tileH * 0.9)}${label(tileW, tileH * 0.9)}` +
    `</pattern></defs><rect width="${width}" height="${height}" fill="url(#wm)"/></svg>`
  );
}

const tileName = (s: string | null | undefined, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max).toUpperCase();

/** A brand guide proof's tile: `PHOTODYNAMICS · PROOF · ACME CO`, so a leaked page names the client it was sent to. */
export function proofText(studioName: string | null | undefined, clientName: string | null | undefined): string {
  return [tileName(studioName, 28), "PROOF", tileName(clientName, 28)].filter(Boolean).join(" · ");
}

/** The band along the foot of every proof page. */
export function proofFooter(clientName: string | null | undefined, date: string): string {
  const client = (clientName ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${client ? `Proof for ${client}` : "Proof"} · ${date} · not licensed for use until paid`;
}
