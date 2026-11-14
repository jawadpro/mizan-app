import { describe, expect, it } from "vitest";
import { leftLine, widgetStatus, widgetTx, widgetView, type WidgetSourceRow } from "@/lib/widget";
import { WIDGET_SCRIPT_NAME, pairPayload, scriptableRunUrl, shortcutRunUrl } from "@/lib/shortcut-link";

const row = (o: Partial<WidgetSourceRow>): WidgetSourceRow => ({
  id: "i", name: "Rent", amount_paisa: 8500000, category: "Housing", payee: null, due_day: 5, paid: 0, state: null, txs: [], suggestion: null, ...o,
});
const tx = { id: "t1", amount_paisa: 2500000, occurred_at: "2026-11-03T19:30:00Z", category: "Bills", counterparty: "K-Electric", note: null };

describe("widget status", () => {
  it("matches the Monthly payments page", () => {
    expect(widgetStatus(row({ due_day: 20 }), "2026-11", "2026-11-14", "PKR")).toEqual({ text: "Due 20 Nov", tone: "open" });
    expect(widgetStatus(row({ due_day: 16 }), "2026-11", "2026-11-14", "PKR")).toEqual({ text: "Due in 2 days", tone: "soon" });
    expect(widgetStatus(row({ due_day: 14 }), "2026-11", "2026-11-14", "PKR").text).toBe("Due today");
    expect(widgetStatus(row({ due_day: 5 }), "2026-11", "2026-11-14", "PKR")).toEqual({ text: "9 days late", tone: "late" });
    expect(widgetStatus(row({ state: "paid" }), "2026-11", "2026-11-14", "PKR").tone).toBe("paid");
    expect(widgetStatus(row({ state: "partial", paid: 4000000 }), "2026-11", "2026-11-14", "PKR").text).toBe("Rs 40,000 of Rs 85,000 paid");
    expect(widgetStatus(row({}), "2026-10", "2026-11-14", "PKR")).toEqual({ text: "Not paid", tone: "late" });
  });
});

describe("widget transactions", () => {
  it("read as amount, Karachi date and payee", () => {
    // 19:30 UTC on the 3rd is already the 4th in Karachi.
    expect(widgetTx(tx, "PKR")).toMatchObject({ id: "t1", amount: "Rs 25,000", date: "2026-11-04", text: "Rs 25,000 · 4 Nov · K-Electric" });
    expect(widgetTx({ ...tx, counterparty: null, note: null }, "USD").title).toBe("Bills");
  });
});

describe("widget view", () => {
  const v = widgetView({
    month: "2026-11",
    items: [
      row({ id: "a", name: "Rent", state: "paid", paid: 8500000 }),
      row({ id: "b", name: "Electricity", amount_paisa: null, due_day: 10, suggestion: { ...tx, score: 80 } }),
      row({ id: "c", name: "School", amount_paisa: 3000000, due_day: 20, state: "partial", paid: 1000000 }),
      row({ id: "d", name: "Gym", state: "skipped" }),
    ],
  }, "2026-11-14", "PKR", "https://mizan.example.com");
  it("puts what's still to pay first", () => {
    expect(v.items.map((i) => i.id)).toEqual(["b", "c", "a", "d"]);
  });
  it("sums up the month", () => {
    expect(v.summary).toEqual({ paid: 1, due: 3, open: 2, late: 1, left: "Rs 20,000", unknownLeft: 1, leftText: "Rs 20,000 left + 1 bill" });
    expect(v.monthText).toBe("November 2026");
    expect(v.monthShort).toBe("Nov");
    expect(v.appUrl).toBe("https://mizan.example.com/app/monthly");
  });
  it("carries the suggested transaction and what's left on a part-paid one", () => {
    expect(v.items[0].suggestion?.id).toBe("t1");
    expect(v.items[1].left).toBe("Rs 20,000");
    expect(v.items[1].state).toBe("partial");
  });
});

describe("what's left", () => {
  it("never says Rs 0 left", () => {
    expect(leftLine(4, 0, 4, "PKR")).toBe("4 to pay");
    expect(leftLine(1, 450000, 0, "PKR")).toBe("Rs 4,500 left");
    expect(leftLine(3, 450000, 2, "PKR")).toBe("Rs 4,500 left + 2 bills");
    expect(leftLine(0, 0, 0, "PKR")).toBe("");
  });
  it("a bill with no due day just says To pay", () => {
    expect(widgetStatus(row({ due_day: null, amount_paisa: null }), "2026-11", "2026-11-14", "PKR").text).toBe("To pay");
  });
});

describe("Scriptable links", () => {
  it("open the widget script with the pairing link", () => {
    expect(scriptableRunUrl(WIDGET_SCRIPT_NAME, { pair: pairPayload("https://m.example.com", "ABCD2345") }))
      .toBe("scriptable:///run/Mizan%20Payments?pair=https%3A%2F%2Fm.example.com%2Fapi%2Fdevices%2Fpair%3Fcode%3DABCD2345");
    expect(scriptableRunUrl("Mizan Payments")).toBe("scriptable:///run/Mizan%20Payments");
  });
});

describe("Shortcut links back to the widget", () => {
  it("add x-success and x-error", () => {
    const url = shortcutRunUrl("Mizan", "mizan-import:abc", { success: "scriptable:///run/Mizan%20Queue?done=abc" });
    expect(url).toBe("shortcuts://x-callback-url/run-shortcut?name=Mizan&input=text&text=mizan-import%3Aabc&x-success=scriptable%3A%2F%2F%2Frun%2FMizan%2520Queue%3Fdone%3Dabc");
    expect(shortcutRunUrl("Mizan", "x")).not.toContain("x-success");
  });
});
