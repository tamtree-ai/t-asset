import { defineConfig } from "@playwright/test";

/**
 * The Studio Review journey against a dev server on 3200 with the local blob driver, and the fake
 * Tamtree (scripts/fake-tamtree.ts) doing the processing over the real HTTP contract. Needs
 * Postgres up and migrated (`pnpm db:up && pnpm db:migrate`) and ffmpeg on PATH.
 */
export const E2E_PORT = 3200;
export const E2E_OWNER = { email: "e2e-owner@example.com", password: "e2e owner password" };

const env = {
  APP_URL: `http://localhost:${E2E_PORT}`,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://tasset:tasset@localhost:5434/tasset",
  STUDIO_SECRET: "a7f15d32402f58bec43299813ba93162faaa2810f3162027707529a88300af0d",
  BLOB_DRIVER: "local",
  BLOB_LOCAL_DIR: ".blob-data-e2e",
  OWNER_EMAIL: E2E_OWNER.email,
  // pnpm hash-password, for E2E_OWNER.password.
  OWNER_PASSWORD_HASH: "scrypt:32768:8:1:AUmag9QpflLxwRh4xBXcaw:wlVxwJNp3fU54ORDfwOIY3KXjnkqwHuTEDacPWlT8e0",
  STUDIO_NAME: "E2E Studio",
  TAMTREE_API_TOKEN: "e2e-tamtree-token",
  FAKE_TAMTREE_POLL_MS: "1000",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${E2E_PORT}`, trace: "retain-on-failure", storageState: "e2e/.auth/owner.json" },
  webServer: [
    {
      command: `TASSET_DIST_DIR=.next-e2e pnpm exec next dev -p ${E2E_PORT}`,
      url: `http://localhost:${E2E_PORT}/api/health`,
      reuseExistingServer: false,
      env,
      timeout: 120_000,
    },
    {
      command: "pnpm exec tsx scripts/fake-tamtree.ts",
      wait: { stdout: /\[fake-tamtree\] up/ },
      reuseExistingServer: false,
      env,
    },
  ],
});
