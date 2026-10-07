"use server";

import { cookies, headers } from "next/headers";

import { type ActionResult, guard, StudioError } from "@/lib/studio/errors";
import { clientIp, findShareByToken, identify, limitOrThrow, sessionCookieName, SESSION_DAYS, touchReviewer, unlockShare } from "@/services/studio/access";
import { addReply, addRoot, type Author, type CommentView, deleteOwn, editComment, guestScope, listThreads, setResolved } from "@/services/studio/comments";
import { decide, type DecideInput } from "@/services/studio/decisions";
import { requireReviewer, requireSession } from "@/services/studio/guest";

async function meta() {
  const h = await headers();
  return { ip: clientIp(h), ua: h.get("user-agent") };
}

export async function unlockAction(token: string, passcode: string): Promise<ActionResult> {
  return guard(async () => {
    const m = await meta();
    const { sessionToken, shareId, expiresAt } = await unlockShare(token, passcode, m);
    const jar = await cookies();
    jar.set(sessionCookieName(shareId), sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: `/review/${token}`,
      maxAge: SESSION_DAYS * 86_400,
      expires: expiresAt,
    });
    return undefined;
  });
}

export async function identifyAction(token: string, name: string, email: string): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await requireSession(token);
    if (!ctx) throw new StudioError("Your session has ended. Reload the page and enter the passcode again.");
    const m = await meta();
    await limitOrThrow("identify", `${ctx.share.id}:${m.ip ?? "unknown"}`, "joining");
    await identify(ctx.share, ctx.session.id, { name, email });
    return undefined;
  });
}

const authorOf = (r: { id: string; name: string }): Author => ({ kind: "reviewer", reviewerId: r.id, label: r.name });

async function scopeFor(token: string, versionId: string) {
  const ctx = await requireReviewer(token);
  const scope = await guestScope(ctx.share, versionId);
  if (!scope) throw new StudioError("That version isn't part of this review.");
  return { ...ctx, scope };
}

async function threadsFor(ctx: Awaited<ReturnType<typeof scopeFor>>): Promise<CommentView[]> {
  return listThreads(ctx.scope, { reviewerId: ctx.reviewer.id });
}

export async function threadsAction(token: string, versionId: string): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const ctx = await scopeFor(token, versionId);
    await touchReviewer(ctx.reviewer.id);
    return threadsFor(ctx);
  });
}

export async function commentAction(token: string, versionId: string, input: { body: string; annotation?: unknown }): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const ctx = await scopeFor(token, versionId);
    await limitOrThrow("comment", ctx.reviewer.id, "commenting");
    await addRoot(ctx.scope, authorOf(ctx.reviewer), { body: input.body, annotation: input.annotation });
    return threadsFor(ctx);
  });
}

export async function replyAction(token: string, versionId: string, input: { parentId: string; quoteId?: string | null; body: string }): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const ctx = await scopeFor(token, versionId);
    await limitOrThrow("comment", ctx.reviewer.id, "commenting");
    await addReply(ctx.scope, authorOf(ctx.reviewer), input);
    return threadsFor(ctx);
  });
}

export async function resolveAction(token: string, versionId: string, commentId: string, resolved: boolean): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const ctx = await scopeFor(token, versionId);
    await setResolved(ctx.scope, commentId, ctx.reviewer.name, resolved);
    return threadsFor(ctx);
  });
}

export async function editAction(token: string, versionId: string, commentId: string, body: string): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const ctx = await scopeFor(token, versionId);
    await editComment(ctx.scope, authorOf(ctx.reviewer), commentId, body);
    return threadsFor(ctx);
  });
}

export async function deleteAction(token: string, versionId: string, commentId: string): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const ctx = await scopeFor(token, versionId);
    await deleteOwn(ctx.scope, authorOf(ctx.reviewer), commentId);
    return threadsFor(ctx);
  });
}

export async function decideAction(token: string, input: DecideInput): Promise<ActionResult<{ status: "approved" | "changes_requested" }>> {
  return guard(async () => {
    const ctx = await requireReviewer(token);
    const m = await meta();
    const { status } = await decide(ctx.share, ctx.reviewer, input, m);
    return { status: status as "approved" | "changes_requested" };
  });
}

/** Is the token still a live share? Lets the room show "this link has ended" without a reload when it is revoked mid-session. */
export async function pingAction(token: string): Promise<{ live: boolean }> {
  const share = await findShareByToken(token);
  return { live: !!share && !share.revokedAt && (!share.expiresAt || share.expiresAt > new Date()) };
}
