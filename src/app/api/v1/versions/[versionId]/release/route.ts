import { apiRoute, type IdCtx } from "@/services/studio/api-route";
import { releaseVersion } from "@/services/studio/review-api";

/** Internal → visible to the client. Idempotent. */
export async function POST(req: Request, ctx: IdCtx<"versionId">) {
  return apiRoute(req, "review:write", async (c) => releaseVersion(c.orgId, (await ctx.params).versionId));
}
