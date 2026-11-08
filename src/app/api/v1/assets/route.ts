import { apiRoute, body, created } from "@/services/studio/api-route";
import { upsertAsset } from "@/services/studio/review-api";

/** `{ projectId, title, kind, externalRef }` → `{ assetId, variationId, created }`: found by externalRef, or made. */
export async function PUT(req: Request) {
  return apiRoute(req, "review:write", async (c) => created(await upsertAsset(c.orgId, await body(req))));
}
