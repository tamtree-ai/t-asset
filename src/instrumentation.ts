/** Fails a production deployment at startup when its settings are missing or unsafe (lib/studio/env.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertStudioEnv } = await import("@/lib/studio/env");
  assertStudioEnv();
}
