import { studioEnv } from "@/lib/studio/env";
import { bearerMatches } from "@/lib/tamtree";
import { cleanup } from "@/services/studio/cleanup";

/** Vercel cron, once a day (vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), studioEnv().cronSecret)) return Response.json({ error: "Not allowed." }, { status: 401 });
  return Response.json(await cleanup(), { headers: { "cache-control": "no-store" } });
}
