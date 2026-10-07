import { describe, expect, it } from "vitest";

import { displayPasscode, newPasscode, normalisePasscode, PASSCODE_ALPHABET, PASSCODE_LENGTH, passcodeMatches } from "./passcode";

describe("passcode", () => {
  it("has no look-alike characters", () => {
    for (const bad of ["0", "O", "1", "I", "L"]) expect(PASSCODE_ALPHABET).not.toContain(bad);
    expect(new Set(PASSCODE_ALPHABET).size).toBe(PASSCODE_ALPHABET.length);
  });

  it("makes 6 characters, only from the alphabet, and a different one each time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = newPasscode();
      expect(code).toHaveLength(PASSCODE_LENGTH);
      expect([...code].every((c) => PASSCODE_ALPHABET.includes(c))).toBe(true);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(190);
  });

  it("accepts what a person types: any case, spaces, a dash", () => {
    expect(normalisePasscode(" abc-d ef ")).toBe("ABCDEF");
    expect(passcodeMatches("abc def", "ABCDEF")).toBe(true);
    expect(passcodeMatches("abc-def", "ABCDEF")).toBe(true);
  });

  it("rejects a wrong, short, long or empty code without throwing on the length difference", () => {
    expect(passcodeMatches("ABCDEG", "ABCDEF")).toBe(false);
    expect(passcodeMatches("ABC", "ABCDEF")).toBe(false);
    expect(passcodeMatches("ABCDEFG", "ABCDEF")).toBe(false);
    expect(passcodeMatches("", "ABCDEF")).toBe(false);
  });

  it("shows it in two halves for reading aloud", () => {
    expect(displayPasscode("ABCDEF")).toBe("ABC DEF");
  });
});
