import { StudioError } from "@/lib/studio/errors";
import { commentsCsv } from "@/services/studio/export";
import { ownerOrNull } from "@/services/studio/owner-route";

/** `GET /api/studio/export?version=<id>` or `?project=<id>`: the comments as a CSV the studio can open in a spreadsheet. */
export async function GET(req: Request) {
  const member = await ownerOrNull();
  if (!member) return new Response("Sign in first.", { status: 401 });
  const q = new URL(req.url).searchParams;
  const uuid = /^[0-9a-f-]{36}$/i;
  const versionId = q.get("version");
  const projectId = q.get("project");
  if ((versionId && !uuid.test(versionId)) || (projectId && !uuid.test(projectId))) return new Response("Not found.", { status: 404 });
  try {
    const { csv, name } = await commentsCsv(member.orgId, { versionId: versionId ?? undefined, projectId: projectId ?? undefined });
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof StudioError) return new Response(e.message, { status: 404 });
    throw e;
  }
}
