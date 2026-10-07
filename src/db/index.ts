import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __tassetPool?: Pool };

/** One pool per instance. On Vercel (Fluid compute) the instance is reused, and `attachDatabasePool` closes idle clients before it is suspended. */
function pool(): Pool {
  if (!globalForDb.__tassetPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
    globalForDb.__tassetPool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 5_000 });
    if (process.env.VERCEL) attachDatabasePool(globalForDb.__tassetPool);
  }
  return globalForDb.__tassetPool;
}

export const db = drizzle({ client: pool(), schema });
export { schema };
