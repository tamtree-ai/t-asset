import { after } from "next/server";
import { z } from "zod";

import { finishUpload, UploadError } from "@/services/studio/files";
import { ownerOrNull, unauthorized } from "@/services/studio/owner-route";
import { notifyTamtree } from "@/services/studio/tamtree";

const input = z.object({ fileId: z.string().uuid(), variationId: z.string().uuid(), note: z.string().max(2000).default("") });

/** Step 3 of an upload: the bytes are in the store, so the file becomes the next version and Tamtree is told (after the response). */
export async function POST(req: Request) {
  const member = await ownerOrNull();
  if (!member) return unauthorized();
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "That upload was not found." }, { status: 400 });
  try {
    const data = await finishUpload({ orgId: member.orgId, memberId: member.memberId, fileId: parsed.data.fileId, variationId: parsed.data.variationId, changeNote: parsed.data.note });
    if (!data.alreadyDone) after(() => notifyTamtree(data.fileId));
    return Response.json({ ok: true, data });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ ok: false, error: e.message }, { status: 400 });
    console.error("[upload complete]", e);
    return Response.json({ ok: false, error: "The upload couldn't be finished. Try again." }, { status: 500 });
  }
}
