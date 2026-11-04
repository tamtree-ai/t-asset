import { z } from "zod";

import { startDeliverableUpload } from "@/services/studio/deliverables";
import { UploadError } from "@/services/studio/files";
import { ownerOrNull, unauthorized } from "@/services/studio/owner-route";

const input = z.object({ versionId: z.string().uuid(), name: z.string().trim().min(1).max(200), bytes: z.number().int().positive() });

/** Step 1 of attaching a deliverable to a version: checks the type, size and storage meter, and says where to send the bytes. */
export async function POST(req: Request) {
  const member = await ownerOrNull();
  if (!member) return unauthorized();
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "Pick a file and a version to attach it to." }, { status: 400 });
  try {
    return Response.json({ ok: true, data: await startDeliverableUpload(member.orgId, parsed.data) });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ ok: false, error: e.message }, { status: 400 });
    console.error("[deliverable init]", e);
    return Response.json({ ok: false, error: "The upload couldn't start. Try again." }, { status: 500 });
  }
}
