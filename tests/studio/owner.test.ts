/** Owner sign-in (plan §5.5): one owner from the environment, made with its studio on first sign-in, locked after five wrong tries. */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TEST_DB } from "./helpers";

vi.mock("server-only", () => ({}));

let owner: typeof import("@/services/owner");
let auth: typeof import("@/lib/auth");
let db: typeof import("@/db").db;
let schema: typeof import("@/db").schema;
let env: NodeJS.ProcessEnv;
const email = `owner-${randomUUID().slice(0, 8)}@example.com`;
const ip = () => `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

beforeAll(async () => {
  process.env.DATABASE_URL ??= TEST_DB;
  ({ db, schema } = await import("@/db"));
  owner = await import("@/services/owner");
  auth = await import("@/lib/auth");
  const { hashPassword } = await import("@/lib/password");
  env = { ...process.env, OWNER_EMAIL: email.toUpperCase(), OWNER_PASSWORD_HASH: await hashPassword("a long enough password"), STUDIO_NAME: "Test Studio" };
});
afterAll(async () => {
  const [m] = await db.select().from(schema.members).where(eq(schema.members.email, email));
  if (m) await db.delete(schema.orgs).where(eq(schema.orgs.id, m.orgId));
});

describe("sign-in", () => {
  it("creates the studio on the first good sign-in, and a session that finds the owner", async () => {
    const { token } = await owner.signIn({ email: ` ${email} `, password: "a long enough password" }, { ip: ip() }, env);
    const member = await auth.memberForSession(token);
    expect(member).toMatchObject({ email, role: "owner" });
    const [brand] = await db.select().from(schema.studioBrand).where(eq(schema.studioBrand.orgId, member!.orgId));
    expect(brand!.studioName).toBe("Test Studio");
    const again = await owner.signIn({ email, password: "a long enough password" }, { ip: ip() }, env);
    expect((await auth.memberForSession(again.token))!.orgId).toBe(member!.orgId);
  });

  it("refuses a wrong password or another email in the same words", async () => {
    await expect(owner.signIn({ email, password: "wrong password here" }, { ip: ip() }, env)).rejects.toThrow("That email and password don't match.");
    await expect(owner.signIn({ email: "someone@else.com", password: "a long enough password" }, { ip: ip() }, env)).rejects.toThrow("That email and password don't match.");
  });

  it("locks an address after five wrong tries, even for the right password", async () => {
    const from = ip();
    for (let i = 0; i < 4; i++) await expect(owner.signIn({ email, password: "nope nope nope" }, { ip: from }, env)).rejects.toThrow(/don't match/);
    await expect(owner.signIn({ email, password: "nope nope nope" }, { ip: from }, env)).rejects.toThrow(/Too many wrong tries/);
    await expect(owner.signIn({ email, password: "a long enough password" }, { ip: from }, env)).rejects.toThrow(/Too many wrong tries/);
  });

  it("says plainly when sign-in isn't set up", async () => {
    await expect(owner.signIn({ email, password: "x" }, { ip: ip() }, { ...env, OWNER_PASSWORD_HASH: "" })).rejects.toThrow(/isn't set up/);
  });

  it("signing out ends the session", async () => {
    const { token } = await owner.signIn({ email, password: "a long enough password" }, { ip: ip() }, env);
    await owner.signOut(token);
    expect(await auth.memberForSession(token)).toBeNull();
    expect(await auth.memberForSession(undefined)).toBeNull();
  });
});
