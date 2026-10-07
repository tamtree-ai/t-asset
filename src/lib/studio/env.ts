/**
 * t-asset settings (plan §11). No imports, so routes, scripts and tests can all read it.
 */

export type BlobDriver = "vercel" | "local";

export type StudioEnv = {
  /** Public base URL for share links; null builds them from the request. */
  appUrl: string | null;
  /** 32-byte key for AES-256-GCM (share tokens, passcodes) and the local blob store's signatures; null until set. */
  secret: Buffer | null;
  blob: BlobDriver;
  /** Where the local blob driver keeps files. */
  blobLocalDir: string;
  /** Uploads that would take the store past this are refused (plan §5.6). */
  softCapBytes: number;
  /** Keep a video's original after Tamtree has made its proxy. Off by default: the 1 GB free store fills fast. */
  keepVideoOriginals: boolean;
  tamtree: { apiToken: string | null; webhookUrl: string | null; webhookSecret: string | null };
  cronSecret: string | null;
  owner: { email: string | null; passwordHash: string | null; studioName: string };
};

const MB = 1024 * 1024;

function parseSecret(raw: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error("STUDIO_SECRET must be 32 bytes, as 64 hex characters or base64. Make one with: openssl rand -hex 32");
  }
  return key;
}

const opt = (v: string | undefined) => v?.trim() || null;

export function studioEnv(env: NodeJS.ProcessEnv = process.env): StudioEnv {
  const blob = env.BLOB_DRIVER?.trim() || (env.VERCEL ? "vercel" : "local");
  if (blob !== "local" && blob !== "vercel") throw new Error(`BLOB_DRIVER=${blob} is not a store t-asset knows. Use vercel or local.`);
  const appUrl = env.APP_URL?.trim().replace(/\/+$/, "") || null;
  if (appUrl && !/^https?:\/\/[^/]+/.test(appUrl)) throw new Error(`APP_URL=${appUrl} is not a URL. Use e.g. https://review.example.com`);
  const cap = env.BLOB_SOFT_CAP_BYTES?.trim();
  const softCapBytes = cap ? Number(cap) : 900 * MB;
  if (!Number.isFinite(softCapBytes) || softCapBytes <= 0) throw new Error(`BLOB_SOFT_CAP_BYTES=${cap} is not a number of bytes.`);
  return {
    appUrl,
    secret: env.STUDIO_SECRET?.trim() ? parseSecret(env.STUDIO_SECRET) : null,
    blob,
    blobLocalDir: env.BLOB_LOCAL_DIR?.trim() || ".blob-data",
    softCapBytes,
    keepVideoOriginals: env.KEEP_VIDEO_ORIGINALS === "1",
    tamtree: { apiToken: opt(env.TAMTREE_API_TOKEN), webhookUrl: opt(env.TAMTREE_WEBHOOK_URL), webhookSecret: opt(env.TAMTREE_WEBHOOK_SECRET) },
    cronSecret: opt(env.CRON_SECRET),
    owner: { email: opt(env.OWNER_EMAIL)?.toLowerCase() ?? null, passwordHash: opt(env.OWNER_PASSWORD_HASH), studioName: opt(env.STUDIO_NAME) ?? "Studio" },
  };
}

/** The key, or a clear error at the first place that needs it. */
export function studioSecret(env: NodeJS.ProcessEnv = process.env): Buffer {
  const { secret } = studioEnv(env);
  if (!secret) throw new Error("STUDIO_SECRET is not set. Make one with: openssl rand -hex 32, and add it to .env.local.");
  return secret;
}

/**
 * On a deployed production build: everything the app needs to be safe on the internet. A malformed
 * value anywhere fails at once. Called at startup (instrumentation.ts).
 */
export function assertStudioEnv(env: NodeJS.ProcessEnv = process.env): void {
  const parsed = studioEnv(env);
  if (env.NODE_ENV !== "production" || env.VERCEL_ENV !== "production") return;
  const missing: string[] = [];
  if (!parsed.secret) missing.push("STUDIO_SECRET");
  if (!parsed.appUrl?.startsWith("https://")) missing.push("APP_URL (https)");
  if (!parsed.owner.email) missing.push("OWNER_EMAIL");
  if (!parsed.owner.passwordHash) missing.push("OWNER_PASSWORD_HASH");
  if (!parsed.tamtree.apiToken) missing.push("TAMTREE_API_TOKEN");
  if (!parsed.tamtree.webhookUrl) missing.push("TAMTREE_WEBHOOK_URL");
  if (!parsed.tamtree.webhookSecret) missing.push("TAMTREE_WEBHOOK_SECRET");
  if (!parsed.cronSecret) missing.push("CRON_SECRET");
  if (missing.length) throw new Error(`t-asset can't start in production without: ${missing.join(", ")}. See .env.example.`);
  if (parsed.blob === "local") throw new Error("BLOB_DRIVER=local is for development. Production uses Vercel Blob (remove BLOB_DRIVER).");
}
