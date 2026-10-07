import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { chromium } from "@playwright/test";

import { E2E_OWNER, E2E_PORT } from "../playwright.config";

/** Signs the owner in through the real sign-in page and keeps the cookie for every spec. */
export const OWNER_STATE = "e2e/.auth/owner.json";

export default async function globalSetup() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: `http://localhost:${E2E_PORT}` });
    await page.goto("/studio");
    await page.waitForURL(/\/sign-in/);
    await page.getByLabel("Email").fill(E2E_OWNER.email);
    await page.getByLabel("Password").fill(E2E_OWNER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/studio$/);
    mkdirSync(dirname(OWNER_STATE), { recursive: true });
    await page.context().storageState({ path: OWNER_STATE });
  } finally {
    await browser.close();
  }
}
