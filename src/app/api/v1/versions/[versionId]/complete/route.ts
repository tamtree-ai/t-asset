import { after } from "next/server";

import { apiRoute, type IdCtx } from "@/services/studio/api-route";
import { completeVersion } from "@/services/studio/review-api";
import { notifyTamtree } from "@/services/studio/tamtree";

/** The bytes are uploaded: checks them and hands the file to Tamtree (after the response). Idempotent. */
export async function POST(req: Request, ctx: IdCtx<"versionId">) {
  return apiRoute(req, "review:write", async (c) => {
    const { version, notifyFileId } = await completeVersion(c.orgId, (await ctx.params).versionId);
    if (notifyFileId) after(() => notifyTamtree(notifyFileId));
    return version;
  });
}
