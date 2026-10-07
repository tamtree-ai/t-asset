import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("verifies the right password and refuses a wrong one", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).toMatch(/^scrypt:32768:8:1:/);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("correct horse batterY", h)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password here")).not.toBe(await hashPassword("same password here"));
  });

  it("refuses a short password and a malformed hash", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/10 characters/);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt:1:2")).toBe(false);
    expect(await verifyPassword("x", "scrypt:2:8:1:abc:def")).toBe(false);
  });
});
