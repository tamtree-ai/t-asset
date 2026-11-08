import { studioEnv } from "@/lib/studio/env";
import { bearerMatches } from "@/lib/tamtree";
import { sweepDeliveries } from "@/services/hooks/deliver";

/**
 * The hooks retry sweep on demand (hooks plan §5.4): sends every due delivery, as the daily cleanup
 * does. Bearer TAMTREE_API_TOKEN, so a Tamtree Schedule Trigger can call it (hourly at most on Neon).
 */
export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), studioEnv().tamtree.apiToken)) return Response.json({ error: "Not allowed.", code: "unauthorized" }, { status: 401 });
  return Response.json(await sweepDeliveries(), { headers: { "cache-control": "no-store" } });
}
