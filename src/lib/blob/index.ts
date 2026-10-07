import path from "node:path";

import { secretKey } from "@/lib/studio/crypto";
import { studioEnv } from "@/lib/studio/env";

import { LocalBlobStore } from "./local";
import type { BlobStore } from "./types";
import { VercelBlobStore } from "./vercel";

export * from "./types";

const g = globalThis as unknown as { __tassetBlob?: BlobStore };

/** The configured store (`BLOB_DRIVER`), made once per process. */
export function getBlobStore(): BlobStore {
  if (!g.__tassetBlob) {
    const env = studioEnv();
    g.__tassetBlob = env.blob === "vercel" ? new VercelBlobStore() : new LocalBlobStore(path.resolve(env.blobLocalDir), env.appUrl ?? "http://localhost:3000", secretKey());
  }
  return g.__tassetBlob;
}

/** The local store, or null when the app runs on Vercel Blob (the dev route answers 404 then). */
export function localBlobStore(): LocalBlobStore | null {
  const store = getBlobStore();
  return store instanceof LocalBlobStore ? store : null;
}

/** Tests swap in their own store. */
export function setBlobStore(store: BlobStore | undefined): void {
  g.__tassetBlob = store;
}
