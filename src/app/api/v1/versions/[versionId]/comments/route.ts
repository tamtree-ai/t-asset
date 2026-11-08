import { apiRoute, type IdCtx } from "@/services/studio/api-route";
import { listComments } from "@/services/studio/review-api";

/** `?since=<ISO>` → `{ comments: [{ id, number, parentId, author, byStudio, body, annotation, internal, resolved, createdAt }] }`. */
export async function GET(req: Request, ctx: IdCtx<"versionId">) {
  return apiRoute(req, "review:read", async (c) => ({ comments: await listComments(c.orgId, (await ctx.params).versionId, new URL(req.url).searchParams.get("since")) }));
}
