import { z } from "zod";

import { finishDeliverable } from "@/services/studio/deliverables";
import { UploadError } from "@/services/studio/files";
import { ownerOrNull, unauthorized } from "@/services/studio/owner-route";

const input = z.object({ versionId: z.string().uuid(), fileId: z.string().uuid() });

/** Step 3 of attaching a deliverable: the bytes are in the store; their first kilobyte is checked and the file joins the version's list. */
export async function POST(req: Request) {
  const member = await ownerOrNull();
  if (!member) return unauthorized();
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "That upload was not found." }, { status: 400 });
  try {
    return Response.json({ ok: true, data: await finishDeliverable(member.orgId, parsed.data) });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ ok: false, error: e.message }, { status: 400 });
    console.error("[deliverable complete]", e);
    return Response.json({ ok: false, error: "The upload couldn't be finished. Try again." }, { status: 500 });
  }
}
