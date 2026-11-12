"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPaisa, getDisplayCurrency } from "@/lib/money";
import { formatDatePkt } from "@/lib/time";
import { change } from "@/lib/delta";
import { resourceUrl, type Space } from "./api";
import { useData } from "./useData";
import { bankLabel, useBanks } from "./useBanks";
import { Empty, ErrorBox, Loading, Skeleton } from "./States";
import { PRESETS, presetRange, type Preset } from "./range";
import { useChartColors, type ChartColors } from "./theme";
import type { Analytics, Tx } from "./types";
import BalanceCard from "./BalanceCard";
import { useSelectedBank } from "./useSelectedBank";

type Gran = Analytics["granularity"];
type Series = "expense" | "income" | "remittance";
const SERIES_LABEL: Record<Series, string> = { expense: "Expenses", income: "Income", remittance: "Remittances" };

/** Whole rupees for headline figures; the exact paisa stay in tooltips and tables. */
const rs = (p: number, opts: { sign?: boolean } = {}) => formatPaisa(Math.round(p), opts).replace(/\.\d\d$/, "");
const compact = (p: number) => formatPaisa(Math.round(p), { compact: true, symbol: false });

function bucketLabel(b: string, g: Gran, long = false) {
  if (g === "year") return b;
  if (g === "month") {
    const [y, m] = b.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en", { month: long ? "long" : "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" });
  }
  const [y, m, d] = b.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleString("en", { day: "numeric", month: "short", ...(long ? { weekday: "short" } : {}), timeZone: "UTC" });
}

function shortRange(from: string, to: string) {
  const f = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleString("en", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${f(from)} – ${f(to)}`;
}

function Delta({ cur, prev, higherIsGood, vs }: { cur: number; prev: number; higherIsGood: boolean; vs?: string }) {
  const c = change(cur, prev, higherIsGood);
  return <span className={`delta ${c.tone}`} title={vs ? `Compared with ${vs}` : undefined}>{c.text}</span>;
}

function Trend({ cur, prev, higherIsGood }: { cur: number; prev: number; higherIsGood: boolean }) {
  const c = change(cur, prev, higherIsGood);
  if (c.dir === 0 || c.tone === "flat") return null;
  return <span className={`trend ${c.tone}`} aria-hidden>{c.dir > 0 ? "▲" : "▼"}</span>;
}

function Tip({ active, payload, label, gran, fmt }: { active?: boolean; payload?: { value: number; name: string; color?: string }[]; label?: string; gran: Gran; fmt?: (v: number) => string }) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="chart-tip">
      <div className="when">{bucketLabel(label, gran, true)}</div>
      {payload.map((p) => (
        <div key={p.name} className="line"><span>{p.name}</span><span>{(fmt ?? formatPaisa)(Number(p.value))}</span></div>
      ))}
    </div>
  );
}

const CAT_TOKENS: (keyof ChartColors)[] = ["text", "accent", "remit", "gold", "down"];

export default function Dashboard({ space, showBalance, top, defaultPreset = "30d" }: { space: Space; showBalance?: boolean; top?: React.ReactNode; defaultPreset?: Preset }) {
  const [preset, setPreset] = useState<Preset>(defaultPreset);
  const [custom, setCustom] = useState(() => presetRange(defaultPreset));
  const [gran, setGran] = useState<Gran | null>(null);
  const [series, setSeries] = useState<Series>("expense");
  const [hover, setHover] = useState<number | null>(null);
  const range = preset === "custom" ? custom : presetRange(preset);
  const granularity = gran ?? range.granularity;
  const { banks, multi, balanceName, nameOf } = useBanks(space);
  // Shared with the Transactions page, so a bank picked here is still picked there.
  const [sharedBank, setBank] = useSelectedBank(space);
  const bank = space === "app" ? sharedBank : "";
  const url = resourceUrl(space, "analytics", { from: range.from, to: range.to, granularity, bank: multi ? bank : undefined });
  const { data, error, loading, reload } = useData<Analytics>(url);
  const recent = useData<{ items: Tx[] }>(resourceUrl(space, "transactions", { pageSize: 5, bank: multi ? bank : undefined }));
  const base = space === "demo" ? "/demo" : "/app";
  const c = useChartColors();

  const rows = useMemo(() => data?.series ?? [], [data]);
  const balance = useMemo(() => data?.balanceSeries ?? null, [data]);
  const catTotal = (data?.categories ?? []).reduce((a, x) => a + x.total, 0);
  const cats = useMemo(() => {
    const list = data?.categories ?? [];
    const top = list.slice(0, 5).map((x, i) => ({ ...x, color: c[CAT_TOKENS[i]] }));
    const rest = list.slice(5).reduce((a, x) => a + x.total, 0);
    return rest > 0 ? [...top, { category: "Everything else", total: rest, n: list.slice(5).reduce((a, x) => a + x.n, 0), color: c["bar-strong"] }] : top;
  }, [data, c]);
  const isEmpty = data && data.totals.expense.n + data.totals.income.n + data.totals.remittance.n === 0;
  const prev = data?.previous;
  const vs = prev ? shortRange(prev.from, prev.to) : undefined;
  const last = rows.length ? rows[rows.length - 1] : null;
  const before = rows.length > 1 ? rows[rows.length - 2] : null;
  const unit = granularity === "day" ? "day" : granularity === "month" ? "month" : "year";
  const periodNow = granularity === "day" ? "Today" : granularity === "month" ? "This month" : "This year";
  const showing = hover != null && rows[hover] ? rows[hover] : last;
  const showingPrev = hover != null ? rows[hover - 1] ?? null : before;
  const balFirst = balance?.[0]?.balance ?? 0;
  const balLast = balance?.length ? balance[balance.length - 1].balance : 0;
  const balMin = balance?.length ? Math.min(...balance.map((b) => b.balance)) : 0;
  const balMax = balance?.length ? Math.max(...balance.map((b) => b.balance)) : 0;
  const pad = Math.max(1, (balMax - balMin) * 0.15);

  const axis = { tick: { fontSize: 11, fill: c.faint }, tickLine: false, axisLine: false } as const;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted small">All amounts in {getDisplayCurrency()}{vs ? ` · compared with ${vs}` : ""}</p>
        </div>
        <div className="toolbar">
          {multi && (
            <select aria-label="Bank" value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">All banks</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{bankLabel(b)}</option>)}
              <option value="none">No bank (cash)</option>
            </select>
          )}
          <div className="seg" role="group" aria-label="Date range">
            {PRESETS.map((p) => (
              <button key={p.id} className={preset === p.id ? "on" : ""} onClick={() => { setPreset(p.id); setGran(null); if (p.id === "custom") setCustom(range); }}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Group by">
            {(["day", "month", "year"] as const).map((g) => (
              <button key={g} className={granularity === g ? "on" : ""} onClick={() => setGran(g)}>
                {g === "day" ? "Daily" : g === "month" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The balance card and the latest transactions side by side, so the first screen shows both. */}
      <div className={`top-row${showBalance ? " with-recent" : ""}`}>
        {showBalance && <BalanceCard bank={multi ? bank : ""} />}
        <div className="card recent-card">
          <div className="card-head"><h2>Recent transactions</h2><Link className="btn sm" href={`${base}/transactions`}>View all</Link></div>
          {recent.loading && !recent.data ? <Loading rows={4} /> : recent.error ? <ErrorBox message={recent.error} onRetry={recent.reload} /> : !recent.data?.items.length ? (
            <p className="small muted" style={{ margin: 0 }}>No transactions yet.</p>
          ) : (
            <div className="tx-list">
              {recent.data.items.map((t) => (
                <div key={t.id} className="tx-row">
                  <div className="tx-row-main">
                    <div className="tx-row-title">{t.counterparty ?? t.category}</div>
                    <div className="meta">{formatDatePkt(t.occurred_at)} · {t.category}{t.source === "sms" ? " · SMS" : ""}</div>
                  </div>
                  <div className="tx-row-side"><span className={`amt ${t.kind}`}>{formatPaisa(t.kind === "expense" ? -t.amount_paisa : t.amount_paisa, { sign: true })}</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {top}

      {preset === "custom" && (
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <label className="small muted">From <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} /></label>
          <label className="small muted">To <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} /></label>
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={reload} />}

      {data && data.pendingReview > 0 && (
        <div className="alert warn" style={{ marginBottom: 12 }}>
          <span><strong className="num">{data.pendingReview}</strong> SMS alert{data.pendingReview > 1 ? "s" : ""} need{data.pendingReview > 1 ? "" : "s"} review and {data.pendingReview > 1 ? "are" : "is"} not counted below yet.</span>
          <Link className="btn sm" href={`${base}/review`}>Open review inbox</Link>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-title">
          <span>This period{data ? ` · ${shortRange(data.from, data.to)}` : ""}</span>
          {vs && <span className="hide-mobile">vs {vs}</span>}
        </div>
        <div className="grid kpis">
          {([
            { k: "expense", label: "Expenses", good: false },
            { k: "income", label: "Income", good: true },
            { k: "remittance", label: "Remittances in", good: true },
          ] as const).map((x) => {
            const cur = data?.totals[x.k];
            const was = prev?.totals[x.k];
            return (
              <div key={x.k} className={`card kpi ${x.k}`}>
                <div className="label">
                  <span><span className={`dot ${x.k}`} />{x.label}</span>
                  {data && was && <Delta cur={cur!.total} prev={was.total} higherIsGood={x.good} vs={vs} />}
                </div>
                {loading && !data ? <Skeleton h={30} w="70%" /> : (
                  <div className="value">{rs(cur?.total ?? 0)} {was && <Trend cur={cur!.total} prev={was.total} higherIsGood={x.good} />}</div>
                )}
                <div className="sub">
                  {cur?.n ?? 0} transaction{cur?.n === 1 ? "" : "s"}
                  {x.k === "expense" && data ? ` · ${rs(data.avgDailyExpense)} a day` : ""}
                </div>
              </div>
            );
          })}
          <div className="card kpi net">
            <div className="label">
              <span>Net flow</span>
              {data && prev && <Delta cur={data.net} prev={prev.net} higherIsGood vs={vs} />}
            </div>
            {loading && !data ? <Skeleton h={30} w="70%" /> : (
              <div className="value" style={{ color: (data?.net ?? 0) < 0 ? "var(--down-ink)" : "var(--accent-ink)" }}>{rs(data?.net ?? 0, { sign: true })}</div>
            )}
            <div className="sub">Income and remittances, less expenses</div>
          </div>
        </div>
      </div>

      {isEmpty ? (
        <div className="card">
          <Empty title="No transactions in this period">
            {space === "app" ? (
              <p>Add one by hand from <Link href="/app/transactions">Transactions</Link>, or set up the <Link href="/app/sms">iPhone SMS shortcut</Link>.</p>
            ) : (
              <p>Try a longer date range.</p>
            )}
          </Empty>
        </div>
      ) : (
        <>
          <div className="dash-row">
            <div className="card">
              <div className="chart-head">
                <div>
                  <h2>{SERIES_LABEL[series]} trend</h2>
                  <div className="seg" role="group" aria-label="Show" style={{ marginTop: 8 }}>
                    {(Object.keys(SERIES_LABEL) as Series[]).map((s) => (
                      <button key={s} className={series === s ? "on" : ""} onClick={() => setSeries(s)}>{SERIES_LABEL[s]}</button>
                    ))}
                  </div>
                </div>
                <div className="chart-figure">
                  <div className="label">{showing ? (hover != null ? bucketLabel(showing.bucket, granularity, true) : periodNow) : ""}</div>
                  {showing && (
                    <div className="value">
                      {rs(showing[series])}
                      {showingPrev && <Delta cur={showing[series]} prev={showingPrev[series]} higherIsGood={series !== "expense"} vs={`the ${unit} before`} />}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ width: "100%", height: 240 }}>
                {loading && !data ? <Loading rows={6} /> : (
                  <ResponsiveContainer>
                    <BarChart data={rows} margin={{ top: 8, right: 0, left: 0, bottom: 0 }} onMouseMove={(s) => setHover(typeof s?.activeTooltipIndex === "number" ? s.activeTooltipIndex : null)} onMouseLeave={() => setHover(null)}>
                      <CartesianGrid stroke={c.border} strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="bucket" tickFormatter={(b) => bucketLabel(String(b), granularity)} {...axis} minTickGap={24} />
                      <YAxis tickFormatter={(v) => compact(Number(v))} {...axis} width={44} />
                      <Tooltip cursor={false} content={<Tip gran={granularity} />} />
                      <Bar dataKey={series} name={SERIES_LABEL[series]} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false}>
                        {rows.map((r, i) => {
                          const on = hover != null ? i === hover : i === rows.length - 1;
                          return <Cell key={r.bucket} fill={on ? (series === "expense" ? c.text : series === "income" ? c.accent : c.remit) : hover != null ? c.bar : c["bar-strong"]} fillOpacity={on || hover == null ? 1 : 0.9} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="card">
              <div className="chart-head">
                <div>
                  <h2>Balance over time</h2>
                  <div className="hint">{space === "app" ? (multi && bank && bank !== "none" ? `${nameOf(bank) ?? "This bank"}'s balance` : balanceName) : "Balance"} at the end of each {unit}{multi && !bank ? ", all banks together" : ""}</div>
                </div>
                {balance && balance.length > 0 && (
                  <div className="chart-figure">
                    <div className="label">Change</div>
                    <div className="value">{rs(balLast - balFirst, { sign: true })}</div>
                  </div>
                )}
              </div>
              <div style={{ width: "100%", height: 240 }}>
                {loading && !data ? <Loading rows={6} /> : multi && bank === "none" ? (
                  <Empty icon="⚖️" title="Cash has no bank balance">
                    <p className="small">Pick a bank, or All banks, above to see the balance over time.</p>
                  </Empty>
                ) : !balance ? (
                  <Empty icon="⚖️" title="Set your balance to see it here">
                    {space === "app" && <p className="small">Use “Set balance” above{multi && bank ? " for this bank" : ""}. Mizan then works the balance out for every day.</p>}
                  </Empty>
                ) : (
                  <ResponsiveContainer>
                    <AreaChart data={balance} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="balFill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0" stopColor={c.accent} stopOpacity={0.2} />
                          <stop offset="1" stopColor={c.accent} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={c.border} strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="bucket" tickFormatter={(b) => bucketLabel(String(b), granularity)} {...axis} minTickGap={32} />
                      <YAxis domain={[balMin - pad, balMax + pad]} tickFormatter={(v) => compact(Number(v))} {...axis} width={44} tickCount={4} />
                      <Tooltip cursor={{ stroke: c["border-strong"] }} content={<Tip gran={granularity} />} />
                      <Area type="monotone" dataKey="balance" name="Balance" stroke={c.accent} strokeWidth={2} fill="url(#balFill)" isAnimationActive={false} activeDot={{ r: 4, fill: c.accent, stroke: c.surface, strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          <div className="grid half" style={{ marginBottom: 12 }}>
            <div className="card">
              <div className="card-head"><h2>Where money went</h2><span className="muted small">{rs(catTotal)} on expenses</span></div>
              {loading && !data ? <Loading /> : cats.length === 0 ? <Empty title="No expenses in this period" /> : (
                <>
                  <div className="balance-split" style={{ marginTop: 0, marginBottom: 6 }} aria-hidden>
                    {cats.map((x) => <div key={x.category} style={{ flex: x.total, background: x.color }} />)}
                  </div>
                  <div className="bar-list">
                    {cats.map((x) => {
                      const row = (
                        <div className="bar-row">
                          <div className="top">
                            <span><span className="dot" style={{ background: x.color, marginRight: 8 }} />{x.category} <span className="muted small">· {x.n}×</span></span>
                            <span className="num">{rs(x.total)} <span className="muted">{catTotal ? Math.round((x.total / catTotal) * 100) : 0}%</span></span>
                          </div>
                        </div>
                      );
                      return x.category === "Everything else" ? <div key={x.category}>{row}</div> : (
                        <Link key={x.category} href={`${base}/transactions?category=${encodeURIComponent(x.category)}&from=${data!.from}&to=${data!.to}`} style={{ textDecoration: "none", color: "inherit" }}>{row}</Link>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <div className="card">
              <div className="card-head"><h2>Top recipients</h2><Link className="btn sm" href={`${base}/recipients`}>All recipients</Link></div>
              {loading && !data ? <Loading /> : data && data.topRecipients.length === 0 ? <Empty title="No payments to recipients yet" /> : (
                <div className="bar-list">
                  {(data?.topRecipients ?? []).map((r) => (
                    <div key={r.counterparty} className="bar-row">
                      <div className="top"><span>{r.counterparty} <span className="muted small">· {r.n}×</span></span><span className="num">{rs(r.total)}</span></div>
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
