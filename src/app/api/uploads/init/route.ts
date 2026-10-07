import { z } from "zod";

import { startUpload, UploadError } from "@/services/studio/files";
import { ownerOrNull, unauthorized } from "@/services/studio/owner-route";

const input = z.object({ variationId: z.string().uuid(), name: z.string().trim().min(1).max(200), mime: z.string().max(100), bytes: z.number().int().positive() });

/**
 * Step 1 of an upload (plan §5.2): checks the file and the storage meter, and answers with where
 * to send the bytes. The browser then uploads straight to the store, never through the app.
 */
export async function POST(req: Request) {
  const member = await ownerOrNull();
  if (!member) return unauthorized();
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "Pick a file and a variation to upload to." }, { status: 400 });
  try {
    return Response.json({ ok: true, data: await startUpload({ orgId: member.orgId, ...parsed.data }) });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ ok: false, error: e.message }, { status: 400 });
    console.error("[upload init]", e);
    return Response.json({ ok: false, error: "The upload couldn't start. Try again." }, { status: 500 });
  }
}
