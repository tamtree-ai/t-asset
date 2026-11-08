import { apiRoute, type IdCtx } from "@/services/studio/api-route";
import { getVersion } from "@/services/studio/review-api";

/** `{ id, assetId, externalRef, number, status, released, processing, decision, builtFrom }`. */
export async function GET(req: Request, ctx: IdCtx<"versionId">) {
  return apiRoute(req, "review:read", async (c) => getVersion(c.orgId, (await ctx.params).versionId));
}
