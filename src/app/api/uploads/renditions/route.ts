import { z } from "zod";

import { renditionTargets, UploadError } from "@/services/studio/files";
import { ownerOrNull, unauthorized } from "@/services/studio/owner-route";

const input = z.object({ fileId: z.string().uuid(), variationId: z.string().uuid(), format: z.enum(["webp", "png"]).default("webp") });

/**
 * Between steps 2 and 3 of an image or document upload: signed PUTs for the renditions the owner's
 * browser makes (an image's watermarked preview and thumbnail; a document's proofs), and the text
 * to draw on them. The same shape as Tamtree's `/targets`.
 */
export async function POST(req: Request) {
  const member = await ownerOrNull();
  if (!member) return unauthorized();
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "That upload was not found." }, { status: 400 });
  try {
    return Response.json({ ok: true, data: await renditionTargets({ orgId: member.orgId, ...parsed.data }) });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ ok: false, error: e.message }, { status: 400 });
    console.error("[upload renditions]", e);
    return Response.json({ ok: false, error: "The previews couldn't be prepared. Try again." }, { status: 500 });
  }
}
