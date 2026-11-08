import { FeedError, readFeed } from "@/services/hooks/subscriptions";

/**
 * A pull hook's feed (hooks plan §5.5): `Authorization: Bearer ttf_…`, answers `{ items: [envelope] }`,
 * newest first, the last 7 days, at most 200. Dedupe by `id` on your side.
 */
export async function GET(req: Request, ctx: { params: Promise<{ hookId: string }> }) {
  try {
    const feed = await readFeed((await ctx.params).hookId, req.headers.get("authorization"));
    return Response.json(feed, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (!(e instanceof FeedError)) throw e;
    const headers: Record<string, string> = { "cache-control": "no-store" };
    if (e.retryAfterS) headers["retry-after"] = String(e.retryAfterS);
    return Response.json({ error: e.message }, { status: e.status, headers });
  }
}
