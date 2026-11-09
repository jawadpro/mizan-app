import { describe, expect, it } from "vitest";
import { groupCharges } from "../src/lib/nest";

const tx = (id: string, parent_id: string | null = null) => ({ id, parent_id });

describe("groupCharges", () => {
  it("puts a charge under its transfer, wherever it sat in the day", () => {
    const g = groupCharges([tx("charge", "transfer"), tx("other"), tx("transfer")]);
    expect(g.map((x) => [x.t.id, x.charges.map((c) => c.id)])).toEqual([["other", []], ["transfer", ["charge"]]]);
  });

  it("keeps a tax and a fee on the same transfer in order", () => {
    const g = groupCharges([tx("transfer"), tx("tax", "transfer"), tx("fee", "transfer")]);
    expect(g).toHaveLength(1);
    expect(g[0].charges.map((c) => c.id)).toEqual(["tax", "fee"]);
  });

  it("shows a charge on its own when its transfer isn't in the list", () => {
    const g = groupCharges([tx("charge", "missing"), tx("a")]);
    expect(g.map((x) => x.t.id)).toEqual(["charge", "a"]);
    expect(g.every((x) => x.charges.length === 0)).toBe(true);
  });

  it("leaves rows without a parent untouched", () => {
    const items = [tx("a"), tx("b"), { id: "c" }];
    expect(groupCharges(items).map((x) => x.t.id)).toEqual(["a", "b", "c"]);
  });
});
