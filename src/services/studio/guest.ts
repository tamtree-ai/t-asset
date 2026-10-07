/** What a review page, action or file route needs first: the share, the cookie's session, and the reviewer. */
import "server-only";

import { cookies } from "next/headers";

import { StudioError } from "@/lib/studio/errors";

import { findShareByToken, type ReviewerRow, type Session, sessionCookieName, sessionFor, type ShareRow } from "./access";
import { shareState } from "./shares";

export type GuestState =
  | { kind: "missing" }
  | { kind: "ended"; share: ShareRow; reason: "revoked" | "expired" }
  | { kind: "gate"; share: ShareRow }
  | { kind: "identify"; share: ShareRow; session: Session }
  | { kind: "room"; share: ShareRow; session: Session; reviewer: ReviewerRow };

export async function guestState(token: string): Promise<GuestState> {
  const share = await findShareByToken(token);
  if (!share) return { kind: "missing" };
  const state = shareState(share);
  if (state !== "live") return { kind: "ended", share, reason: state };
  const jar = await cookies();
  const session = await sessionFor(share, jar.get(sessionCookieName(share.id))?.value);
  if (!session) return { kind: "gate", share };
  if (!session.reviewer) return { kind: "identify", share, session };
  return { kind: "room", share, session, reviewer: session.reviewer };
}

/** For actions that need a named reviewer. Anything less is a refusal in plain words. */
export async function requireReviewer(token: string): Promise<{ share: ShareRow; session: Session; reviewer: ReviewerRow }> {
  const g = await guestState(token);
  if (g.kind === "room") return g;
  if (g.kind === "ended") throw new StudioError("This link has ended.");
  if (g.kind === "missing") throw new StudioError("This link isn't valid.");
  throw new StudioError("Your session has ended. Reload the page and enter the passcode again.");
}

/** A session that passed the gate, named or not (the file route serves the logo and previews to it). */
export async function requireSession(token: string): Promise<{ share: ShareRow; session: Session } | null> {
  const g = await guestState(token);
  return g.kind === "room" || g.kind === "identify" ? g : null;
}
