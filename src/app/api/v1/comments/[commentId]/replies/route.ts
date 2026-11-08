import { apiRoute, body, type IdCtx } from "@/services/studio/api-route";
import { replyToComment } from "@/services/studio/review-api";

/** A studio reply `{ body, resolve? }` → `{ id, parentId, resolved }` (201). */
export async function POST(req: Request, ctx: IdCtx<"commentId">) {
  return apiRoute(req, "review:write", async (c) => ({ status: 201, body: await replyToComment(c.orgId, (await ctx.params).commentId, await body(req)) }));
}
