import { sql } from "drizzle-orm";

import { db } from "@/db";

/** Up, and the database answers. Tamtree's schedule may call it to keep Neon awake. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "The database isn't answering." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
