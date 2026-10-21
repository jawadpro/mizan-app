"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPaisa } from "@/lib/money";
import { resourceUrl, type Space } from "./api";
import { useData } from "./useData";
import { Empty, ErrorBox, Loading, Skeleton } from "./States";
import { PRESETS, presetRange, type Preset } from "./range";
import type { Analytics } from "./types";

const COLORS = { expense: "#b5654a", income: "#3f7d5a", remittance: "#4f73a8" };
const CAT_COLORS = ["#2f5d4c", "#8fae8f", "#b5654a", "#d4a86a", "#4f73a8", "#a3b8c9", "#7d6b91", "#c9b79c", "#5f8f7a", "#e0c2a2", "#9aa58c", "#6f7f86", "#cfd6c4"];

function bucketLabel(b: string, g: Analytics["granularity"]) {
  if (g === "year") return b;
  if (g === "month") {
    const [y, m] = b.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  const [y, m, d] = b.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleString("en", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default function Dashboard({ space }: { space: Space }) {
  const [preset, setPreset] = useState<Preset>("30d");
  const [custom, setCustom] = useState(() => presetRange("30d"));
  const [gran, setGran] = useState<"day" | "month" | "year" | null>(null);
  const range = preset === "custom" ? custom : presetRange(preset);
  const granularity = gran ?? range.granularity;
  const url = resourceUrl(space, "analytics", { from: range.from, to: range.to, granularity });
  const { data, error, loading, reload } = useData<Analytics>(url);
  const base = space === "demo" ? "/demo" : "/app";

  const series = useMemo(() => (data?.series ?? []).map((s) => ({ ...s, label: bucketLabel(s.bucket, data!.granularity) })), [data]);
  const catTotal = (data?.categories ?? []).reduce((a, c) => a + c.total, 0);
  const isEmpty = data && data.totals.expense.n + data.totals.income.n + data.totals.remittance.n === 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">All amounts in PKR · Asia/Karachi time{data ? ` · ${data.from} to ${data.to}` : ""}</p>
        </div>
        <div className="toolbar">
          <div className="seg" role="group" aria-label="Date range">
            {PRESETS.map((p) => (
              <button key={p.id} className={preset === p.id ? "on" : ""} onClick={() => { setPreset(p.id); setGran(null); if (p.id === "custom") setCustom(range); }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 16, justifyContent: "space-between" }}>
        {preset === "custom" ? (
          <div className="toolbar">
            <label className="small muted">From <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} /></label>
            <label className="small muted">To <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} /></label>
          </div>
        ) : <span />}
        <div className="seg" role="group" aria-label="Group by">
          {(["day", "month", "year"] as const).map((g) => (
            <button key={g} className={granularity === g ? "on" : ""} onClick={() => setGran(g)}>
              {g === "day" ? "Daily" : g === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}

      {data && data.pendingReview > 0 && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <span>{data.pendingReview} SMS alert{data.pendingReview > 1 ? "s" : ""} need{data.pendingReview > 1 ? "" : "s"} review and {data.pendingReview > 1 ? "are" : "is"} not counted below yet.</span>
          <Link className="btn sm" href={`${base}/review`}>Open review inbox</Link>
        </div>
      )}

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        {[
          { k: "expense", label: "Expenses", v: data?.totals.expense.total, n: data?.totals.expense.n },
          { k: "income", label: "Income", v: data?.totals.income.total, n: data?.totals.income.n },
          { k: "remittance", label: "Remittances in", v: data?.totals.remittance.total, n: data?.totals.remittance.n },
        ].map((c) => (
          <div key={c.k} className="card kpi">
            <div className="label"><span className={`dot ${c.k}`} />{c.label}</div>
            {loading && !data ? <Skeleton h={30} w="70%" /> : <div className="value">{formatPaisa(c.v ?? 0)}</div>}
            <div className="sub">{c.n ?? 0} transaction{c.n === 1 ? "" : "s"}</div>
          </div>
        ))}
        <div className="card kpi">
          <div className="label">Net flow</div>
          {loading && !data ? <Skeleton h={30} w="70%" /> : <div className="value" style={{ color: (data?.net ?? 0) < 0 ? "var(--expense)" : "var(--income)" }}>{formatPaisa(data?.net ?? 0, { sign: true })}</div>}
          <div className="sub">Income + remittances − expenses</div>
        </div>
        <div className="card kpi">
          <div className="label">Avg. daily spend</div>
          {loading && !data ? <Skeleton h={30} w="70%" /> : <div className="value">{formatPaisa(data?.avgDailyExpense ?? 0)}</div>}
          <div className="sub">Across the selected days</div>
        </div>
      </div>

      {isEmpty ? (
        <div className="card">
          <Empty title="No transactions in this period">
            {space === "app" ? (
              <p>Add one by hand from <Link href="/app/transactions">Transactions</Link>, or set up the <Link href="/app/settings">iPhone SMS shortcut</Link>.</p>
            ) : (
              <p>Try a longer date range.</p>
            )}
          </Empty>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h2>Spending trend</h2>
              <span className="muted small">{granularity === "day" ? "Per day" : granularity === "month" ? "Per month" : "Per year"}</span>
            </div>
            <div style={{ width: "100%", height: 300 }}>
              {loading && !data ? <Loading rows={6} /> : (
                <ResponsiveContainer>
                  <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#ece5d6" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#66716a" }} tickLine={false} axisLine={{ stroke: "#e3dccb" }} minTickGap={16} />
                    <YAxis tickFormatter={(v) => formatPaisa(v, { compact: true }).replace("Rs ", "")} tick={{ fontSize: 12, fill: "#66716a" }} tickLine={false} axisLine={false} width={56} />
                    <Tooltip
                      cursor={{ fill: "rgba(143,174,143,0.12)" }}
                      formatter={(v, name) => [formatPaisa(Number(v)), String(name)]}
                      contentStyle={{ borderRadius: 12, border: "1px solid #e3dccb", background: "#fffdf8" }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
                    <Bar dataKey="expense" name="Expenses" fill={COLORS.expense} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    <Bar dataKey="income" name="Income" fill={COLORS.income} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    <Bar dataKey="remittance" name="Remittances" fill={COLORS.remittance} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid half">
            <div className="card">
              <div className="card-head"><h2>Where money went</h2><span className="muted small">Expenses by category</span></div>
              {loading && !data ? <Loading /> : data && data.categories.length === 0 ? <Empty title="No expenses in this period" /> : (
                <div className="grid" style={{ gridTemplateColumns: "minmax(0,160px) 1fr", alignItems: "center", gap: 18 }}>
                  <div style={{ width: "100%", height: 160 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={data?.categories ?? []} dataKey="total" nameKey="category" innerRadius={48} outerRadius={76} paddingAngle={1} stroke="none">
                          {(data?.categories ?? []).map((c, i) => <Cell key={c.category} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v, n) => [formatPaisa(Number(v)), String(n)]} contentStyle={{ borderRadius: 12, border: "1px solid #e3dccb" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="bar-list">
                    {(data?.categories ?? []).slice(0, 7).map((c, i) => (
                      <Link key={c.category} href={`${base}/transactions?category=${encodeURIComponent(c.category)}&from=${data!.from}&to=${data!.to}`} style={{ textDecoration: "none", color: "inherit" }}>
                        <div className="bar-row">
                          <div className="top"><span><span className="dot" style={{ background: CAT_COLORS[i % CAT_COLORS.length], marginRight: 6 }} />{c.category}</span><span className="num">{formatPaisa(c.total)} <span className="muted small">{catTotal ? Math.round((c.total / catTotal) * 100) : 0}%</span></span></div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="card">
              <div className="card-head"><h2>Top recipients</h2><Link className="small" href={`${base}/recipients`}>All recipients →</Link></div>
              {loading && !data ? <Loading /> : data && data.topRecipients.length === 0 ? <Empty title="No payments to recipients yet" /> : (
                <div className="bar-list">
                  {(data?.topRecipients ?? []).map((r) => (
                    <div key={r.counterparty} className="bar-row">
                      <div className="top"><span>{r.counterparty} <span className="muted small">· {r.n}×</span></span><span className="num">{formatPaisa(r.total)}</span></div>
                      <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(3, (r.total / (data!.topRecipients[0]?.total || 1)) * 100)}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
