import { fail } from "@/services/studio/tamtree";
import { type FileCtx, jsonBody, tamtreeRoute } from "@/services/studio/tamtree-route";

/** `{ message, retryable? }`. The message is shown to the owner, so write it for them. */
export async function POST(req: Request, ctx: FileCtx) {
  return tamtreeRoute(req, async () => fail((await ctx.params).fileId, await jsonBody(req)));
}
