import "server-only";
import { tolaPricePaisa } from "./zakat";

// Free, keyless sources: gold-api.com for spot metal prices (USD per troy ounce) and
// open.er-api.com for USD to PKR. Responses are untrusted, so every field is checked.
const GOLD_URL = "https://api.gold-api.com/price/XAU";
const SILVER_URL = "https://api.gold-api.com/price/XAG";
const FX_URL = "https://open.er-api.com/v6/latest/USD";

export type MetalPrices = {
  goldPerTola: number;
  silverPerTola: number;
  pkrPerUsd: number;
  pricesAt: string;
  fxAt: string;
  source: string;
};

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { next: { revalidate: 1800 }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`price source returned ${res.status}`);
  return res.json();
}

function spot(j: unknown): { usd: number; at: string } {
  const o = j as { price?: unknown; currency?: unknown; updatedAt?: unknown };
  if (o?.currency !== "USD" || typeof o.price !== "number") throw new Error("unexpected metal price format");
  const at = typeof o.updatedAt === "string" && !Number.isNaN(Date.parse(o.updatedAt)) ? new Date(o.updatedAt).toISOString() : new Date().toISOString();
  return { usd: o.price, at };
}

export async function fetchMetalPrices(): Promise<MetalPrices> {
  const [g, s, fx] = await Promise.all([getJson(GOLD_URL), getJson(SILVER_URL), getJson(FX_URL)]);
  const gold = spot(g);
  const silver = spot(s);
  const f = fx as { result?: unknown; rates?: { PKR?: unknown }; time_last_update_unix?: unknown };
  const pkr = f?.result === "success" && typeof f.rates?.PKR === "number" ? f.rates.PKR : NaN;
  // Guard against a broken feed producing an absurd rate.
  if (!(pkr > 50 && pkr < 2000)) throw new Error("unexpected exchange rate");
  const goldPerTola = tolaPricePaisa(gold.usd, pkr);
  const silverPerTola = tolaPricePaisa(silver.usd, pkr);
  if (!goldPerTola || !silverPerTola) throw new Error("unexpected metal price");
  const fxAt = typeof f.time_last_update_unix === "number" ? new Date(f.time_last_update_unix * 1000).toISOString() : new Date().toISOString();
  return { goldPerTola, silverPerTola, pkrPerUsd: pkr, pricesAt: gold.at < silver.at ? gold.at : silver.at, fxAt, source: "gold-api.com and open.er-api.com" };
}
