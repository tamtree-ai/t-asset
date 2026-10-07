import { getBlobStore } from "@/lib/blob";
import { getFile, type Rendition, renditionOf } from "@/services/studio/files";
import { ownerOrNull } from "@/services/studio/owner-route";

const RENDITIONS: Rendition[] = ["original", "preview", "poster", "thumb", "wm"];

/**
 * The studio's own view of a file: `?r=preview|poster|thumb|wm|original` (default preview;
 * `&download=1` to save it). Members of the file's org only; answers with a redirect to a signed
 * URL that lasts 5 minutes, so the bytes never pass through the app.
 */
export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const member = await ownerOrNull();
  if (!member) return new Response("Sign in first.", { status: 401 });
  const { fileId } = await params;
  const url = new URL(req.url);
  const r = (url.searchParams.get("r") ?? "preview") as Rendition;
  if (!RENDITIONS.includes(r) || !/^[0-9a-f-]{36}$/i.test(fileId)) return new Response("Not found.", { status: 404 });

  const file = await getFile(member.orgId, fileId);
  const rendition = file && renditionOf(file, r);
  if (!file || !rendition) return new Response("Not found.", { status: 404 });
  const target = await getBlobStore().readUrl(rendition.key, { validForS: 300, download: url.searchParams.get("download") === "1" });
  return new Response(null, { status: 302, headers: { location: target, "cache-control": "private, no-store", "x-robots-tag": "noindex" } });
}
