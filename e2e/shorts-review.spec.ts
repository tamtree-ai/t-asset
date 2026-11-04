import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * Shorts review (changes/2026-11-04-shorts-service, D8): a draft the pipeline makes is internal.
 * The owner sees it in "Drafts to review" with its "why", the client's room doesn't show it, and
 * one release puts it in front of the client.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

async function sql(text: string, params: unknown[] = []) {
  const c = new Client({ connectionString: process.env.DATABASE_URL ?? "postgres://tasset:tasset@localhost:5434/tasset" });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
}

const stamp = Date.now().toString(36);
const CLIENT = `E2E Shorts ${stamp}`;
const WHY = "Works cold: a question, the answer, and a joke in 30 seconds.";
let mp4: Buffer;
let projectUrl = "";
let link = "";
let passcode = "";
let guest: Page;

test.beforeAll(() => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "shorts-e2e-")), "s1.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=3", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-y", out]);
  mp4 = readFileSync(out);
});

test("1. a short arrives as an internal draft with its why", async ({ page }) => {
  await page.goto("/studio");
  await page.getByRole("button", { name: "New client" }).click();
  await page.getByLabel("Client name").fill(CLIENT);
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Movie shorts");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page).toHaveURL(/\/studio\/projects\//);
  projectUrl = page.url();
  await page.getByRole("button", { name: "New asset" }).click();
  await page.getByLabel("Title").fill("Make a Wish");
  await page.getByLabel(/Video/).check();
  await page.getByRole("button", { name: "Add asset" }).click();
  await expect(page).toHaveURL(/\/studio\/assets\//);
  await page.getByLabel("Choose a file").setInputFiles({ name: "s1.mp4", mimeType: "video/mp4", buffer: mp4 });
  await page.getByRole("button", { name: "Upload v1" }).click();
  await expect(page.locator("video")).toBeVisible({ timeout: 90_000 });

  // What `pnpm shorts ingest` does to a version: internal, with the pipeline's notes.
  await sql(
    `update studio_versions v set released_at = null, meta = $2::jsonb
       from studio_variations va join studio_assets a on a.id = va.asset_id join studio_projects p on p.id = a.project_id join studio_clients c on c.id = p.client_id
      where va.id = v.variation_id and c.name = $1`,
    [CLIENT, JSON.stringify({ source: "shorts", why: WHY, hook: "Every star is a sun" })],
  );
  await page.reload();
  await expect(page.getByText("Internal draft.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Why this short" })).toContainText(WHY);
});

test("2. the client's room doesn't show the draft", async ({ page, browser }) => {
  await page.goto(projectUrl);
  await page.getByRole("link", { name: "New review link" }).click();
  await page.getByLabel("Title (the client sees this)").fill("Shorts round one");
  await page.getByRole("button", { name: "Create review link" }).click();
  await page.getByRole("button", { name: "Show link and passcode" }).click();
  link = await page.getByLabel("Review link").inputValue();
  passcode = (await page.getByLabel("Passcode", { exact: true }).inputValue()).replace(/\s/g, "");

  const ctx = await browser.newContext({ baseURL: "http://localhost:3200", storageState: { cookies: [], origins: [] } });
  guest = await ctx.newPage();
  await guest.goto(link);
  await guest.getByLabel("Passcode").fill(passcode);
  await guest.getByRole("button", { name: "Open the review" }).click();
  await guest.getByLabel("Your name").fill("Pat");
  await guest.getByLabel("Your email").fill(`pat-${stamp}@example.com`);
  await guest.getByRole("button", { name: "Continue" }).click();
  await expect(guest.getByRole("heading", { name: "Your work is on its way" })).toBeVisible();
  await expect(guest.locator("video")).toHaveCount(0);
});

test("3. the queue lists it; releasing it puts it in the client's room", async ({ page }) => {
  await page.goto("/studio/queue");
  const group = page.locator("form", { hasText: CLIENT });
  await expect(group).toContainText("Make a Wish");
  await expect(group).toContainText(WHY);
  await group.getByRole("button", { name: "Release selected to client" }).click();
  await expect(page.locator("form", { hasText: CLIENT })).toHaveCount(0);

  await guest.reload();
  await expect(guest.locator("video")).toBeVisible({ timeout: 30_000 });
});
