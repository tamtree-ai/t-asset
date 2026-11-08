import { apiRoute, body, created } from "@/services/studio/api-route";
import { upsertProject } from "@/services/studio/review-api";

/** `{ client, project }` → `{ projectId, clientId, created }`: found by name, or made. */
export async function PUT(req: Request) {
  return apiRoute(req, "review:write", async (c) => created(await upsertProject(c.orgId, await body(req))));
}
