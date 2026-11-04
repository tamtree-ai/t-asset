import { after } from "next/server";
import { z } from "zod";

import { finishUpload, UploadError } from "@/services/studio/files";
import { ownerOrNull, unauthorized } from "@/services/studio/owner-route";
import { notifyTamtree } from "@/services/studio/tamtree";

const side = z.number().int().positive().max(100_000);
const input = z.object({
  fileId: z.string().uuid(),
  variationId: z.string().uuid(),
  note: z.string().max(2000).default(""),
  /** Images and documents: measured by the browser before the upload. */
  facts: z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/i), width: side, height: side, pageCount: z.number().int().positive().max(1000).optional() }).optional(),
  /** The format the browser made its renditions in. */
  format: z.enum(["webp", "png"]).default("webp"),
});

/** Step 3 of an upload: the bytes are in the store, so the file becomes the next version. An image or document is ready now; a video's Tamtree is told (after the response). */
export async function POST(req: Request) {
  const member = await ownerOrNull();
  if (!member) return unauthorized();
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "That upload was not found." }, { status: 400 });
  try {
    const data = await finishUpload({ orgId: member.orgId, memberId: member.memberId, fileId: parsed.data.fileId, variationId: parsed.data.variationId, changeNote: parsed.data.note, facts: parsed.data.facts, format: parsed.data.format });
    if (!data.alreadyDone && !data.ready) after(() => notifyTamtree(data.fileId));
    return Response.json({ ok: true, data });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ ok: false, error: e.message }, { status: 400 });
    console.error("[upload complete]", e);
    return Response.json({ ok: false, error: "The upload couldn't be finished. Try again." }, { status: 500 });
  }
}
