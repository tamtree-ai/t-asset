import { pendingFiles } from "@/services/studio/tamtree";
import { tamtreeRoute } from "@/services/studio/tamtree-route";

/** Files waiting for processing, oldest first. For a Tamtree schedule trigger, as the safety net behind the webhook. `?limit=` up to 50. */
export async function GET(req: Request) {
  return tamtreeRoute(req, async () => ({ files: await pendingFiles(Number(new URL(req.url).searchParams.get("limit") ?? 10) || 10) }));
}
