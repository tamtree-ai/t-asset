import { describe, expect, it } from "vitest";

import { rollupAsset, rollupProject, roundsState, roundsUsed, statusAfter } from "./rounds";

const cr = (versionId: string) => ({ versionId, decision: "changes_requested" as const });
const ok = (versionId: string) => ({ versionId, decision: "approved" as const });

describe("revision rounds", () => {
  it("counts each version that got a change request once, not each decision", () => {
    expect(roundsUsed([])).toBe(0);
    expect(roundsUsed([cr("a"), cr("a"), cr("b")])).toBe(2);
    expect(roundsUsed([ok("a"), cr("b")])).toBe(1);
  });

  it("says which round the project is in", () => {
    expect(roundsState([], 3)).toMatchObject({ label: "Round 1 of 3", over: false, note: null });
    expect(roundsState([cr("a")], 3).label).toBe("Round 2 of 3");
  });

  it("goes over the contract without blocking, and says so neutrally", () => {
    const s = roundsState([cr("a"), cr("b"), cr("c")], 3);
    expect(s).toMatchObject({ label: "Round 4 of 3", over: true, note: "Extra rounds may be billed." });
    expect(roundsState([cr("a")], 0).over).toBe(true);
  });

  it("follows the latest decision: a client can change their mind", () => {
    expect(statusAfter("approved")).toBe("approved");
    expect(statusAfter("changes_requested")).toBe("changes_requested");
  });
});

describe("status roll-up", () => {
  it("an asset is approved as soon as one option is, since options are alternatives", () => {
    expect(rollupAsset(["in_review", "approved"])).toBe("approved");
    expect(rollupAsset(["changes_requested", "in_review"])).toBe("changes_requested");
    expect(rollupAsset(["in_review"])).toBe("in_review");
    expect(rollupAsset([])).toBe("empty");
  });

  it("a project is approved only when every asset with an upload is", () => {
    expect(rollupProject(["approved", "approved"])).toBe("approved");
    expect(rollupProject(["approved", "in_review"])).toBe("in_review");
    expect(rollupProject(["approved", "changes_requested", "in_review"])).toBe("changes_requested");
  });

  it("ignores assets with nothing uploaded, and says empty when there is nothing at all", () => {
    expect(rollupProject(["approved", "empty"])).toBe("approved");
    expect(rollupProject(["empty", "empty"])).toBe("empty");
    expect(rollupProject([])).toBe("empty");
  });
});
