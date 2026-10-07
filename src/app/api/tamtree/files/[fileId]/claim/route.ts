import { claim } from "@/services/studio/tamtree";
import { type FileCtx, tamtreeRoute } from "@/services/studio/tamtree-route";

/** Takes the file for this run; 409 if another run holds a fresh claim or the file isn't waiting. */
export async function POST(req: Request, ctx: FileCtx) {
  return tamtreeRoute(req, async () => claim((await ctx.params).fileId));
}
