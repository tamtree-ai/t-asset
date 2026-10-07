/** A refusal with a message fit to show: services throw it, actions turn it into `{ ok:false, error }`. */
export class StudioError extends Error {}

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Runs an action body; a StudioError or a zod refusal becomes its message, anything else is logged and made generic. */
export async function guard<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof StudioError) return { ok: false, error: e.message };
    const issues = (e as { issues?: { message: string }[] }).issues;
    if (issues?.[0]) return { ok: false, error: issues[0].message };
    // next/navigation redirects are thrown; let them through.
    if (typeof (e as { digest?: string }).digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_")) throw e;
    console.error("[studio]", e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
