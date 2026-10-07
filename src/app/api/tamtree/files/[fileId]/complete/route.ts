import { complete } from "@/services/studio/tamtree";
import { type FileCtx, jsonBody, tamtreeRoute } from "@/services/studio/tamtree-route";

/** `{ sha256, width, height, durationS?, fpsNum?, fpsDen?, outputs: { <name>: { key } } }`. Idempotent. */
export async function POST(req: Request, ctx: FileCtx) {
  return tamtreeRoute(req, async () => complete((await ctx.params).fileId, await jsonBody(req)));
}
