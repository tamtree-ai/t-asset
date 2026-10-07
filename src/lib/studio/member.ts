import "server-only";

import { type CurrentMember, getCurrentMember } from "@/lib/auth";

/** The signed-in owner or editor. Reviewers are guests on a share, never members. */
export async function studioMember(): Promise<CurrentMember> {
  return getCurrentMember();
}

/** The request's origin, for links when APP_URL is not set. */
export async function requestOrigin(): Promise<string> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
