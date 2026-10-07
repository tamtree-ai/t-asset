/**
 * Vercel Blob, private store (plan §4). The server never moves bytes: it issues short-lived signed
 * tokens and turns them into presigned URLs. Uploads from the owner's browser go through the SDK's
 * `uploadPresigned` (multipart for big videos) against `/api/uploads/sign`; Tamtree gets a plain
 * PUT request from `uploadTarget`.
 */
import { BlobNotFoundError, del, head, type IssuedSignedToken, issueSignedToken, parseStoreIdFromDelegationToken, presignUrl } from "@vercel/blob";

import type { BlobHead, BlobStore, UploadTarget } from "./types";

/** The Blob API version the SDK speaks; a raw presigned PUT must send it too. */
const BLOB_API_VERSION = "12";

/** A store-wide read token, reused until 10 minutes before it lapses, so a room full of thumbnails is one control-plane call. */
let readToken: IssuedSignedToken | null = null;

async function getReadToken(): Promise<IssuedSignedToken> {
  if (readToken && readToken.validUntil - Date.now() > 10 * 60_000) return readToken;
  readToken = await issueSignedToken({ pathname: "*", operations: ["get"], validUntil: Date.now() + 60 * 60_000 });
  return readToken;
}

export class VercelBlobStore implements BlobStore {
  readonly driver = "vercel" as const;

  async uploadTarget(key: string, opts: { contentType: string; maxBytes: number; validForS: number }): Promise<UploadTarget> {
    const validUntil = Date.now() + opts.validForS * 1000;
    const token = await issueSignedToken({ pathname: key, operations: ["put"], allowedContentTypes: [opts.contentType], maximumSizeInBytes: opts.maxBytes, validUntil });
    const { presignedUrl } = await presignUrl(token, {
      operation: "put",
      pathname: key,
      access: "private",
      allowedContentTypes: [opts.contentType],
      maximumSizeInBytes: opts.maxBytes,
      addRandomSuffix: false,
      allowOverwrite: true,
      validUntil,
    });
    return {
      method: "PUT",
      url: presignedUrl,
      headers: {
        "content-type": opts.contentType,
        "x-content-type": opts.contentType,
        "x-vercel-blob-access": "private",
        "x-api-version": BLOB_API_VERSION,
        "x-vercel-blob-store-id": parseStoreIdFromDelegationToken(token.delegationToken),
      },
      expiresAt: new Date(validUntil).toISOString(),
    };
  }

  async readUrl(key: string, opts: { validForS: number; download?: boolean }): Promise<string> {
    const { presignedUrl } = await presignUrl(await getReadToken(), { operation: "get", pathname: key, access: "private", validUntil: Date.now() + opts.validForS * 1000 });
    if (!opts.download) return presignedUrl;
    const u = new URL(presignedUrl);
    u.searchParams.set("download", "1");
    return u.toString();
  }

  async head(key: string): Promise<BlobHead | null> {
    try {
      const h = await head(key);
      return { size: h.size, contentType: h.contentType };
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null;
      throw e;
    }
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length) await del(keys);
  }
}
