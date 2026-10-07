import { job } from "@/services/studio/tamtree";
import { type FileCtx, tamtreeRoute } from "@/services/studio/tamtree-route";

/** One job: the original as a signed URL, the outputs wanted, and the watermark text. */
export async function GET(req: Request, ctx: FileCtx) {
  return tamtreeRoute(req, async () => job((await ctx.params).fileId));
}
