/** For owner JSON routes: the signed-in member from the cookie, or a 401 (no redirect, the caller is `fetch`). */
import "server-only";

import { cookies } from "next/headers";

import { type CurrentMember, memberForSession, SESSION_COOKIE } from "@/lib/auth";

export async function ownerOrNull(): Promise<CurrentMember | null> {
  const jar = await cookies();
  return memberForSession(jar.get(SESSION_COOKIE)?.value);
}

export const unauthorized = () => Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
