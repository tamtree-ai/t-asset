/**
 * Where t-asset keeps bytes (plan §5.1). Files never pass through the app: browsers and Tamtree
 * upload straight to the store with a signed request, and readers are redirected to a short-lived
 * signed URL. Two drivers: Vercel Blob (`vercel.ts`) and, for development and tests, the local
 * disk served by the app itself (`local.ts`). Keys are `/`-separated and chosen by the caller.
 */

/** One HTTP request that uploads a file: send the bytes as the body, with these headers. */
export type UploadTarget = { method: "PUT"; url: string; headers: Record<string, string>; expiresAt: string };

export type BlobHead = { size: number; contentType: string };

export interface BlobStore {
  readonly driver: "vercel" | "local";
  /** A signed upload for exactly `key`, refusing another content type or a body over `maxBytes`. */
  uploadTarget(key: string, opts: { contentType: string; maxBytes: number; validForS: number }): Promise<UploadTarget>;
  /** A signed URL that reads `key` for `validForS` seconds. `download` asks the browser to save it under the key's last segment. */
  readUrl(key: string, opts: { validForS: number; download?: boolean }): Promise<string>;
  head(key: string): Promise<BlobHead | null>;
  /** Removes the keys; fine if some are already gone. */
  delete(keys: string[]): Promise<void>;
}

/** The last path segment, made safe for a key: letters, digits, dot, dash and underscore. */
export function safeName(name: string, fallback = "file"): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}
