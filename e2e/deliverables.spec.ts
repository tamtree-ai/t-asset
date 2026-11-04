import { expect, test, type Browser, type Page } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";
import { Client } from "pg";
import sharp from "sharp";

/**
 * Logos, brand guides and paid delivery end to end (planning/2026-10-31-tasset-deliverables): the
 * owner's browser watermarks a logo concept and turns a brand guide into proofs; the real files sit
 * behind an `after_payment` link; the guest pins page 2, approves, waits on the invoice, and
 * downloads once the owner marks it paid.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

async function sql<T extends object = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: process.env.DATABASE_URL ?? "postgres://tasset:tasset@localhost:5434/tasset" });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

const stamp = Date.now().toString(36);
const CLIENT = `E2E Brand ${stamp}`;
const SVG = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#f60"/></svg>`;
let logo: Buffer;
let guide: Buffer;
let projectUrl = "";
let invoiceId = "";
let invoiceNo = "";
let link = "";
let passcode = "";
let guest: Page;

test.beforeAll(async () => {
  logo = await sharp({ create: { width: 1000, height: 1000, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><circle cx="500" cy="500" r="300" fill="#1f6feb"/></svg>') }])
    .png()
    .toBuffer();
  // Three A4 pages of shapes only (no text, so pdf.js needs no fonts).
  const doc = await PDFDocument.create();
  for (const [i, c] of [rgb(0.9, 0.3, 0.2), rgb(0.2, 0.6, 0.4), rgb(0.2, 0.3, 0.9)].entries()) {
    const p = doc.addPage([595, 842]);
    p.drawRectangle({ x: 60, y: 500 - i * 80, width: 300, height: 200, color: c });
  }
  guide = Buffer.from(await doc.save());
});

async function upload(page: Page, name: string, mimeType: string, buffer: Buffer, n: number) {
  await page.getByLabel("Choose a file").setInputFiles({ name, mimeType, buffer });
  await page.getByRole("button", { name: `Upload v${n}` }).click();
}

async function newGuest(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3200", storageState: { cookies: [], origins: [] } });
  return ctx.newPage();
}

test("1. the owner's browser watermarks a logo concept, and the real files are attached to it", async ({ page }) => {
  await page.goto("/studio");
  await page.getByRole("button", { name: "New client" }).click();
  await page.getByLabel("Client name").fill(CLIENT);
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Identity");
  await page.getByRole("button", { name: "Add project" }).click();
  await expect(page).toHaveURL(/\/studio\/projects\/[0-9a-f-]+/);
  projectUrl = page.url();

  await page.getByRole("button", { name: "New asset" }).click();
  await page.getByLabel("Title").fill("Logo");
  await page.getByRole("button", { name: "Add asset" }).click();
  await expect(page).toHaveURL(/\/studio\/assets\//);
  await upload(page, "logo-concept.png", "image/png", logo, 1);
  await expect(page.getByAltText(/Logo, Main, version 1/)).toBeVisible({ timeout: 60_000 });

  // Phase 0: the watermarked preview is its own file, not the original.
  const [f] = await sql<{ original_key: string; wm_preview_key: string; thumb_key: string }>(
    "select f.original_key, f.wm_preview_key, f.thumb_key from studio_files f join studio_versions v on v.file_id = f.id join studio_variations va on va.id = v.variation_id join studio_assets a on a.id = va.asset_id join studio_projects p on p.id = a.project_id join studio_clients c on c.id = p.client_id where c.name = $1",
    [CLIENT],
  );
  expect(f!.wm_preview_key).toMatch(/\/wm_preview\.(webp|png)$/);
  expect(f!.thumb_key).toMatch(/\/thumb\.(webp|png)$/);
  expect(f!.wm_preview_key).not.toBe(f!.original_key);

  // Phase 1: the vector files.
  await page.getByLabel("Add deliverable files").setInputFiles([
    { name: "primary-logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG) },
    { name: "logo.eps", mimeType: "", buffer: Buffer.from("%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n") },
  ]);
  await expect(page.getByLabel("Label for primary-logo.svg")).toHaveValue("primary-logo — SVG", { timeout: 30_000 });
  await expect(page.getByLabel("Label for logo.eps")).toBeVisible();
  // A file that isn't what it says is refused.
  await page.getByLabel("Add deliverable files").setInputFiles({ name: "fake.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<html><script>alert(1)</script>") });
  await expect(page.getByText(/doesn't look like a real SVG/)).toBeVisible();
});

test("2. a brand guide becomes a watermarked raster proof in the owner's browser", async ({ page }) => {
  await page.goto(projectUrl);
  await page.getByRole("button", { name: "New asset" }).click();
  await page.getByLabel("Title").fill("Brand guide");
  await page.getByLabel(/Brand guide \(PDF\)/).check();
  await page.getByRole("button", { name: "Add asset" }).click();
  await expect(page).toHaveURL(/\/studio\/assets\//);
  await upload(page, "brand-guide.pdf", "application/pdf", guide, 1);
  await expect(page.getByAltText(/Brand guide, Main, version 1, page 1/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/3 pages/)).toBeVisible();

  const [f] = await sql<{ page_count: number; wm_preview_key: string; preview_key: string }>(
    "select f.page_count, f.wm_preview_key, f.preview_key from studio_files f join studio_versions v on v.file_id = f.id join studio_variations va on va.id = v.variation_id join studio_assets a on a.id = va.asset_id join studio_projects p on p.id = a.project_id join studio_clients c on c.id = p.client_id where c.name = $1 and a.kind = 'document'",
    [CLIENT],
  );
  expect(f).toMatchObject({ page_count: 3 });
  expect(f!.wm_preview_key).toMatch(/wm_preview\.pdf$/);
  expect(f!.preview_key).toMatch(/\/preview\.pdf$/);
});

test("3. the owner makes a link that unlocks the files when the invoice is paid", async ({ page }) => {
  // A draft for the client, issued through the invoice page so it gets its number and snapshot.
  const [client] = await sql<{ id: string; org_id: string }>("select id, org_id from studio_clients where name = $1", [CLIENT]);
  const [row] = await sql<{ id: string }>(
    `insert into studio_invoices (org_id, client_id, status, issue_date, due_date, lines, total_cents)
     values ($1, $2, 'draft', '2026-10-31', '2026-11-30', '[{"description":"Identity","qty":1,"unitCents":250000}]', 250000) returning id`,
    [client!.org_id, client!.id],
  );
  invoiceId = row!.id;
  await page.goto(`/studio/invoices/${invoiceId}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByRole("button", { name: "Mark paid" })).toBeVisible();
  const [issued] = await sql<{ number: string }>("select number from studio_invoices where id = $1", [invoiceId]);
  invoiceNo = issued!.number;

  await page.goto(projectUrl);
  await page.getByRole("link", { name: "New review link" }).click();
  await page.getByLabel("Title (the client sees this)").fill("Identity: final round");
  await page.getByLabel("Downloads").selectOption("after_payment");
  const picker = page.getByLabel("Invoice that unlocks the files");
  await picker.selectOption((await picker.locator("option", { hasText: invoiceNo }).getAttribute("value"))!);
  await page.getByRole("button", { name: "Create review link" }).click();
  await expect(page).toHaveURL(/\/studio\/shares\//);
  await page.getByRole("button", { name: "Show link and passcode" }).click();
  link = await page.getByLabel("Review link").inputValue();
  passcode = (await page.getByLabel("Passcode", { exact: true }).inputValue()).replace(/\s/g, "");
});

test("4. the guest sees a watermarked logo and locked files, pins page 2 of the guide, and approves", async ({ browser }) => {
  guest = await newGuest(browser);
  await guest.goto(link);
  await guest.getByLabel("Passcode").fill(passcode);
  await guest.getByRole("button", { name: "Open the review" }).click();
  await guest.getByLabel("Your name").fill("Alex Brand");
  await guest.getByLabel("Your email").fill(`alex-${stamp}@example.com`);
  await guest.getByRole("button", { name: "Continue" }).click();

  await guest.getByRole("combobox", { name: "Asset" }).selectOption({ label: "Logo" });
  const img = guest.locator("img[alt*='Logo, Main, version 1']");
  await expect(img).toBeVisible();
  const preview = await guest.request.get((await img.getAttribute("src"))!);
  expect(preview.headers()["content-type"]).toMatch(/^image\/(webp|png)$/);
  expect(Buffer.compare(await preview.body(), logo)).not.toBe(0);

  const files = guest.getByRole("region", { name: "Files" });
  await expect(files).toContainText("primary-logo — SVG");
  await expect(files).toContainText(`Files unlock once approved and invoice ${invoiceNo} is paid.`);
  await expect(files.getByRole("link")).toHaveCount(0);
  const [svg] = await sql<{ file_id: string }>("select vf.file_id from studio_version_files vf join studio_files f on f.id = vf.file_id where f.original_name = 'primary-logo.svg' order by vf.created_at desc limit 1");
  expect((await guest.request.get(`${link}/deliverable/${svg!.file_id}`)).status()).toBe(403);

  // The guide: page 2, a pin there.
  await guest.getByRole("combobox", { name: "Asset" }).selectOption({ label: "Brand guide" });
  await expect(guest.getByAltText(/Brand guide, Main, version 1, page 1/)).toBeVisible({ timeout: 30_000 });
  await guest.getByRole("button", { name: "Next page" }).click();
  await expect(guest.getByAltText(/version 1, page 2/)).toBeVisible();
  await guest.getByRole("button", { name: /^Comment/ }).first().click();
  await guest.getByTestId("capture-layer").click({ position: { x: 80, y: 80 } });
  await guest.getByLabel("Add a comment").fill("Swap the green for the brand teal");
  await guest.getByRole("button", { name: "Comment", exact: true }).click();
  const thread = guest.getByRole("article", { name: "Comment 1" });
  await expect(thread).toContainText("Pin on page 2");
  await expect(guest.getByRole("button", { name: "Comment 1", exact: true })).toBeVisible();
  // Its pin stays on its page.
  await guest.getByRole("button", { name: "Previous page" }).click();
  await expect(guest.getByRole("button", { name: "Comment 1", exact: true })).toHaveCount(0);
  await thread.getByRole("button", { name: /Pin on page 2/ }).click();
  await expect(guest.getByAltText(/version 1, page 2/)).toBeVisible();

  await guest.getByRole("button", { name: /Approve v1/ }).click();
  const dialog = guest.getByRole("dialog");
  await dialog.getByLabel("Type your full name").fill("Alex Brand");
  await dialog.getByLabel(/I approve this version/).check();
  await dialog.getByRole("button", { name: "Confirm approval" }).click();
  await expect(guest.getByText("Approved. Thank you.")).toBeVisible();
  await expect(guest.getByText(`Files unlock when invoice ${invoiceNo} is paid.`).first()).toBeVisible();
  await expect(guest.getByRole("link", { name: "Download final file" })).toHaveCount(0);
});

test("5. once the owner marks the invoice paid, the files and the real PDF download", async ({ page }) => {
  await page.goto(`/studio/invoices/${invoiceId}`);
  await page.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.getByRole("button", { name: "Mark unpaid" })).toBeVisible();

  await guest.reload();
  await expect(guest.getByRole("link", { name: "Download final file" }).first()).toBeVisible();
  const href = (await guest.getByRole("link", { name: "Download final file" }).first().getAttribute("href"))!;
  const res = await guest.request.get(href);
  expect(res.status()).toBe(200);
  expect(Buffer.compare(await res.body(), guide)).toBe(0);

  // The logo wasn't approved, so its files stay locked; approve it and they come.
  await guest.getByRole("combobox", { name: "Asset" }).selectOption({ label: "Logo" });
  await guest.getByRole("button", { name: /Approve v1/ }).click();
  const dialog = guest.getByRole("dialog");
  await dialog.getByLabel("Type your full name").fill("Alex Brand");
  await dialog.getByLabel(/I approve this version/).check();
  await dialog.getByRole("button", { name: "Confirm approval" }).click();
  await expect(guest.getByText("Approved. Thank you.")).toBeVisible();
  const files = guest.getByRole("region", { name: "Files" });
  const svgLink = files.getByRole("link", { name: "Download primary-logo — SVG" });
  await expect(svgLink).toBeVisible();
  const got = await guest.request.get((await svgLink.getAttribute("href"))!);
  expect(got.status()).toBe(200);
  expect(await got.text()).toBe(SVG);
  expect(got.headers()["content-disposition"]).toMatch(/attachment/);

  // The studio sees who took what.
  const [events] = await sql<{ n: string }>("select count(*) as n from studio_events e join studio_projects p on p.id = e.project_id join studio_clients c on c.id = p.client_id where c.name = $1 and e.type = 'file.downloaded'", [CLIENT]);
  expect(Number(events!.n)).toBeGreaterThanOrEqual(2);
});
