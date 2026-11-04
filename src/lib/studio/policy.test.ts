import { describe, expect, it } from "vitest";

import { canDownloadOriginal, type DownloadPolicy, lockNote, watermarked } from "./policy";
import type { VersionStatus } from "./rounds";

const POLICIES: DownloadPolicy[] = ["none", "after_approval", "always", "after_payment"];
const STATUSES: VersionStatus[] = ["in_review", "changes_requested", "approved"];

describe("the download policy table", () => {
  // policy × status × paid → may the original and the deliverables leave?
  const want = (policy: DownloadPolicy, status: VersionStatus, paid: boolean) =>
    policy === "always" || (policy === "after_approval" && status === "approved") || (policy === "after_payment" && status === "approved" && paid);

  for (const policy of POLICIES)
    for (const status of STATUSES)
      for (const paid of [false, true])
        it(`${policy} · ${status} · ${paid ? "paid" : "unpaid"}`, () => {
          expect(canDownloadOriginal({ downloadPolicy: policy }, status, paid)).toBe(want(policy, status, paid));
        });

  it("treats a void invoice as unpaid: only `paid` unlocks", () => {
    expect(canDownloadOriginal({ downloadPolicy: "after_payment" }, "approved")).toBe(false);
  });
});

describe("the watermark", () => {
  it("lifts on approval, except on an after_payment share, where it waits for payment too", () => {
    for (const policy of ["none", "after_approval", "always"] as const) {
      expect(watermarked({ watermark: true, downloadPolicy: policy }, "in_review")).toBe(true);
      expect(watermarked({ watermark: true, downloadPolicy: policy }, "approved")).toBe(false);
    }
    expect(watermarked({ watermark: true, downloadPolicy: "after_payment" }, "approved", false)).toBe(true);
    expect(watermarked({ watermark: true, downloadPolicy: "after_payment" }, "in_review", true)).toBe(true);
    expect(watermarked({ watermark: true, downloadPolicy: "after_payment" }, "approved", true)).toBe(false);
    expect(watermarked({ watermark: false, downloadPolicy: "after_payment" }, "in_review")).toBe(false);
  });
});

describe("what a locked download says", () => {
  it("names the invoice, and what is still missing", () => {
    expect(lockNote("after_payment", "in_review", { number: "PD6327", paid: false })).toBe("Files unlock once approved and invoice PD6327 is paid.");
    expect(lockNote("after_payment", "approved", { number: "PD6327", paid: false })).toBe("Files unlock when invoice PD6327 is paid.");
    expect(lockNote("after_payment", "in_review", { number: "PD6327", paid: true })).toBe("Files unlock when you approve.");
    expect(lockNote("after_payment", "approved", { number: "PD6327", paid: true })).toBeNull();
    expect(lockNote("after_payment", "approved", null)).toBe("Files unlock when the invoice is paid.");
    expect(lockNote("after_approval", "in_review", null)).toBe("Clean download unlocks when you approve.");
    expect(lockNote("none", "approved", null)).toBeNull();
    expect(lockNote("always", "in_review", null)).toBeNull();
  });
});
