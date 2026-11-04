/**
 * The share's download rules, pure so the room (client) and the file routes (server) agree. Paid
 * means the share's invoice is marked paid; a void invoice never is.
 */
import type { VersionStatus } from "./rounds";

export type DownloadPolicy = "none" | "after_approval" | "always" | "after_payment";

/**
 * Whether the previews of this version carry the watermark: switched on for the share, and the
 * version is not yet approved. On an `after_payment` share approval alone is not enough: the clean
 * preview only appears once the share's invoice is paid.
 */
export function watermarked(share: { watermark: boolean; downloadPolicy: DownloadPolicy }, status: VersionStatus, paid = false): boolean {
  return share.watermark && !(status === "approved" && (share.downloadPolicy !== "after_payment" || paid));
}

/** The original and the deliverables leave only under the share's download policy. */
export function canDownloadOriginal(share: { downloadPolicy: DownloadPolicy }, status: VersionStatus, paid = false): boolean {
  switch (share.downloadPolicy) {
    case "always":
      return true;
    case "after_approval":
      return status === "approved";
    case "after_payment":
      return status === "approved" && paid;
    default:
      return false;
  }
}

/** What the client reads next to a locked download, or null when nothing is locked. */
export function lockNote(policy: DownloadPolicy, status: VersionStatus, invoice: { number: string | null; paid: boolean } | null): string | null {
  if (canDownloadOriginal({ downloadPolicy: policy }, status, !!invoice?.paid)) return null;
  if (policy === "after_approval") return "Clean download unlocks when you approve.";
  if (policy === "after_payment") {
    const inv = invoice?.number ? `invoice ${invoice.number}` : "the invoice";
    if (invoice?.paid) return "Files unlock when you approve.";
    return status === "approved" ? `Files unlock when ${inv} is paid.` : `Files unlock once approved and ${inv} is paid.`;
  }
  return null;
}
