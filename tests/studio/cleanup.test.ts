/** The daily cleanup (plan §5.7) and its cron route. */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));

let c: Ctx;
let org: Awaited<ReturnType<Ctx["org"]>>;
let cleanup: typeof import("@/services/studio/cleanup").cleanup;

const HOUR = 3600_000;

beforeAll(async () => {
  c = await setup("cleanup");
  org = await c.org("a");
  cleanup = (await import("@/services/studio/cleanup")).cleanup;
});
afterAll(async () => c.cleanup());

describe("cleanup", () => {
  it("removes uploads abandoned for a day, with their blobs, and leaves fresh ones", async () => {
    const old = randomUUID();
    const fresh = randomUUID();
    await c.put(`o/${old}/a.png`, "half", "image/png");
    await c.db.insert(c.schema.studioFiles).values([
      { id: old, orgId: org.orgId, originalKey: `o/${old}/a.png`, originalName: "a.png", mime: "image/png", bytes: 10, processing: "uploading", createdAt: new Date(Date.now() - 25 * HOUR) },
      { id: fresh, orgId: org.orgId, originalKey: `o/${fresh}/b.png`, originalName: "b.png", mime: "image/png", bytes: 10, processing: "uploading" },
    ]);
    const r = await cleanup(new Date(), async () => true);
    expect(r.abandonedUploads).toBeGreaterThanOrEqual(1);
    expect(await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, old))).toHaveLength(0);
    expect(await c.db.select().from(c.schema.studioFiles).where(eq(c.schema.studioFiles.id, fresh))).toHaveLength(1);
    expect(await c.store.head(`o/${old}/a.png`)).toBeNull();
  });

  it("tries failed blob deletes again", async () => {
    const key = `d/${randomUUID()}/orphan.webp`;
    await c.put(key, "x", "image/webp");
    await c.db.insert(c.schema.deletedBlobs).values({ key });
    await cleanup(new Date(), async () => true);
    expect(await c.store.head(key)).toBeNull();
    expect(await c.db.select().from(c.schema.deletedBlobs).where(eq(c.schema.deletedBlobs.key, key))).toHaveLength(0);
  });

  it("re-sends the webhook for files Tamtree hasn't picked up in two hours", async () => {
    const t = await c.tree(org.orgId);
    const waiting = await c.version(org.orgId, t.variationId);
    const recent = await c.version(org.orgId, t.variationId);
    await c.db.update(c.schema.studioFiles).set({ processing: "pending", createdAt: new Date(Date.now() - 3 * HOUR) }).where(eq(c.schema.studioFiles.id, waiting.fileId));
    await c.db.update(c.schema.studioFiles).set({ processing: "pending" }).where(eq(c.schema.studioFiles.id, recent.fileId));
    const told: string[] = [];
    await cleanup(new Date(), async (id) => {
      told.push(id);
      return true;
    });
    expect(told).toContain(waiting.fileId);
    expect(told).not.toContain(recent.fileId);
  });
});

describe("the cron route", () => {
  it("needs CRON_SECRET as a bearer token", async () => {
    const { GET } = await import("@/app/api/cron/cleanup/route");
    expect((await GET(new Request("http://t/api/cron/cleanup"))).status).toBe(401);
    process.env.CRON_SECRET = "cron-secret";
    try {
      expect((await GET(new Request("http://t/api/cron/cleanup", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
      const ok = await GET(new Request("http://t/api/cron/cleanup", { headers: { authorization: "Bearer cron-secret" } }));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toHaveProperty("abandonedUploads");
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});
