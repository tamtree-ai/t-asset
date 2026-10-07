/** The "PREVIEW" watermark: a tiled diagonal SVG, drawn over images by sharp and over video as a PNG overlay. No imports. */

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Tile text: the studio name, a dot, PREVIEW. Capped so a long name can't overflow a tile. */
export function watermarkText(studioName: string | null | undefined): string {
  const name = (studioName ?? "").replace(/\s+/g, " ").trim().slice(0, 28).toUpperCase();
  return name ? `${name} · PREVIEW` : "PREVIEW";
}

/** An SVG of exactly `width`×`height`, tiled with the text at about 12% opacity, light with a dark edge so it reads on any picture. */
export function watermarkSvg(width: number, height: number, text: string): string {
  // Tile and type scale with the short edge, so a thumbnail and a 4K frame look alike.
  const unit = Math.max(Math.min(width, height) / 18, 14);
  const tileW = Math.round(unit * 14);
  const tileH = Math.round(unit * 6);
  const t = xml(text);
  const label = (x: number, y: number) =>
    `<text x="${x}" y="${y}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-weight="700" font-size="${unit.toFixed(1)}" text-anchor="middle" fill="#ffffff" fill-opacity="0.14" stroke="#000000" stroke-opacity="0.10" stroke-width="${(unit / 22).toFixed(2)}">${t}</text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><pattern id="wm" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">` +
    `${label(tileW / 2, tileH * 0.4)}${label(0, tileH * 0.9)}${label(tileW, tileH * 0.9)}` +
    `</pattern></defs><rect width="${width}" height="${height}" fill="url(#wm)"/></svg>`
  );
}
