/**
 * Byte ranges and download headers, shared by the media proxy and the Studio Review file routes.
 * No imports, so unit tests and route handlers can both use it.
 */

export type ByteRange = { start: number; end: number };

/**
 * `Range: bytes=…` against a file of `size` bytes. `null` means no usable range (serve it whole);
 * `"unsatisfiable"` means answer 416. Handles `A-B`, `A-` and the suffix form `-N`; a multi-range
 * request is served whole, which the spec allows.
 */
export function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  if (size === 0) return "unsatisfiable";
  if (!m[1]) {
    const n = Number(m[2]);
    return n === 0 ? "unsatisfiable" : { start: Math.max(size - n, 0), end: size - 1 };
  }
  const start = Number(m[1]);
  if (start >= size) return "unsatisfiable";
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return end < start ? "unsatisfiable" : { start, end };
}

/**
 * `content-disposition` for a download. Headers are Latin-1, and a title can hold anything
 * (curly quotes, emoji), so the name goes as RFC 5987 UTF-8 with an ASCII fallback.
 */
export function attachment(name: string): string {
  const ascii = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "").trim() || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
