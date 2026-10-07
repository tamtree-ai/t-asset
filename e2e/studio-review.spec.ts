import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";
import sharp from "sharp";

/**
 * t-asset end to end (plan §9): the owner sets up a client, project and two assets; uploads go
 * straight to the store and the fake Tamtree makes the previews; a guest opens the link, comments,
 * replies and approves; the download rules follow. Needs ffmpeg on PATH and Postgres.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const db = () => new Client({ connectionString: process.env.DATABASE_URL ?? "postgres://tasset:tasset@localhost:5434/tasset" });
async function sql<T extends object = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = db();
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

const stamp = Date.now().toString(36);
const CLIENT = `E2E Coffee ${stamp}`;
let png: Buffer;
let png2: Buffer;
let mp4: Buffer;
let link = "";
let passcode = "";
let projectUrl = "";
let imageAssetUrl = "";
let guest: Page;

test.beforeAll(async () => {
  png = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#2a9d8f" } }).png().toBuffer();
  png2 = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#e76f51" } }).png().toBuffer();
  const out = path.join(mkdtempSync(path.join(tmpdir(), "studio-e2e-")), "teaser.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=4", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-y", out]);
  mp4 = readFileSync(out);
});

async function upload(page: Page, name: string, mimeType: string, buffer: Buffer, note: string, n: number) {
  await page.getByLabel("Choose a file").setInputFiles({ name, mimeType, buffer });
  await page.getByLabel(/What changed in v\d+\?/).fill(note);
  await page.getByRole("button", { name: `Upload v${n}` }).click();
}

async function newGuest(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3200", storageState: { cookies: [], origins: [] } });
  return ctx.newPage();
}

test("1. the owner sets up a client, a project, an image with two options, and a video", async ({ page }) => {
  await page.goto("/studio");
  await page.getByRole("button", { name: "New client" }).click();
  await page.getByLabel("Client name").fill(CLIENT);
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page).toHaveURL(/\/studio\/clients\/[0-9a-f-]+/);
  await expect(page.getByRole("heading", { name: CLIENT })).toBeVisible();

  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Spring campaign");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page).toHaveURL(/\/studio\/projects\/[0-9a-f-]+/);
  projectUrl = page.url();
  await expect(page.getByText("Round 1 of 2").first()).toBeVisible();

  // Image asset, two options.
  await page.getByRole("button", { name: "New asset" }).click();
  await page.getByLabel("Title").fill("Instagram banner");
  await page.getByRole("button", { name: "Add asset" }).click();
  await expect(page).toHaveURL(/\/studio\/assets\//);
  imageAssetUrl = page.url().split("?")[0]!;
  await page.getByText("Asset settings").click();
  await page.getByLabel("Add another option").fill("Option B: bold");
  await page.getByRole("button", { name: "Add option" }).click();
  await expect(page.getByRole("link", { name: "Option B: bold" })).toBeVisible();

  // v1 of each option.
  await page.getByRole("link", { name: "Main" }).click();
  await upload(page, "banner-a.png", "image/png", png, "First idea", 1);
  await expect(page.getByAltText(/Instagram banner, Main, version 1/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Option B: bold" }).click();
  await upload(page, "banner-b.png", "image/png", png2, "Bolder", 1);
  await expect(page.getByAltText(/Instagram banner, Option B: bold, version 1/)).toBeVisible({ timeout: 60_000 });

  // The video.
  await page.goto(projectUrl);
  await page.getByRole("button", { name: "New asset" }).click();
  await page.getByLabel("Title").fill("Launch teaser");
  await page.getByLabel(/Video/).check();
  await page.getByRole("button", { name: "Add asset" }).click();
  await expect(page).toHaveURL(/\/studio\/assets\//);
  await upload(page, "teaser.mp4", "video/mp4", mp4, "Rough cut", 1);
  await expect(page.locator("video")).toBeVisible({ timeout: 90_000 });
});

test("2. the owner makes a review link with a message", async ({ page }) => {
  await page.goto(projectUrl);
  await page.getByRole("link", { name: "New review link" }).click();
  await page.getByLabel("Title (the client sees this)").fill("Round one");
  await page.getByLabel("Message from you").fill("Hi Sam, two directions for the banner and a teaser.\n\nOption B is bolder.");
  await page.getByLabel("Notes (one per line)").fill("Fonts are placeholders\nMusic is a temp track");
  await page.getByRole("button", { name: "Create review link" }).click();
  await expect(page).toHaveURL(/\/studio\/shares\//);
  await page.getByRole("button", { name: "Show link and passcode" }).click();
  link = await page.getByLabel("Review link").inputValue();
  passcode = (await page.getByLabel("Passcode", { exact: true }).inputValue()).replace(/\s/g, "");
  expect(link).toMatch(/\/review\/[\w-]{20,}$/);
  expect(passcode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  await expect(page.getByLabel("Message to send")).toContainText("Passcode:");
});

test("3. a guest is stopped by the gate, then gets in and says who they are", async ({ browser }) => {
  guest = await newGuest(browser);
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: "Round one" })).toBeVisible();

  await guest.getByLabel("Passcode").fill("ZZZZZ2");
  await guest.getByRole("button", { name: "Open the review" }).click();
  await expect(guest.locator("#passcode-error")).toContainText("isn't right");

  const axeGate = await new AxeBuilder({ page: guest }).analyze();
  expect(axeGate.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  await guest.getByLabel("Passcode").fill(passcode);
  await guest.getByRole("button", { name: "Open the review" }).click();
  await expect(guest.getByRole("heading", { name: /Who.s reviewing/ })).toBeVisible();
  await guest.getByLabel("Your name").fill("Sam Lee");
  await guest.getByLabel("Your email").fill(`sam-${stamp}@example.com`);
  await guest.getByRole("button", { name: "Continue" }).click();

  // The room: the message, the options, the image.
  await expect(guest.getByText("A message from")).toBeVisible();
  await expect(guest.getByText("Fonts are placeholders")).toBeVisible();
  await expect(guest.getByRole("tab", { name: "Option B: bold" })).toBeVisible();
  await expect(guest.getByRole("combobox", { name: "Asset" })).toBeVisible();
  await expect(guest.locator("img[alt*='version 1']").first()).toBeVisible();

  // The session survives a reload: no gate.
  await guest.reload();
  await expect(guest.getByText("A message from")).toBeVisible();

  const axeRoom = await new AxeBuilder({ page: guest }).analyze();
  expect(axeRoom.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("4. the guest pins a spot, draws a box, and replies in a thread", async () => {
  await guest.getByRole("combobox", { name: "Asset" }).selectOption({ label: "Instagram banner" });
  await expect(guest.locator("img[alt*='Instagram banner']").first()).toBeVisible();

  // A pin: click Comment (or press C), then click the picture.
  await guest.getByRole("button", { name: /^Comment/ }).first().click();
  const layer = guest.getByTestId("capture-layer");
  await layer.click({ position: { x: 120, y: 90 } });
  await expect(guest.getByRole("button", { name: "Remove the pin and time" }).locator("..")).toContainText("Pin");
  await guest.getByLabel("Add a comment").fill("The logo is too small here");
  await guest.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(guest.getByRole("article", { name: "Comment 1" })).toContainText("The logo is too small here");
  await expect(guest.getByRole("button", { name: "Comment 1", exact: true })).toBeVisible();

  // A box: press C, drag.
  await guest.keyboard.press("c");
  const box = (await layer.boundingBox())!;
  await guest.mouse.move(box.x + 200, box.y + 150);
  await guest.mouse.down();
  await guest.mouse.move(box.x + 320, box.y + 240, { steps: 6 });
  await guest.mouse.up();
  await expect(guest.getByRole("button", { name: "Remove the pin and time" }).locator("..")).toContainText("Box");
  await guest.getByLabel("Add a comment").fill("This whole area needs more breathing room");
  await guest.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(guest.getByRole("article", { name: "Comment 2" })).toBeVisible();

  // A reply on the first thread.
  const thread1 = guest.getByRole("article", { name: "Comment 1" });
  await thread1.getByRole("button", { name: "Reply", exact: true }).click();
  await thread1.getByLabel("Write a reply").fill("Maybe twice the size?");
  await thread1.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(thread1).toContainText("Maybe twice the size?");

  // Filters count.
  await expect(guest.getByRole("tab", { name: /All 2/ })).toBeVisible();
  await expect(guest.getByRole("tab", { name: /Open 2/ })).toBeVisible();
  await thread1.getByRole("button", { name: "Resolve" }).click();
  await expect(guest.getByRole("tab", { name: /Resolved 1/ })).toBeVisible();
  await guest.getByRole("tab", { name: /Open/ }).click();
  await expect(guest.getByRole("article", { name: "Comment 1" })).toHaveCount(0);
  await guest.getByRole("tab", { name: /All/ }).click();
  await thread1.getByRole("button", { name: "Reopen" }).click();
});

test("5. the owner answers on the asset page, the guest sees it and quotes the answer", async ({ page }) => {
  await page.goto(imageAssetUrl);
  const thread = page.getByRole("article", { name: "Comment 1" });
  await expect(thread).toContainText("The logo is too small here");
  await expect(thread).toContainText("Sam Lee");
  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await thread.getByLabel("Write a reply").fill("Good catch, doubling it for v2");
  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(thread).toContainText("Good catch, doubling it for v2");

  // Internal notes stay with the studio.
  await page.getByLabel("Add a comment").fill("Client always asks for the logo bigger");
  await page.getByLabel(/Internal/).check();
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByRole("article", { name: "Comment 3" })).toContainText("Internal");

  await guest.reload();
  const t1 = guest.getByRole("article", { name: "Comment 1" });
  await expect(t1).toContainText("Good catch, doubling it for v2");
  await expect(t1.getByText("Studio", { exact: true })).toBeVisible();
  await expect(guest.getByText("Client always asks for the logo bigger")).toHaveCount(0);

  // Quote the studio's answer, not the guest's own earlier reply.
  const studioReply = t1.locator("div.border-l-2.pl-3", { hasText: "Good catch, doubling it for v2" });
  await studioReply.getByRole("button", { name: "Reply to this" }).click();
  await t1.getByLabel("Write a reply").fill("Thanks, that works");
  await t1.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(t1).toContainText("Thanks, that works");
  await expect(t1.locator("blockquote").first()).toContainText("Good catch");
});

test("6. a comment on a video is pinned to a frame, and clicking it goes back to that moment", async () => {
  await guest.getByRole("combobox", { name: "Asset" }).selectOption({ label: "Launch teaser" });
  const video = guest.locator("video");
  await expect(video).toBeVisible();
  await guest.waitForFunction(() => ((document.querySelector("video") as HTMLVideoElement | null)?.readyState ?? 0) >= 1, null, { timeout: 30_000 });

  // Step to frame 45 (1.5 s) with the keyboard, then comment: placing a pin records the moment.
  await guest.evaluate(() => {
    const v = document.querySelector("video") as HTMLVideoElement;
    v.pause();
    v.currentTime = 1.5;
  });
  await guest.keyboard.press(".");
  await guest.getByRole("button", { name: /^Comment/ }).first().click();
  await guest.getByTestId("capture-layer").click({ position: { x: 100, y: 80 } });
  await expect(guest.getByText(/Pin at 0:01/)).toBeVisible();
  await guest.getByLabel("Add a comment").fill("The logo flashes in too early");
  await guest.getByRole("button", { name: "Comment", exact: true }).click();
  const thread = guest.getByRole("article", { name: "Comment 1" });
  await expect(thread).toContainText("The logo flashes in too early");
  await expect(thread.getByRole("button", { name: /Pin at 0:01/ })).toBeVisible();

  // Move away, then click the comment: the video seeks back.
  await guest.evaluate(() => ((document.querySelector("video") as HTMLVideoElement).currentTime = 3));
  await thread.getByRole("button", { name: /Pin at 0:01/ }).click();
  await expect.poll(() => guest.evaluate(() => (document.querySelector("video") as HTMLVideoElement).currentTime)).toBeGreaterThan(1.4);
  await expect.poll(() => guest.evaluate(() => (document.querySelector("video") as HTMLVideoElement).currentTime)).toBeLessThan(1.8);
  await expect(guest.getByRole("button", { name: "Comment 1 by Sam Lee" })).toBeVisible();
});

test("7. the guest can't download the original yet, and asks for changes, which uses a round", async ({ page }) => {
  await guest.getByRole("combobox", { name: "Asset" }).selectOption({ label: "Instagram banner" });
  await expect(guest.getByText("Clean download unlocks when you approve.")).toBeVisible();
  const fileLinks = await guest.locator("img[alt*='version 1']").first().getAttribute("src");
  expect(fileLinks).toContain("r=preview");
  const original = (fileLinks ?? "").replace("r=preview", "r=original");
  expect((await guest.request.get(original)).status()).toBe(403);

  await guest.getByRole("button", { name: "Request changes" }).click();
  await guest.getByLabel(/Anything else/).fill("Please fix the logo and spacing");
  await guest.getByRole("button", { name: "Send to the studio" }).click();
  await expect(guest.getByText("Sent to the studio.")).toBeVisible();
  await expect(guest.getByText("Changes requested").first()).toBeVisible();

  await page.goto(projectUrl);
  await expect(page.getByText("Round 2 of 2").first()).toBeVisible();
});

test("8. the owner uploads v2, the guest compares v1 with v2 and approves with a sign-off", async ({ page }) => {
  await page.goto(`${imageAssetUrl}`);
  await upload(page, "banner-a2.png", "image/png", png2, "Logo doubled, more space", 2);
  await expect(page.getByAltText(/Instagram banner, Main, version 2/)).toBeVisible({ timeout: 60_000 });

  // Opening the plain link lands on the newest version (a reload would keep the ?v= of the one last viewed).
  await guest.goto(link);
  await expect(guest.getByText("What changed in v2:")).toBeVisible();
  await expect(guest.getByText("Logo doubled, more space")).toBeVisible();
  await expect(guest.getByRole("combobox", { name: "Version" })).toHaveValue(/.+/);

  await guest.getByRole("link", { name: "Compare versions" }).click();
  await expect(guest).toHaveURL(/\/compare\?/);
  await expect(guest.getByRole("heading", { name: /Compare · Instagram banner/ })).toBeVisible();
  await expect(guest.locator("img[alt^='Main']").first()).toBeVisible();
  await guest.getByRole("tab", { name: "Slider" }).click();
  await expect(guest.getByLabel("Compare slider")).toBeAttached();
  await guest.getByRole("link", { name: /Back to the review/ }).click();

  await guest.getByRole("button", { name: /Approve v2/ }).click();
  const dialog = guest.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Confirm approval" })).toBeDisabled();
  await dialog.getByLabel("Type your full name").fill("Samantha Lee");
  await dialog.getByLabel(/I approve this version/).check();
  await dialog.getByRole("button", { name: "Confirm approval" }).click();
  await expect(guest.getByText("Approved. Thank you.")).toBeVisible();
  await expect(guest.getByRole("link", { name: "Download final file" }).first()).toBeVisible();

  const href = (await guest.getByRole("link", { name: "Download final file" }).first().getAttribute("href"))!;
  const res = await guest.request.get(href);
  expect(res.status()).toBe(200);
  expect(Buffer.compare(await res.body(), png2)).toBe(0);

  // The sign-off is on record.
  const rows = await sql<{ signed_name: string; file_sha256: string; ip: string | null }>(
    "select d.signed_name, d.file_sha256, d.ip from studio_decisions d join studio_versions v on v.id = d.version_id join studio_variations va on va.id = v.variation_id join studio_assets a on a.id = va.asset_id join studio_projects p on p.id = a.project_id join studio_clients c on c.id = p.client_id where c.name = $1 and d.decision = 'approved'",
    [CLIENT],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.signed_name).toBe("Samantha Lee");
  expect(rows[0]!.file_sha256).toMatch(/^[0-9a-f]{64}$/);

  // The studio can print it.
  await page.goto(imageAssetUrl);
  await page.getByRole("link", { name: "Sign-off record" }).click();
  await expect(page.getByRole("heading", { name: "Approval certificate" })).toBeVisible();
  await expect(page.getByText("Samantha Lee").first()).toBeVisible();
  await expect(page.getByText(rows[0]!.file_sha256)).toBeVisible();
});

test("9. a file Tamtree can't read says why, with Retry, and the storage meter counts what is stored", async ({ page }) => {
  await page.goto(projectUrl);
  await page.getByRole("button", { name: "New asset" }).click();
  await page.getByLabel("Title").fill("Broken clip");
  await page.getByLabel(/Video/).check();
  await page.getByRole("button", { name: "Add asset" }).click();
  await expect(page).toHaveURL(/\/studio\/assets\//);
  await upload(page, "broken.mp4", "video/mp4", Buffer.from("this is not a video at all"), "Oops", 1);
  await expect(page.getByText("Tamtree couldn’t prepare this file")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/couldn't be read|no video/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Tamtree couldn’t prepare this file")).toBeVisible({ timeout: 60_000 });

  await expect(page.getByTestId("storage-meter")).toContainText(/ of 900(\.0)? MB/);
  await expect(page.getByTestId("storage-meter")).not.toHaveText(/^0 B/);
});

test("10. Tamtree's API is closed without its token", async ({ request }) => {
  expect((await request.get("/api/tamtree/pending")).status()).toBe(401);
  expect((await request.get("/api/tamtree/pending", { headers: { authorization: "Bearer e2e-tamtree-token" } })).status()).toBe(200);
});

test("11. ending the link locks the guest out, with a branded page", async ({ page }) => {
  await page.goto(projectUrl);
  await page.getByRole("link", { name: "Round one" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "End link" }).click();
  await expect(page.getByText("Ended").first()).toBeVisible();

  await guest.reload();
  await expect(guest.getByRole("heading", { name: "This link has ended" })).toBeVisible();
  await expect(guest.getByText(/Contact .* if you need it opened again/)).toBeVisible();
  // The file route is closed to the old session too.
  expect((await guest.request.get(link + "/file/00000000-0000-0000-0000-000000000000?r=preview")).status()).toBe(401);
});

test("12. the page doesn't scroll sideways on a phone", async ({ browser, page }) => {
  // Reopen the link first (the studio did end it above).
  await page.goto(projectUrl);
  await page.getByRole("link", { name: "Round one" }).click();
  await page.getByRole("button", { name: "Reopen link" }).click();
  await page.getByRole("button", { name: "Show link and passcode" }).click();
  const url = await page.getByLabel("Review link").inputValue();
  const code = (await page.getByLabel("Passcode", { exact: true }).inputValue()).replace(/\s/g, "");

  const ctx = await browser.newContext({ baseURL: "http://localhost:3200", viewport: { width: 390, height: 844 }, hasTouch: true, storageState: { cookies: [], origins: [] } });
  const phone = await ctx.newPage();
  await phone.goto(url);
  await phone.getByLabel("Passcode").fill(code);
  await phone.getByRole("button", { name: "Open the review" }).click();
  await phone.getByLabel("Your name").fill("Phone Tester");
  await phone.getByLabel("Your email").fill(`phone-${stamp}@example.com`);
  await phone.getByRole("button", { name: "Continue" }).click();
  // On a phone the work fills the screen; the message and comments live in the panel sheet.
  await expect(phone.getByRole("button", { name: /^Comments/ }).first()).toBeVisible();
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // The rail is a sheet on a phone.
  await expect(phone.getByRole("complementary", { name: "Comments" })).toBeHidden();
  await phone.getByRole("button", { name: /^Comments/ }).first().click();
  await expect(phone.getByRole("complementary", { name: "Comments" })).toBeVisible();
  await expect(phone.getByText("A message from")).toBeVisible();
});
