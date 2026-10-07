import { targets } from "@/services/studio/tamtree";
import { type FileCtx, tamtreeRoute } from "@/services/studio/tamtree-route";

/** A signed PUT (1 hour) for each output. Send the file as the body with exactly the headers given. */
export async function POST(req: Request, ctx: FileCtx) {
  return tamtreeRoute(req, async () => targets((await ctx.params).fileId));
}
