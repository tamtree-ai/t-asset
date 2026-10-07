/** The studio's brand (plan §3): name, accent, room theme, website and support address. */
import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { normaliseHex } from "@/lib/studio/color";

export type Brand = {
  orgId: string;
  studioName: string;
  accentHex: string;
  roomTheme: "light" | "dark" | "auto";
  website: string | null;
  supportEmail: string | null;
};

export const DEFAULT_BRAND = { studioName: "Studio", accentHex: "#1f6feb", roomTheme: "light" as const };

export async function getBrand(orgId: string): Promise<Brand> {
  const [row] = await db.select().from(schema.studioBrand).where(eq(schema.studioBrand.orgId, orgId)).limit(1);
  if (row) return { orgId: row.orgId, studioName: row.studioName, accentHex: row.accentHex, roomTheme: row.roomTheme, website: row.website, supportEmail: row.supportEmail };
  const [org] = await db.select({ name: schema.orgs.name }).from(schema.orgs).where(eq(schema.orgs.id, orgId)).limit(1);
  return { orgId, ...DEFAULT_BRAND, studioName: org?.name || DEFAULT_BRAND.studioName, website: null, supportEmail: null };
}

const optionalUrl = z
  .string()
  .trim()
  .max(200)
  .transform((s) => (s === "" ? null : /^https?:\/\//i.test(s) ? s : `https://${s}`))
  .refine((s) => s === null || /^https?:\/\/[^\s/]+\.[^\s/]+/.test(s), "That website address doesn't look right.");

const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .transform((s) => (s === "" ? null : s.toLowerCase()))
  .refine((s) => s === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), "That support email doesn't look right.");

export const brandInput = z.object({
  studioName: z.string().trim().min(1, "Give the studio a name.").max(60, "Keep the studio name under 60 characters."),
  accentHex: z.string().transform((s, ctx) => {
    const h = normaliseHex(s);
    if (!h) ctx.addIssue({ code: "custom", message: "The accent colour must be a hex colour like #1f6feb." });
    return h ?? "#1f6feb";
  }),
  roomTheme: z.enum(["light", "dark", "auto"]),
  website: optionalUrl,
  supportEmail: optionalEmail,
});

export async function saveBrand(orgId: string, raw: unknown): Promise<Brand> {
  const input = brandInput.parse(raw);
  await db.insert(schema.studioBrand).values({ orgId, ...input }).onConflictDoUpdate({ target: schema.studioBrand.orgId, set: { ...input, updatedAt: new Date() } });
  return getBrand(orgId);
}
