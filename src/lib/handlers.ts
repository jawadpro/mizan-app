import "server-only";
import type { Space } from "./db";
import { analytics, exportTransactions, listReview, listTransactions, recipients } from "./repo";
import { listQuery, rangeQuery, searchParamsObject } from "./validation";
import { HttpError, json } from "./http";
import { toCsv } from "./csv";
import { isIsoDate, todayPkt } from "./time";

function bad(issues: { message: string; path: (string | number)[] }[]) {
  return new HttpError(400, "Invalid query", { issues: issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
}

export async function getTransactions(space: Space, req: Request) {
  const parsed = listQuery.safeParse(searchParamsObject(req.url));
  if (!parsed.success) throw bad(parsed.error.issues);
  return json({ ok: true, ...(await listTransactions(space, parsed.data)) });
}

export async function getAnalytics(space: Space, req: Request) {
  const parsed = rangeQuery.safeParse(searchParamsObject(req.url));
  if (!parsed.success) throw bad(parsed.error.issues);
  const { from, to, granularity } = parsed.data;
  if (from > to) throw new HttpError(400, "from must be on or before to");
  const days = (Date.parse(to) - Date.parse(from)) / 86400e3;
  if (granularity === "day" && days > 800) throw new HttpError(400, "Use monthly or yearly view for ranges over two years");
  return json({ ok: true, ...(await analytics(space, from, to, granularity)) });
}

export async function getRecipients(space: Space, req: Request) {
  const sp = searchParamsObject(req.url);
  const from = isIsoDate(sp.from) ? sp.from : undefined;
  const to = isIsoDate(sp.to) ? sp.to : undefined;
  return json({ ok: true, items: await recipients(space, from, to) });
}

export async function getReview(space: Space) {
  return json({ ok: true, items: await listReview(space) });
}

export async function getExport(space: Space, req: Request) {
  const parsed = listQuery.partial().safeParse(searchParamsObject(req.url));
  if (!parsed.success) throw bad(parsed.error.issues);
  const rows = await exportTransactions(space, parsed.data);
  return new Response(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="mizan-${space === "demo" ? "demo-" : ""}transactions-${todayPkt()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
