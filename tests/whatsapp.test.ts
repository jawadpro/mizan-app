import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { confirmReply, fitWhatsApp, formatPhone, linkCodeIn, matchPerson, parseWebhook, verifyMetaSignature } from "@/lib/whatsapp";
import { findRange, guessCategory, matchCategory, parseAmount, parseCommand, splitNames } from "@/lib/assistant-commands";
import { CATEGORIES } from "@/lib/categories";

const TODAY = "2026-11-16"; // a Monday
const cats = CATEGORIES.expense;

describe("Meta webhook signature", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const sig = (secret: string, b = body) => `sha256=${crypto.createHmac("sha256", secret).update(b).digest("hex")}`;
  it("accepts a body signed with the app secret", () => {
    expect(verifyMetaSignature(body, sig("s3cret"), "s3cret")).toBe(true);
    expect(verifyMetaSignature(Buffer.from(body), sig("s3cret"), "s3cret")).toBe(true);
  });
  it("refuses a wrong secret, a changed body or a missing header", () => {
    expect(verifyMetaSignature(body, sig("other"), "s3cret")).toBe(false);
    expect(verifyMetaSignature(`${body} `, sig("s3cret"), "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, null, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, sig(""), "")).toBe(false);
  });
});

describe("reading Meta's webhook", () => {
  const hook = (messages: unknown[], extra: Record<string, unknown> = {}) => ({
    object: "whatsapp_business_account",
    entry: [{ id: "1", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { phone_number_id: "1065" },
      contacts: [{ wa_id: "923001234567", profile: { name: "Jawad" } }], messages, ...extra,
    } }] }],
  });
  it("reads text messages with the sender and their profile name", () => {
    const m = parseWebhook(hook([{ from: "923001234567", id: "wamid.A", timestamp: "1", type: "text", text: { body: "food this month" } }]));
    expect(m).toEqual([{ id: "wamid.A", from: "923001234567", profileName: "Jawad", text: "food this month", type: "text", phoneNumberId: "1065" }]);
  });
  it("keeps photos as messages without text, and reads button replies", () => {
    const m = parseWebhook(hook([
      { from: "923001234567", id: "wamid.B", type: "image", image: { id: "x" } },
      { from: "923001234567", id: "wamid.C", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "y", title: "Yes" } } },
    ]));
    expect(m.map((x) => [x.type, x.text])).toEqual([["image", null], ["interactive", "Yes"]]);
  });
  it("ignores delivery receipts, other objects and junk", () => {
    expect(parseWebhook(hook([], { statuses: [{ id: "wamid.A", status: "read" }] }))).toEqual([]);
    expect(parseWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook(hook([{ from: "abc", id: "x", type: "text", text: { body: "hi" } }]))).toEqual([]);
  });
});

describe("linking codes", () => {
  it("finds a code sent alone or after 'link'", () => {
    expect(linkCodeIn("link ABCD-2345")).toBe("ABCD2345");
    expect(linkCodeIn("Link abcd 2345")).toBe("ABCD2345");
    expect(linkCodeIn("ABCD2345")).toBe("ABCD2345");
    expect(linkCodeIn("link: abcd-2345")).toBe("ABCD2345");
  });
  it("never treats normal chat as a code", () => {
    expect(linkCodeIn("food this month")).toBeNull();
    expect(linkCodeIn("link")).toBeNull();
    expect(linkCodeIn("ABCD-1234")).toBeNull(); // 1 isn't in the code alphabet
  });
});

describe("YES / NO replies", () => {
  it("understands English, Roman Urdu and emoji", () => {
    for (const y of ["yes", "Yes!", "ok", "haan", "ji", "👍", "go ahead", "Theek hai"]) expect(confirmReply(y)).toBe("yes");
    for (const n of ["no", "Cancel", "nahi", "❌", "don't"]) expect(confirmReply(n)).toBe("no");
  });
  it("leaves anything else alone", () => {
    expect(confirmReply("yes split it with Sara too")).toBeNull();
    expect(confirmReply("how much on food")).toBeNull();
  });
});

describe("matching a name to past splits", () => {
  const known = ["Ali Raza", "Sara Khan", "Bilal", "Ali Hassan"];
  it("uses the exact name, or the one person a first name points to", () => {
    expect(matchPerson("sara khan", known)).toEqual({ kind: "known", name: "Sara Khan" });
    expect(matchPerson("sara", known)).toEqual({ kind: "known", name: "Sara Khan" });
    expect(matchPerson("bil", known)).toEqual({ kind: "known", name: "Bilal" });
    expect(matchPerson("ali r", known)).toEqual({ kind: "known", name: "Ali Raza" });
  });
  it("asks when a name fits two people", () => {
    expect(matchPerson("ali", known)).toEqual({ kind: "ambiguous", name: "ali", options: ["Ali Raza", "Ali Hassan"] });
  });
  it("saves somebody new as typed, tidied", () => {
    expect(matchPerson("hamza", known)).toEqual({ kind: "new", name: "Hamza" });
    expect(matchPerson("  Zain  Ul Abideen ", known)).toEqual({ kind: "new", name: "Zain Ul Abideen" });
    expect(matchPerson("raza", known)).toEqual({ kind: "new", name: "Raza" });
  });
});

describe("periods", () => {
  it("reads the common ones", () => {
    expect(findRange("food this month", TODAY).range).toEqual({ from: "2026-11-01", to: TODAY, label: "this month" });
    expect(findRange("spent last month", TODAY).range).toEqual({ from: "2026-10-01", to: "2026-10-31", label: "last month" });
    expect(findRange("today", TODAY).range?.from).toBe(TODAY);
    expect(findRange("yesterday", TODAY).range?.from).toBe("2026-11-15");
    expect(findRange("last 30 days", TODAY).range).toEqual({ from: "2026-10-18", to: TODAY, label: "the last 30 days" });
    expect(findRange("this week", TODAY).range?.from).toBe("2026-11-16");
    expect(findRange("last week", TODAY).range).toEqual({ from: "2026-11-09", to: "2026-11-15", label: "last week" });
  });
  it("reads a month by name, last year's when it is still to come", () => {
    expect(findRange("petrol in october", TODAY)).toEqual({ range: { from: "2026-10-01", to: "2026-10-31", label: "October" }, rest: "petrol" });
    expect(findRange("dec", TODAY).range).toEqual({ from: "2025-12-01", to: "2025-12-31", label: "December 2025" });
    expect(findRange("nov", TODAY).range?.to).toBe(TODAY);
  });
  it("knows January's last month is December", () => {
    expect(findRange("last month", "2026-01-10").range).toEqual({ from: "2025-12-01", to: "2025-12-31", label: "last month" });
  });
});

describe("amounts, names and categories", () => {
  it("reads amounts the way people type them", () => {
    expect(parseAmount("3000")).toBe(3000);
    expect(parseAmount("3,000")).toBe(3000);
    expect(parseAmount("1,00,000")).toBe(100000);
    expect(parseAmount("3k")).toBe(3000);
    expect(parseAmount("1.5k")).toBe(1500);
    expect(parseAmount("Rs 2500")).toBe(2500);
    expect(parseAmount("2 lakh")).toBe(200000);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("0")).toBeNull();
  });
  it("splits a list of names", () => {
    expect(splitNames("Ali, Sara and Bilal")).toEqual(["Ali", "Sara", "Bilal"]);
    expect(splitNames("ali & sara aur me")).toEqual(["ali", "sara"]);
  });
  it("maps everyday words to categories", () => {
    expect(matchCategory("food", cats)).toBe("Food & dining");
    expect(matchCategory("Petrol", cats)).toBe("Transport");
    expect(matchCategory("groceries", cats)).toBe("Groceries");
    expect(matchCategory("health", cats)).toBe("Health");
    expect(matchCategory("daraz", cats)).toBe("Shopping");
    expect(matchCategory("kolachi", cats)).toBeNull();
    expect(guessCategory("Dinner at Kolachi", cats)).toBe("Food & dining");
    expect(guessCategory("something odd", cats)).toBe("Uncategorized");
  });
});

describe("command mode", () => {
  const p = (t: string) => parseCommand(t, TODAY);
  it("greets with help", () => {
    expect(p("hi")).toEqual({ tool: "help" });
    expect(p("help")).toEqual({ tool: "help" });
  });
  it("answers how am I doing and balance", () => {
    expect(p("How am I doing?")).toEqual({ tool: "how_am_i_doing" });
    expect(p("how am i performing this month")).toEqual({ tool: "how_am_i_doing" });
    expect(p("balance")).toEqual({ tool: "balances" });
  });
  it("reads spending questions", () => {
    expect(p("summary")).toEqual({ tool: "spending_summary", from: "2026-11-01", to: TODAY, label: "this month" });
    expect(p("spending last month")).toEqual({ tool: "spending_summary", from: "2026-10-01", to: "2026-10-31", label: "last month" });
    expect(p("food this month")).toEqual({ tool: "spending_summary", from: "2026-11-01", to: TODAY, label: "this month", category: "food" });
    expect(p("How much did I spend on petrol last month?")).toMatchObject({ tool: "spending_summary", category: "petrol", from: "2026-10-01" });
    expect(p("daraz in october")).toMatchObject({ tool: "spending_summary", category: "daraz", from: "2026-10-01", to: "2026-10-31" });
  });
  it("reads splits by name", () => {
    expect(p("split 3000 dinner with Ali and Sara")).toEqual({ tool: "create_split", total: 3000, people: ["Ali", "Sara"], include_me: true, description: "dinner" });
    expect(p("Split 3k with ali, sara for pizza")).toEqual({ tool: "create_split", total: 3000, people: ["ali", "sara"], include_me: true, description: "pizza" });
    expect(p("split 5000 with Ali (not me)")).toEqual({ tool: "create_split", total: 5000, people: ["Ali"], include_me: false, description: "" });
    expect(p("split 1,200 on lunch at kfc with bilal")).toMatchObject({ total: 1200, people: ["bilal"], description: "lunch at kfc" });
  });
  it("reads who owes and settling", () => {
    expect(p("who owes me")).toEqual({ tool: "list_splits" });
    expect(p("what does ali owe")).toEqual({ tool: "list_splits", person: "ali" });
    expect(p("Ali paid")).toEqual({ tool: "settle_split", person: "Ali", note: undefined });
    expect(p("ali paid me back in cash")).toEqual({ tool: "settle_split", person: "ali", note: "Paid in cash" });
    expect(p("settle Sara Khan")).toEqual({ tool: "settle_split", person: "Sara Khan", note: undefined });
  });
  it("reads adding an expense and finding payments", () => {
    expect(p("spent 500 on lunch")).toEqual({ tool: "add_expense", amount: 500, description: "lunch", category: "" });
    expect(p("last 5 payments")).toEqual({ tool: "find_transactions", limit: 5 });
    expect(p("find careem")).toEqual({ tool: "find_transactions", query: "careem", from: undefined, to: undefined, limit: 10 });
  });
  it("reads net flow, remittance and salary questions", () => {
    expect(p("whats the netflow for this month")).toEqual({ tool: "cash_flow", from: "2026-11-01", to: TODAY, label: "this month" });
    expect(p("cash flow last month")).toEqual({ tool: "cash_flow", from: "2026-10-01", to: "2026-10-31", label: "last month" });
    expect(p("how much my remittance for this month")).toEqual({ tool: "money_in", kind: "remittance", from: "2026-11-01", to: TODAY, label: "this month" });
    expect(p("salary in october")).toMatchObject({ tool: "money_in", kind: "income", from: "2026-10-01", to: "2026-10-31" });
  });
  it("reads invoice requests, one or several", () => {
    expect(p("invoice for the last payment")).toEqual({ tool: "invoices", limit: 1, query: undefined, from: undefined, to: undefined });
    expect(p("send me an invoice for kolachi")).toEqual({ tool: "invoices", limit: 1, query: "kolachi", from: undefined, to: undefined });
    expect(p("invoices for the last 3 payments")).toEqual({ tool: "invoices", limit: 3, query: undefined, from: undefined, to: undefined });
    expect(p("invoices this month")).toEqual({ tool: "invoices", limit: 10, query: undefined, from: "2026-11-01", to: TODAY });
    expect(p("Generate invoices for daraz last month")).toEqual({ tool: "invoices", limit: 10, query: "daraz", from: "2026-10-01", to: "2026-10-31" });
    expect(p("invoices last 30 days")).toMatchObject({ tool: "invoices", limit: 10, from: "2026-10-18" });
  });
  it("says unknown for anything else", () => {
    expect(p("what's the weather")).toEqual({ tool: "unknown" });
  });
});

describe("display helpers", () => {
  it("formats numbers and long replies", () => {
    expect(formatPhone("923001234567")).toBe("+92 300 1234567");
    expect(formatPhone("447700900123")).toBe("+447700900123");
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const out = fitWhatsApp(long, 400);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.endsWith("…")).toBe(true);
  });
});
