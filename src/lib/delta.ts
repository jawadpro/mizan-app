/**
 * Percentage change between two periods, and whether it is good news for the user.
 * Spending going up is bad; income going up is good. A period with nothing before it reads "New".
 */
export function change(cur: number, prev: number, higherIsGood: boolean) {
  if (prev === 0 && cur === 0) return { text: "0%", tone: "flat" as const, dir: 0 };
  if (prev === 0) return { text: "New", tone: "flat" as const, dir: 1 };
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const r = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  const dir = r === 0 ? 0 : r > 0 ? 1 : -1;
  const tone = dir === 0 ? ("flat" as const) : (dir > 0) === higherIsGood ? ("good" as const) : ("bad" as const);
  return { text: `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}%`, tone, dir };
}
