/** Share passcodes: 6 characters from an alphabet with no look-alikes (no 0 O 1 I L), checked in constant time. */
import { randomInt, timingSafeEqual } from "node:crypto";

export const PASSCODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PASSCODE_LENGTH = 6;

export function newPasscode(): string {
  let out = "";
  for (let i = 0; i < PASSCODE_LENGTH; i++) out += PASSCODE_ALPHABET[randomInt(PASSCODE_ALPHABET.length)];
  return out;
}

/** What a person typed, made comparable: upper case, spaces and dashes dropped ("abc-def" → "ABCDEF"). */
export function normalisePasscode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "");
}

export function passcodeMatches(typed: string, actual: string): boolean {
  const a = Buffer.from(normalisePasscode(typed));
  const b = Buffer.from(normalisePasscode(actual));
  // timingSafeEqual needs equal lengths; a wrong length is a mismatch that leaks only the length.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "ABC DEF" for reading aloud or pasting into a message. */
export function displayPasscode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
