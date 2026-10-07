"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, guard, StudioError } from "@/lib/studio/errors";
import { studioMember } from "@/lib/studio/member";
import { addReply, addRoot, type Author, type CommentView, deleteOwn, editComment, hideComment, listThreads, ownerScope, setResolved } from "@/services/studio/comments";

/** The studio's side of the review room on /studio/assets/[id]: the same comments, plus internal ones and hiding. */

async function ctx(versionId: string) {
  const m = await studioMember();
  const scope = await ownerScope(m.orgId, versionId);
  if (!scope) throw new StudioError("That version was not found.");
  const label = m.name?.trim() || m.email;
  const author: Author = { kind: "member", memberId: m.memberId, label };
  return { m, scope, author, viewer: { memberId: m.memberId } };
}

const after = async (c: Awaited<ReturnType<typeof ctx>>): Promise<CommentView[]> => {
  revalidatePath("/studio", "layout");
  return listThreads(c.scope, c.viewer);
};

export async function ownerThreadsAction(versionId: string): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const c = await ctx(versionId);
    return listThreads(c.scope, c.viewer);
  });
}

export async function ownerCommentAction(versionId: string, input: { body: string; annotation?: unknown; internal?: boolean }): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const c = await ctx(versionId);
    await addRoot(c.scope, c.author, input);
    return after(c);
  });
}

export async function ownerReplyAction(versionId: string, input: { parentId: string; quoteId?: string | null; body: string }): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const c = await ctx(versionId);
    await addReply(c.scope, c.author, input);
    return after(c);
  });
}

export async function ownerResolveAction(versionId: string, commentId: string, resolved: boolean): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const c = await ctx(versionId);
    await setResolved(c.scope, commentId, c.author.label, resolved);
    return after(c);
  });
}

export async function ownerEditAction(versionId: string, commentId: string, body: string): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const c = await ctx(versionId);
    await editComment(c.scope, c.author, commentId, body);
    return after(c);
  });
}

export async function ownerDeleteAction(versionId: string, commentId: string): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const c = await ctx(versionId);
    await deleteOwn(c.scope, c.author, commentId);
    return after(c);
  });
}

export async function ownerHideAction(versionId: string, commentId: string): Promise<ActionResult<CommentView[]>> {
  return guard(async () => {
    const c = await ctx(versionId);
    if (c.m.role !== "owner") throw new StudioError("Only the owner can hide comments.");
    await hideComment(c.scope, c.author.label, commentId);
    return after(c);
  });
}
