import { describe, expect, it } from "vitest";
import { ALPHABET, CODE_LEN, formatCode, normalizeCode, randomCode } from "@/lib/pairing-code";

describe("pairing codes", () => {
  it("are 8 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const c = randomCode();
      expect(c).toHaveLength(CODE_LEN);
      expect([...c].every((ch) => ALPHABET.includes(ch))).toBe(true);
      expect(c).not.toMatch(/[01OILU]/);
    }
  });
  it("don't repeat in practice", () => {
    const seen = new Set(Array.from({ length: 2000 }, randomCode));
    expect(seen.size).toBe(2000);
  });
  it("accept the forms people and the Shortcut send", () => {
    expect(normalizeCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeCode(" ABCD 2345 ")).toBe("ABCD2345");
    expect(normalizeCode("mizan-pair:https://mizan.example.com#ABCD2345")).toBe("ABCD2345");
    expect(normalizeCode("https://mizan.example.com/pair#ABCD2345")).toBe("ABCD2345");
    expect(formatCode("ABCD2345")).toBe("ABCD-2345");
  });
  it("reject anything else", () => {
    for (const bad of ["", "ABCD234", "ABCD23456", "ABCD-234O", "ABCD-2341", "'; DROP TABLE x;--", "mzd_abc"]) {
      expect(normalizeCode(bad)).toBeNull();
    }
  });
});
