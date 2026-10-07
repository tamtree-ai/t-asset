"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE } from "@/lib/session-token";
import { guard } from "@/lib/studio/errors";
import { signIn, signOut } from "@/services/owner";
import { clientIp } from "@/services/studio/access";

export async function signInAction(email: string, password: string) {
  const res = await guard(async () => {
    const { token, expiresAt } = await signIn({ email, password }, { ip: clientIp(await headers()) });
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
  });
  if (res.ok) redirect("/studio");
  return res;
}

export async function signOutAction() {
  const jar = await cookies();
  await signOut(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/sign-in");
}
