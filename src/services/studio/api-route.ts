/**
 * The wrapper every Review API route (`/api/v1/*`) uses: the `tt_live_` bearer token and its
 * scope, the per-token rate limit, JSON in and out, and errors as `{ error, code }`.
 */
import "server-only";

import type { ApiScope } from "@/db/schema";
import { StudioError } from "@/lib/studio/errors";
import { retryAfterSeconds } from "@/lib/studio/limits";

import { hit } from "./access";
import { API_RATE, type ApiCaller, callerFor } from "./api-tokens";
import { ApiError } from "./review-api";

const NO_STORE = { "cache-control": "no-store" };

const fail = (status: number, code: string, error: string, headers: Record<string, string> = {}) => Response.json({ error, code }, { status, headers: { ...NO_STORE, ...headers } });

/** `fn` returns the body, or `{ status, body }` to answer with another status (201 for a create). */
export async function apiRoute(req: Request, scope: ApiScope, fn: (caller: ApiCaller) => Promise<unknown>): Promise<Response> {
  try {
    const caller = await callerFor(req.headers.get("authorization"));
    if (!caller) return fail(401, "unauthorized", "A valid API token is required (Authorization: Bearer tt_live_…).");
    if (!caller.scopes.includes(scope)) return fail(403, "forbidden", `This token lacks the ${scope} scope.`);
    const limit = await hit("api", caller.tokenId, API_RATE);
    if (!limit.allowed) return fail(429, "rate_limited", `Over ${API_RATE.limit} requests a minute. Slow down.`, { "retry-after": String(retryAfterSeconds(Date.now(), API_RATE.windowMs)) });
    const out = await fn(caller);
    if (out instanceof Response) return out;
    if (out && typeof out === "object" && "status" in out && "body" in out && typeof (out as { status: unknown }).status === "number") {
      const { status, body } = out as { status: number; body: unknown };
      return Response.json(body, { status, headers: NO_STORE });
    }
    return Response.json(out, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof ApiError) return fail(e.status, e.code, e.message);
    if (e instanceof StudioError) return fail(422, "refused", e.message);
    const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
    if (issues?.length) return fail(422, "invalid", issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    if (e instanceof SyntaxError) return fail(400, "bad_json", "The body must be JSON.");
    console.error("[review api]", e);
    return fail(500, "internal", "Something went wrong in tasset.");
  }
}

/** A JSON body that may be empty. */
export async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  return text ? JSON.parse(text) : {};
}

/** 201 when the call made something, 200 when it found what was already there. */
export const created = <T extends { created: boolean }>(out: T) => ({ status: out.created ? 201 : 200, body: out });

export type IdCtx<K extends string> = { params: Promise<Record<K, string>> };
