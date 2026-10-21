import { describe, expect, it } from "vitest";
import { DUA } from "../src/lib/dua";

describe("dua for provision", () => {
  it("has the IndoPak Arabic of Al-Qasas 28:24 with Urdu and English", () => {
    expect(DUA.ref).toBe("28:24");
    expect(DUA.arabic.split(" ")).toHaveLength(8);
    expect(DUA.arabic.startsWith("\u0631")).toBe(true);
    expect(DUA.arabic).not.toMatch(/[​-‏]/);
    expect(DUA.urdu).toMatch(/[؀-ۿ]/);
    expect(DUA.english).toContain("My Lord");
    expect(DUA.source).toBe("Fateh Muhammad Jalandhry");
  });
});
