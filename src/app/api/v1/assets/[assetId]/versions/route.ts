import { apiRoute, body, created, type IdCtx } from "@/services/studio/api-route";
import { createVersion } from "@/services/studio/review-api";

/** A new version: `{ externalRef, changeNote?, variation?, meta?, builtFrom?, internal?, file }` → `{ versionId, number, status, processing, created, upload? }`. */
export async function POST(req: Request, ctx: IdCtx<"assetId">) {
  return apiRoute(req, "review:write", async (c) => created(await createVersion(c.orgId, (await ctx.params).assetId, await body(req))));
}
