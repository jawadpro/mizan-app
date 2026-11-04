import { describe, expect, it } from "vitest";
import { change } from "@/lib/delta";

describe("period change badge", () => {
  it("treats more spending as bad and more income as good", () => {
    expect(change(113, 100, false)).toMatchObject({ text: "+13%", tone: "bad", dir: 1 });
    expect(change(113, 100, true)).toMatchObject({ text: "+13%", tone: "good", dir: 1 });
    expect(change(83, 100, true)).toMatchObject({ text: "−17%", tone: "bad", dir: -1 });
  });
  it("keeps one decimal for small changes", () => {
    expect(change(1043, 1000, true).text).toBe("+4.3%");
  });
  it("handles empty periods", () => {
    expect(change(0, 0, true)).toMatchObject({ text: "0%", tone: "flat" });
    expect(change(50, 0, true)).toMatchObject({ text: "New", tone: "flat" });
  });
  it("compares against a negative net flow by its size", () => {
    expect(change(-50, -100, true)).toMatchObject({ text: "+50%", tone: "good" });
  });
});
