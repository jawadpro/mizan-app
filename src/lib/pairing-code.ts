/** Pairing codes: 8 characters people type from a screen. Pure, so tests and both sides can use it. */
import crypto from "node:crypto";

// No 0/O, 1/I/L or U, which are easy to misread.
export const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LEN = 8; // 30^8 ≈ 6.6e11 combinations, valid for 10 minutes, once, behind rate limits.

export function randomCode(): string {
  let out = "";
  while (out.length < CODE_LEN) {
    // Rejection sampling (240 = 8 × 30) keeps every character equally likely.
    for (const x of crypto.randomBytes(16)) {
      if (x < 240 && out.length < CODE_LEN) out += ALPHABET[x % 30];
    }
  }
  return out;
}

/** Accepts "abcd-2345", "ABCD 2345" or the Shortcut's "mizan-pair:<server>#ABCD2345" and returns the bare code, or null. */
export function normalizeCode(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/^.*[:#/]/, "").replace(/[\s-]/g, "");
  return s.length === CODE_LEN && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
