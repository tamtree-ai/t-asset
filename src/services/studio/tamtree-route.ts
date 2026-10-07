/** The wrapper every `/api/tamtree/*` route uses: the bearer token, JSON in and out, and errors as `{ error }` with a fitting status. */
import "server-only";

import { studioEnv } from "@/lib/studio/env";
import { bearerMatches } from "@/lib/tamtree";

import { TamtreeError } from "./tamtree";

const NO_STORE = { "cache-control": "no-store" };

export async function tamtreeRoute(req: Request, fn: () => Promise<unknown>): Promise<Response> {
  if (!bearerMatches(req.headers.get("authorization"), studioEnv().tamtree.apiToken)) {
    return Response.json({ error: "A valid Tamtree token is required." }, { status: 401, headers: NO_STORE });
  }
  try {
    return Response.json(await fn(), { headers: NO_STORE });
  } catch (e) {
    if (e instanceof TamtreeError) return Response.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
    if (issues?.length) return Response.json({ error: issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, { status: 422, headers: NO_STORE });
    if (e instanceof SyntaxError) return Response.json({ error: "The body must be JSON." }, { status: 400, headers: NO_STORE });
    console.error("[tamtree api]", e);
    return Response.json({ error: "Something went wrong in t-asset." }, { status: 500, headers: NO_STORE });
  }
}

export type FileCtx = { params: Promise<{ fileId: string }> };

/** A body that may be empty. */
export async function jsonBody(req: Request): Promise<unknown> {
  const text = await req.text();
  return text ? JSON.parse(text) : {};
}
