/** Sign-offs: approve and request changes, append-only records, status, rounds, who may decide what. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type Ctx, setup } from "./helpers";

vi.mock("server-only", () => ({}));

let c: Ctx;
let org: Awaited<ReturnType<Ctx["org"]>>;
let decisions: typeof import("@/services/studio/decisions");
let projects: typeof import("@/services/studio/projects");
const meta = { ip: "203.0.113.9", ua: "Mozilla/5.0 test" };

async function fixture(over: Record<string, unknown> = {}) {
  const t = await c.tree(org.orgId);
  const v1 = await c.version(org.orgId, t.variationId, { note: "first" });
  const { share } = await c.share(org.orgId, org.memberId, t.projectId, [t.assetId], over);
  const [reviewer] = await c.db.insert(c.schema.studioReviewers).values({ shareId: share.id, name: "Sam Lee", email: `sam-${Math.random().toString(36).slice(2)}@acme.com` }).returning();
  return { t, v1, share, reviewer: reviewer! };
}
const status = async (versionId: string) => (await c.db.select().from(c.schema.studioVersions).where(eq(c.schema.studioVersions.id, versionId)))[0]!.status;

beforeAll(async () => {
  c = await setup("decisions");
  org = await c.org("a");
  decisions = await import("@/services/studio/decisions");
  projects = await import("@/services/studio/projects");
});
afterAll(async () => c.cleanup());

describe("approving", () => {
  it("records name, email, time, address, agent and the file's fingerprint, and flips the status", async () => {
    const f = await fixture();
    const { decision, status: s } = await decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "approved", signedName: "Samantha Lee", confirm: true }, meta);
    expect(s).toBe("approved");
    expect(await status(f.v1.versionId)).toBe("approved");
    expect(decision).toMatchObject({ decision: "approved", signedName: "Samantha Lee", email: f.reviewer.email, ip: "203.0.113.9", ua: "Mozilla/5.0 test", fileSha256: f.v1.sha256 });
    expect(decision.createdAt).toBeInstanceOf(Date);
  });

  it("needs a typed name and the box ticked", async () => {
    const f = await fixture();
    await expect(decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "approved", signedName: "", confirm: true }, meta)).rejects.toThrow(/full name/);
    await expect(decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "approved", signedName: "S", confirm: true }, meta)).rejects.toThrow(/full name/);
    await expect(decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "approved", signedName: "Sam Lee", confirm: false }, meta)).rejects.toThrow(/Tick the box/);
    expect(await status(f.v1.versionId)).toBe("in_review");
  });

  it("logs the decision in the activity feed", async () => {
    const f = await fixture();
    await decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "approved", signedName: "Sam Lee", confirm: true }, meta);
    const events = await c.db.select().from(c.schema.studioEvents).where(eq(c.schema.studioEvents.shareId, f.share.id));
    const e = events.find((x) => x.type.startsWith("decision."));
    expect(e).toMatchObject({ type: "decision.approved", actorLabel: "Sam Lee" });
    expect(e!.payload).toMatchObject({ versionId: f.v1.versionId });
  });
});

describe("requesting changes", () => {
  it("needs no typed name (it uses the reviewer's), keeps the note, and uses up a round", async () => {
    const f = await fixture();
    const p = (await projects.getProject(org.orgId, f.t.projectId))!;
    expect((await projects.projectRounds(org.orgId, p)).label).toBe("Round 1 of 2");
    const { decision } = await decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "changes_requested", note: "  Fix the logo " }, meta);
    expect(decision).toMatchObject({ signedName: "Sam Lee", note: "Fix the logo", decision: "changes_requested" });
    expect(await status(f.v1.versionId)).toBe("changes_requested");
    expect((await projects.projectRounds(org.orgId, p)).label).toBe("Round 2 of 2");
  });

  it("counts a round per version, not per click, and goes over the contract without blocking", async () => {
    const f = await fixture();
    const p = (await projects.getProject(org.orgId, f.t.projectId))!;
    await decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "changes_requested" }, meta);
    await decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "changes_requested" }, meta);
    expect((await projects.projectRounds(org.orgId, p)).used).toBe(1);
    const v2 = await c.version(org.orgId, f.t.variationId);
    await decisions.decide(f.share, f.reviewer, { versionId: v2.versionId, decision: "changes_requested" }, meta);
    const v3 = await c.version(org.orgId, f.t.variationId);
    await decisions.decide(f.share, f.reviewer, { versionId: v3.versionId, decision: "changes_requested" }, meta);
    expect(await projects.projectRounds(org.orgId, p)).toMatchObject({ used: 3, label: "Round 4 of 2", over: true, note: "Extra rounds may be billed." });
  });

  it("a client can change their mind: the latest decision sets the status", async () => {
    const f = await fixture();
    await decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "changes_requested" }, meta);
    await decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "approved", signedName: "Sam Lee", confirm: true }, meta);
    expect(await status(f.v1.versionId)).toBe("approved");
    expect(await decisions.listDecisions(f.v1.versionId)).toHaveLength(2);
  });
});

describe("what can be decided", () => {
  it("only the latest version of an option", async () => {
    const f = await fixture();
    const v2 = await c.version(org.orgId, f.t.variationId);
    await expect(decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "changes_requested" }, meta)).rejects.toThrow(/newer version/);
    await expect(decisions.decide(f.share, f.reviewer, { versionId: v2.versionId, decision: "changes_requested" }, meta)).resolves.toBeTruthy();
  });

  it("not a version outside the share, and not in a pinned share beyond what was pinned", async () => {
    const f = await fixture({ versionMode: "pinned" });
    const v2 = await c.version(org.orgId, f.t.variationId);
    await expect(decisions.decide(f.share, f.reviewer, { versionId: v2.versionId, decision: "approved", signedName: "Sam Lee", confirm: true }, meta)).rejects.toThrow(/not found/);
    const other = await c.tree(org.orgId);
    const ov = await c.version(org.orgId, other.variationId);
    await expect(decisions.decide(f.share, f.reviewer, { versionId: ov.versionId, decision: "changes_requested" }, meta)).rejects.toThrow(/not found/);
    await expect(decisions.decide(f.share, f.reviewer, { versionId: "nope", decision: "changes_requested" }, meta)).rejects.toThrow(/not found/);
    // The pinned one still works.
    await expect(decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "changes_requested" }, meta)).resolves.toBeTruthy();
  });

  it("not a file that is still processing", async () => {
    const f = await fixture();
    await c.db.update(c.schema.studioFiles).set({ processing: "pending" }).where(eq(c.schema.studioFiles.id, f.v1.fileId));
    await expect(decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "changes_requested" }, meta)).rejects.toThrow(/still being prepared/);
  });

  it("not after the link has been rate-limited, ten a minute", async () => {
    const f = await fixture();
    let blocked = 0;
    for (let i = 0; i < 12; i++) {
      try {
        await decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "changes_requested" }, meta);
      } catch (e) {
        if (/too quickly/.test((e as Error).message)) blocked++;
      }
    }
    expect(blocked).toBeGreaterThanOrEqual(1);
  });
});

describe("deleting what a sign-off hangs under", () => {
  it("keeps the sign-off when its reviewer's share goes: the reviewer link clears, nothing else changes", async () => {
    const f = await fixture();
    const { decision } = await decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "approved", signedName: "Samantha Lee", confirm: true }, meta);
    // Deleting the share deletes its reviewers; the foreign key then clears reviewer_id on the decision.
    await c.db.delete(c.schema.studioShares).where(eq(c.schema.studioShares.id, f.share.id));
    const [kept] = await c.db.select().from(c.schema.studioDecisions).where(eq(c.schema.studioDecisions.id, decision.id));
    expect(kept).toMatchObject({ reviewerId: null, signedName: "Samantha Lee", email: f.reviewer.email, ip: "203.0.113.9", fileSha256: f.v1.sha256, decision: "approved" });
  });

  it("deleting the whole client works with sign-offs under it", async () => {
    const f = await fixture();
    await decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "approved", signedName: "Samantha Lee", confirm: true }, meta);
    const clients = await import("@/services/studio/clients");
    await expect(clients.deleteClient(org.orgId, f.t.clientId)).resolves.toBeUndefined();
    expect(await c.db.select().from(c.schema.studioDecisions).where(eq(c.schema.studioDecisions.versionId, f.v1.versionId))).toHaveLength(0);
  });
});

describe("the record cannot be edited", () => {
  it("refuses an UPDATE of a decision, whatever the column", async () => {
    const f = await fixture();
    const { decision } = await decisions.decide(f.share, f.reviewer, { versionId: f.v1.versionId, decision: "approved", signedName: "Sam Lee", confirm: true }, meta);
    await expect(c.db.update(c.schema.studioDecisions).set({ signedName: "Someone Else" }).where(eq(c.schema.studioDecisions.id, decision.id))).rejects.toThrow();
    await expect(c.db.update(c.schema.studioDecisions).set({ decision: "changes_requested" }).where(eq(c.schema.studioDecisions.id, decision.id))).rejects.toThrow();
    await expect(c.db.update(c.schema.studioDecisions).set({ fileSha256: "0".repeat(64) }).where(eq(c.schema.studioDecisions.id, decision.id))).rejects.toThrow();
    // Even clearing the reviewer together with another column is refused: only the bare unlink is allowed.
    await expect(c.db.update(c.schema.studioDecisions).set({ reviewerId: null, signedName: "Nobody" }).where(eq(c.schema.studioDecisions.id, decision.id))).rejects.toThrow();
    const [again] = await c.db.select().from(c.schema.studioDecisions).where(eq(c.schema.studioDecisions.id, decision.id));
    expect(again).toMatchObject({ signedName: "Sam Lee", decision: "approved" });
  });
});
