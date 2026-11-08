/** `BlobStore.put`: the server stores bytes itself (a text document), on both drivers. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const vercelPut = vi.fn(async () => ({}));
vi.mock("@vercel/blob", () => ({
  put: (...a: unknown[]) => (vercelPut as (...x: unknown[]) => unknown)(...a),
  BlobNotFoundError: class extends Error {},
  del: vi.fn(),
  head: vi.fn(),
  issueSignedToken: vi.fn(),
  parseStoreIdFromDelegationToken: vi.fn(),
  presignUrl: vi.fn(),
}));

import { LocalBlobStore } from "./local";
import { VercelBlobStore } from "./vercel";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tasset-put-"));
});
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe("put", () => {
  it("local: stores the bytes and the content type, and overwrites", async () => {
    const store = new LocalBlobStore(dir, "http://localhost:3000", Buffer.alloc(32, 1));
    await store.put("t/doc.json", new TextEncoder().encode('{"a":1}'), "application/vnd.tasset.text+json");
    expect(await store.head("t/doc.json")).toEqual({ size: 7, contentType: "application/vnd.tasset.text+json" });
    expect(new TextDecoder().decode(await store.readStart("t/doc.json", 100))).toBe('{"a":1}');
    await store.put("t/doc.json", new TextEncoder().encode("{}"), "application/json");
    expect(await store.head("t/doc.json")).toEqual({ size: 2, contentType: "application/json" });
  });

  it("local: refuses a key outside the store", async () => {
    const store = new LocalBlobStore(dir, "http://localhost:3000", Buffer.alloc(32, 1));
    await expect(store.put("../escape", new Uint8Array([1]), "text/plain")).rejects.toThrow(/outside the store/);
  });

  it("vercel: a private, unsuffixed, overwriting put at exactly the key", async () => {
    await new VercelBlobStore().put("t/doc.json", new Uint8Array([1, 2, 3]), "application/json");
    expect(vercelPut).toHaveBeenCalledTimes(1);
    const [key, body, opts] = vercelPut.mock.calls[0] as unknown as [string, Buffer, Record<string, unknown>];
    expect(key).toBe("t/doc.json");
    expect([...body]).toEqual([1, 2, 3]);
    expect(opts).toMatchObject({ access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
  });
});
