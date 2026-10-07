/** Revision rounds (plan §5.2): a round is spent each time a different version gets "request changes". */

export type DecisionLite = { versionId: string; decision: "approved" | "changes_requested" };

export function roundsUsed(decisions: DecisionLite[]): number {
  return new Set(decisions.filter((d) => d.decision === "changes_requested").map((d) => d.versionId)).size;
}

export type RoundsState = { used: number; included: number; current: number; over: boolean; label: string; note: string | null };

export function roundsState(decisions: DecisionLite[], included: number): RoundsState {
  const used = roundsUsed(decisions);
  const current = used + 1;
  const over = used >= included;
  return {
    used,
    included,
    current,
    over,
    // Past the contract the label keeps counting ("Round 4 of 3") so neither side is surprised.
    label: `Round ${current} of ${included}`,
    note: over ? "Extra rounds may be billed." : null,
  };
}

export type VersionStatus = "in_review" | "changes_requested" | "approved";

/** The status after a decision: the latest decision on the version wins, so a client can change their mind. */
export function statusAfter(decision: DecisionLite["decision"]): VersionStatus {
  return decision === "approved" ? "approved" : "changes_requested";
}

export type ProjectRollup = "empty" | "in_review" | "changes_requested" | "approved";

/** An asset's status from the latest version of each variation. Variations are alternatives, so one approved direction approves the asset. */
export function rollupAsset(latestPerVariation: VersionStatus[]): VersionStatus | "empty" {
  if (latestPerVariation.length === 0) return "empty";
  if (latestPerVariation.includes("approved")) return "approved";
  if (latestPerVariation.includes("changes_requested")) return "changes_requested";
  return "in_review";
}

/** A project's status from its assets: all approved → approved; any with changes requested → changes; else in review. Assets with no upload yet are ignored. */
export function rollupProject(assets: (VersionStatus | "empty")[]): ProjectRollup {
  const live = assets.filter((s): s is VersionStatus => s !== "empty");
  if (live.length === 0) return "empty";
  if (live.every((s) => s === "approved")) return "approved";
  if (live.includes("changes_requested")) return "changes_requested";
  return "in_review";
}

export const STATUS_WORD: Record<VersionStatus | "empty", string> = {
  empty: "No uploads",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
};
