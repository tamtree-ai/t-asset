import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/session-token";

/**
 * The sign-in gate. An optimistic check only: a request without a session cookie goes to sign-in.
 * `getCurrentMember()` is the real check, so a forged or expired cookie still ends at sign-in.
 */
const PUBLIC = [
  /^\/review(\/|$)/, // review room: share token + passcode
  /^\/sign-in(\/|$)/,
  /^\/api\/health$/,
  /^\/api\/tamtree(\/|$)/, // Tamtree: bearer token, checked per request
  /^\/api\/cron(\/|$)/, // Vercel cron: CRON_SECRET, checked per request
  /^\/api\/dev-blob(\/|$)/, // local blob driver: signed URLs, 404 on Vercel Blob
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  // Everything but build output and the files in public/.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|[\\w-]+\\.svg$).*)"],
};
