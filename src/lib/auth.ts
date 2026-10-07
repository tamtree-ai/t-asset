/**
 * The signed-in member, from the session cookie; nobody signed in goes to sign-in. `proxy.ts` only
 * checks that a cookie is present; this is the real check, so every page, action and route that
 * reads org data calls it.
 */
import "server-only";

import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db, schema } from "@/db";
import { hashToken, SESSION_COOKIE } from "@/lib/session-token";

export type MemberRole = "owner" | "editor";

export type CurrentMember = {
  memberId: string;
  orgId: string;
  name: string | null;
  email: string;
  role: MemberRole;
};

export { SESSION_COOKIE };

/** The member behind a session cookie value, or null. */
export async function memberForSession(token: string | undefined): Promise<CurrentMember | null> {
  if (!token) return null;
  const [row] = await db
    .select({ member: schema.members })
    .from(schema.sessions)
    .innerJoin(schema.members, eq(schema.members.id, schema.sessions.memberId))
    .where(and(eq(schema.sessions.tokenHash, hashToken(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  const m = row.member;
  return { memberId: m.id, orgId: m.orgId, name: m.name, email: m.email, role: m.role };
}

export const getCurrentMember = cache(async (): Promise<CurrentMember> => {
  const jar = await cookies();
  const member = await memberForSession(jar.get(SESSION_COOKIE)?.value);
  if (!member) redirect("/sign-in");
  return member;
});
