/** Brand colour maths (plan §5.4): one accent from the owner, everything derived from it so text stays AA-readable. */

export const HEX = /^#[0-9a-f]{6}$/i;

export function normaliseHex(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.replace(/./g, "$&$&");
  if (/^[0-9a-f]{6}$/.test(s)) s = `#${s}`;
  return HEX.test(s) ? s : null;
}

export type Rgb = [number, number, number];

export function toRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Black or white, whichever reads better on `bg`. */
export function inkOn(bg: string): string {
  return contrast(bg, "#ffffff") >= contrast(bg, "#111114") ? "#ffffff" : "#111114";
}

function mix(a: string, b: string, amount: number): string {
  const [ra, rb] = [toRgb(a), toRgb(b)];
  return toHex([0, 1, 2].map((i) => ra[i]! + (rb[i]! - ra[i]!) * amount) as Rgb);
}

/** The accent moved toward black or white, in small steps, until it reaches `min` contrast on `surface`. Used for accent-coloured text and links. */
export function readableAccent(accent: string, surface: string, min = 4.5): string {
  const target = luminance(surface) > 0.5 ? "#000000" : "#ffffff";
  let out = accent;
  for (let i = 1; i <= 20 && contrast(out, surface) < min; i++) out = mix(accent, target, i * 0.05);
  return out;
}

export type RoomPalette = {
  bg: string;
  surface: string;
  raised: string;
  line: string;
  fg: string;
  fg2: string;
  fgMuted: string;
  /** Behind the work: a step away from the panel, so the picture is the brightest thing on screen. */
  stage: string;
};

export const LIGHT: RoomPalette = { bg: "#f7f7f8", surface: "#ffffff", raised: "#f4f4f5", line: "#e6e6e9", fg: "#0b0b0d", fg2: "#3f3f46", fgMuted: "#6b6b74", stage: "#ececef" };
export const DARK: RoomPalette = { bg: "#0a0a0b", surface: "#111113", raised: "#19191c", line: "#26262b", fg: "#fafafa", fg2: "#d4d4d8", fgMuted: "#a1a1aa", stage: "#060607" };

/** The CSS variables for the review room, for one mode. */
export function brandVars(accentHex: string, mode: "light" | "dark"): Record<string, string> {
  const accent = normaliseHex(accentHex) ?? "#1f6feb";
  const p = mode === "dark" ? DARK : LIGHT;
  const hover = mix(accent, mode === "dark" ? "#ffffff" : "#000000", 0.12);
  return {
    "--room-bg": p.bg,
    "--room-surface": p.surface,
    "--room-raised": p.raised,
    "--room-line": p.line,
    "--room-fg": p.fg,
    "--room-fg-2": p.fg2,
    "--room-fg-muted": p.fgMuted,
    "--room-stage": p.stage,
    "--brand-accent": accent,
    "--brand-accent-hover": hover,
    "--brand-accent-ink": inkOn(accent),
    "--brand-accent-text": readableAccent(accent, p.surface),
    "--brand-accent-soft": `${accent}1f`,
  };
}

/** `:root` rules for the room: light, dark, or both behind `prefers-color-scheme` for "auto". */
export function brandCss(accentHex: string, theme: "light" | "dark" | "auto"): string {
  const block = (v: Record<string, string>) => Object.entries(v).map(([k, val]) => `${k}:${val}`).join(";");
  if (theme === "light") return `.room{${block(brandVars(accentHex, "light"))};color-scheme:light}`;
  if (theme === "dark") return `.room{${block(brandVars(accentHex, "dark"))};color-scheme:dark}`;
  return `.room{${block(brandVars(accentHex, "light"))};color-scheme:light}@media (prefers-color-scheme:dark){.room{${block(brandVars(accentHex, "dark"))};color-scheme:dark}}`;
}
