import { describe, expect, it } from "vitest";
import { ALPHABET, CODE_LEN, formatCode, normalizeCode, randomCode } from "@/lib/pairing-code";
import { importFinished, smsInput } from "@/lib/validation";

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

describe("import run ids from the Shortcut", () => {
  const id = "4180667f-c0c9-4ab2-822f-7a5627622451";
  const alert = { sender: "MYBANK", text: "PKR 1.00 debited", receivedAt: "2026-11-13T18:35:00+05:00" };
  it("accept the Shortcut's input as it arrives, or the bare id", () => {
    expect(smsInput.parse({ ...alert, importRun: `mizan-import:${id}` }).importRun).toBe(id);
    expect(smsInput.parse({ ...alert, importRun: id }).importRun).toBe(id);
    expect(importFinished.parse({ importRun: `mizan-import:${id}`, finished: true }).importRun).toBe(id);
  });
  it("reject anything else", () => {
    expect(smsInput.safeParse({ ...alert, importRun: "mizan-import:nope" }).success).toBe(false);
    expect(importFinished.safeParse({ importRun: id, finished: "true" }).success).toBe(false);
  });
});
