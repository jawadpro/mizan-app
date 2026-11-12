"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { ALL_CATEGORIES, KIND_LABEL, KINDS } from "@/lib/categories";
import { formatPaisa } from "@/lib/money";
import { dayLabelPkt, formatTimePkt, groupByDayPkt } from "@/lib/time";
import { groupCharges } from "@/lib/nest";
import { apiFetch, resourceUrl, type Space } from "./api";
import { useData } from "./useData";
import { Empty, ErrorBox, Loading } from "./States";
import TxForm, { draftFrom, type TxDraft } from "./TxForm";
import DateRangePicker from "./DateRangePicker";
import { bankLabel, useBanks } from "./useBanks";
import { setSelectedBank, useSelectedBank } from "./useSelectedBank";
import { useChargesEdit } from "./ChargesField";
import { useToast } from "./Toast";
import type { Tx } from "./types";
import SplitForm from "./SplitForm";
import "@/app/splits.css";

type List = { items: Tx[]; total: number; page: number; pageSize: number; sums: { expense: number; income: number; remittance: number } };

/** "−Rs 10,025 in all": the transfer plus its charges, under the transfer's amount. */
function totalLabel(t: Tx, charges: Tx[]) {
  const sum = t.amount_paisa + charges.reduce((n, c) => n + c.amount_paisa, 0);
  return `${t.kind === "expense" ? "−" : ""}${formatPaisa(sum)} in all`;
}

const isChargeCategory = (c: string) => c === "Bank charges" || c === "Tax deducted";

/** A bank charge or tax shown as a small badge on the transfer it belongs to. Tapping it opens the charge. */
function ChargeBadge({ c, onOpen }: { c: Tx; onOpen?: (c: Tx) => void }) {
  const tax = c.category === "Tax deducted";
  const body = (
    <>
      <span className="charge-badge-icon" aria-hidden>{tax ? "%" : "₨"}</span>
      <span className="charge-badge-label">{tax ? "Tax" : "Bank charge"}</span>
      <span className="charge-badge-amt">−{formatPaisa(c.amount_paisa)}</span>
    </>
  );
  return onOpen ? (
    <button type="button" className={`charge-badge${tax ? " tax" : ""}`} onClick={(e) => { e.stopPropagation(); onOpen(c); }} title={`Edit this ${tax ? "tax" : "charge"}`}>{body}</button>
  ) : <span className={`charge-badge${tax ? " tax" : ""}`}>{body}</span>;
}

/** The category, with bank charges and tax picked out as a badge so they stand apart from spending. */
function CategoryCell({ category }: { category: string }) {
  if (!isChargeCategory(category)) return <>{category}</>;
  const tax = category === "Tax deducted";
  return <span className={`charge-cat${tax ? " tax" : ""}`}><span className="charge-badge-icon" aria-hidden>{tax ? "%" : "₨"}</span>{category}</span>;
}

/** Whether a payment can be split between people: money paid out, but not a bank charge or tax. */
const canSplit = (t: Tx) => t.kind === "expense" && !isChargeCategory(t.category);

/** "Split · 2 owe you" on a split payment; "Paid back · Ali" on money that paid a share back. */
function SplitBadge({ t, onOpen }: { t: Tx; onOpen?: (t: Tx) => void }) {
  if (t.split) {
    const open = t.split.open;
    const label = open ? `Split · ${open} owe${open === 1 ? "s" : ""} you` : "Split · all paid back";
    return <div>{onOpen ? (
      <button type="button" className={`split-badge${open ? "" : " done"}`} onClick={(e) => { e.stopPropagation(); onOpen(t); }} title="See the shares">{label}</button>
    ) : <span className={`split-badge${open ? "" : " done"}`}>{label}</span>}</div>;
  }
  if (t.repays) return <div><span className="split-badge repays">Paid back · {t.repays}</span></div>;
  return null;
}

/** What a day's transactions add up to, shown on the right of its header. */
function DayTotals({ items }: { items: Tx[] }) {
  const out = items.reduce((n, t) => n + (t.kind === "expense" ? t.amount_paisa : 0), 0);
  const inn = items.reduce((n, t) => n + (t.kind !== "expense" ? t.amount_paisa : 0), 0);
  return (
    <span className="day-totals">
      {out > 0 && <span className="amt expense">−{formatPaisa(out)}</span>}
      {inn > 0 && <span className="amt income">+{formatPaisa(inn)}</span>}
    </span>
  );
}

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function Transactions({ space, fixedCounterparty }: { space: Space; fixedCounterparty?: string }) {
  const sp = useSearchParams();
  const toast = useToast();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [kind, setKind] = useState(sp.get("kind") ?? "");
  const [category, setCategory] = useState(sp.get("category") ?? "");
  const [source, setSource] = useState(sp.get("source") ?? "");
  // The bank filter is shared with Overview (except in a recipient's panel), and a ?bank= link sets it.
  const [sharedBank, setSharedBank] = useSelectedBank(space);
  const [ownBank, setOwnBank] = useState(sp.get("bank") ?? "");
  const shareBank = !fixedCounterparty && space === "app";
  const bank = shareBank ? sharedBank : ownBank;
  const setBank = shareBank ? setSharedBank : setOwnBank;
  const linkedBank = sp.get("bank");
  useEffect(() => {
    if (shareBank && linkedBank) setSelectedBank(linkedBank);
  }, [shareBank, linkedBank]);
  const { banks, multi, nameOf } = useBanks(space);
  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Tx | "new" | null>(null);
  const chargesEdit = useChargesEdit();
  const [splitting, setSplitting] = useState<string | null>(null);
  const openSplit = (t: Tx) => { setEditing(null); setSplitting(t.id); };
  const edit = (t: Tx | "new") => { chargesEdit.start(t); setEditing(t); };
  const dq = useDebounced(q);
  const filters = { q: dq, kind, category, source, bank, from, to, counterparty: fixedCounterparty };
  useEffect(() => setPage(1), [dq, kind, category, source, bank, from, to]);
  const url = resourceUrl(space, "transactions", { ...filters, page, pageSize: 25 });
  const { data, error, loading, reload } = useData<List>(url);
  const readOnly = space === "demo";
  // Inside a recipient's panel there is little room, so history shows as a list instead of a wide table.
  const compact = !!fixedCounterparty;
  const hasFilters = !!(dq || kind || category || source || bank || from || to);

  async function save(d: TxDraft, id?: string) {
    const chargesNote = id ? chargesEdit.toastFor(d) : null;
    await apiFetch(id ? `/api/transactions/${id}` : "/api/transactions", { method: id ? "PATCH" : "POST", body: JSON.stringify(id ? chargesEdit.body(d) : d) });
    setEditing(null);
    toast(chargesNote ?? (id ? "Transaction updated" : "Transaction added"), "ok");
    reload();
  }
  async function destroy(id: string) {
    await apiFetch(`/api/transactions/${id}`, { method: "DELETE" });
    setEditing(null);
    toast("Transaction deleted", "ok");
    reload();
  }
  async function remove(t: Tx) {
    if (!window.confirm(`Delete ${formatPaisa(t.amount_paisa)} ${t.counterparty ? `to ${t.counterparty}` : ""}? This can't be undone.`)) return;
    try {
      await apiFetch(`/api/transactions/${t.id}`, { method: "DELETE" });
      toast("Transaction deleted", "ok");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const days = data ? groupByDayPkt(data.items) : [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      {!fixedCounterparty && (
        <div className="page-head">
          <div>
            <h1>Transactions</h1>
            <p className="muted">Search by recipient, merchant, note, category or exact amount.</p>
          </div>
          <div className="toolbar">
            <Link className="btn" href={space === "demo" ? "/demo/calendar" : "/app/calendar"}>Calendar view</Link>
            <a className="btn" href={resourceUrl(space, "export", filters)} download>Export CSV</a>
            {readOnly ? (
              <button className="btn primary" disabled title="The demo is read-only. Sign in to your private workspace to add transactions.">+ Add transaction</button>
            ) : (
              <button className="btn primary" onClick={() => edit("new")}>+ Add transaction</button>
            )}
          </div>
        </div>
      )}

      {!fixedCounterparty && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="toolbar">
            <input type="search" aria-label="Search transactions" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 220px" }} />
            <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All types</option>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {Array.from(new Set([...ALL_CATEGORIES, ...(category ? [category] : [])])).map((c) => <option key={c}>{c}</option>)}
            </select>
            {!readOnly && (
              <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">All sources</option>
                <option value="manual">Manual</option>
                <option value="sms">SMS</option>
              </select>
            )}
            {multi && (
              <select aria-label="Bank" value={bank} onChange={(e) => setBank(e.target.value)}>
                <option value="">All banks</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{bankLabel(b)}</option>)}
                <option value="none">No bank (cash)</option>
              </select>
            )}
            <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
            {hasFilters && <button className="btn ghost sm" onClick={() => { setQ(""); setKind(""); setCategory(""); setSource(""); setBank(""); setFrom(""); setTo(""); }}>Clear</button>}
          </div>
          {data && (
            <div className={`tx-summary${loading ? " loading" : ""}`} aria-live="polite">
              <span className="sum-pill count"><b>{data.total.toLocaleString("en-PK")}</b> result{data.total === 1 ? "" : "s"}</span>
              <span className="sum-pill expense"><span className="sum-ico" aria-hidden>↑</span><span className="sum-label">Out</span><span className="amt">{formatPaisa(data.sums.expense)}</span></span>
              <span className="sum-pill income"><span className="sum-ico" aria-hidden>↓</span><span className="sum-label">Income</span><span className="amt">{formatPaisa(data.sums.income)}</span></span>
              <span className="sum-pill remittance"><span className="sum-ico" aria-hidden>⇄</span><span className="sum-label">Remittances</span><span className="amt">{formatPaisa(data.sums.remittance)}</span></span>
            </div>
          )}
        </div>
      )}

      <div className="card">
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading rows={8} label="Loading transactions" /> : data && data.items.length === 0 ? (
          <Empty icon={hasFilters ? "🔍" : "🌱"} title={hasFilters ? "Nothing matches these filters" : "No transactions yet"}>
            {!hasFilters && !readOnly && <p><button className="btn primary" onClick={() => edit("new")}>Add your first transaction</button></p>}
          </Empty>
        ) : (
          <>
            {compact ? (
              <div className="tx-list" style={{ opacity: loading ? 0.55 : 1 }}>
                <div className="card-head" style={{ marginBottom: 2 }}><h2>History</h2><span className="muted small">{data!.total} transaction{data!.total === 1 ? "" : "s"}</span></div>
                {days.map((g) => (<Fragment key={g.day}>
                  <div className="day-head"><span>{dayLabelPkt(g.day)}</span><DayTotals items={g.items} /></div>
                  {g.items.map((t) => (
                  <div key={t.id} className="tx-row">
                    <div className="tx-row-main">
                      <div className="tx-row-title">
                        <span>{t.category}</span>
                        {t.kind !== "expense" && <span className={`pill ${t.kind}`}>{KIND_LABEL[t.kind]}</span>}
                        {t.source === "sms" && <span className="pill sms" title={t.account_hint ? `Account ending ${t.account_hint}` : undefined}>{(multi && nameOf(t.bank_id)) || "SMS"}</span>}
                      </div>
                      <div className="meta"><span className="num">{formatTimePkt(t.occurred_at)}</span>{t.note ? ` · ${t.note}` : ""}</div>
                    </div>
                    <div className="tx-row-side">
                      <div className={`amt ${t.kind}`}>{t.kind === "expense" ? "−" : "+"}{formatPaisa(t.amount_paisa)}</div>
                      {!readOnly && (
                        <div className="row-actions">
                          <button className="btn ghost sm" onClick={() => edit(t)}>Edit</button>
                          <button className="btn ghost sm danger" onClick={() => remove(t)}>Delete</button>
                        </div>
                      )}
                    </div>
                  </div>
                  ))}
                </Fragment>))}
              </div>
            ) : (<>
            <div className="table-wrap responsive">
              <table className="tx">
                <thead>
                  <tr><th>Time</th><th>Recipient / source</th><th>Category</th><th>Type</th><th>Source</th><th className="amt">Amount</th>{!readOnly && <th><span className="sr-only">Actions</span></th>}</tr>
                </thead>
                <tbody style={{ opacity: loading ? 0.55 : 1 }}>
                  {days.map((g) => (<Fragment key={g.day}>
                    <tr className="day-row"><td colSpan={readOnly ? 6 : 7}><div className="day-head"><span>{dayLabelPkt(g.day)}</span><DayTotals items={g.items} /></div></td></tr>
                    {groupCharges(g.items).map(({ t, charges }) => (<Fragment key={t.id}>
                    <tr className={charges.length ? "has-charges" : undefined}>
                      <td className="num muted" style={{ whiteSpace: "nowrap" }}>{formatTimePkt(t.occurred_at)}</td>
                      <td>
                        {t.counterparty ?? <span className="muted">—</span>}{t.note && <div className="small muted">{t.note}</div>}
                        {charges.length > 0 && <div className="charge-badges">{charges.map((c) => <ChargeBadge key={c.id} c={c} onOpen={readOnly ? undefined : edit} />)}</div>}
                        <SplitBadge t={t} onOpen={readOnly ? undefined : openSplit} />
                      </td>
                      <td><CategoryCell category={t.category} /></td>
                      <td><span className={`pill ${t.kind}`}>{KIND_LABEL[t.kind]}</span></td>
                      <td>{t.source === "sms" ? <span className="pill sms" title={t.account_hint ? `Account ending ${t.account_hint}` : undefined}>{(multi && nameOf(t.bank_id)) || "SMS"}</span> : <span className="pill">{t.source === "demo" ? "Demo" : (multi && nameOf(t.bank_id)) ? `${nameOf(t.bank_id)} · Manual` : "Manual"}</span>}</td>
                      <td className={`amt ${t.kind}`}>
                        {t.kind === "expense" ? "−" : "+"}{formatPaisa(t.amount_paisa).replace(" ", "\u00a0")}
                        {charges.length > 0 && <div className="charge-total">{totalLabel(t, charges)}</div>}
                      </td>
                      {!readOnly && (
                        <td><div className="row-actions">{canSplit(t) && <button className="btn sm" onClick={() => openSplit(t)} title="Split this payment with others">Split</button>}<button className="btn sm" onClick={() => edit(t)}>Edit</button><button className="btn sm danger" onClick={() => remove(t)}>Delete</button></div></td>
                      )}
                    </tr>
                    </Fragment>))}
                  </Fragment>))}
                </tbody>
              </table>
            </div>
            <div className="tx-cards">
              {days.map((g) => (<Fragment key={g.day}>
                <div className="day-head"><span>{dayLabelPkt(g.day)}</span><DayTotals items={g.items} /></div>
                {groupCharges(g.items).map(({ t, charges }) => (
                <div key={t.id} className={charges.length ? "tx-group" : "tx-group plain"}>
                <div className="tx-card" onClick={() => !readOnly && edit(t)} role={readOnly ? undefined : "button"} tabIndex={readOnly ? undefined : 0}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{t.counterparty ?? t.category}</div>
                    <div className="meta">{formatTimePkt(t.occurred_at)} · {isChargeCategory(t.category) ? <CategoryCell category={t.category} /> : t.category}{t.source === "sms" ? " · SMS" : ""}</div>
                    {charges.length > 0 && <div className="charge-badges">{charges.map((c) => <ChargeBadge key={c.id} c={c} onOpen={readOnly ? undefined : edit} />)}</div>}
                    <SplitBadge t={t} onOpen={readOnly ? undefined : openSplit} />
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div className={`amt ${t.kind}`} style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{t.kind === "expense" ? "−" : "+"}{formatPaisa(t.amount_paisa)}</div>
                    {charges.length > 0 && <div className="charge-total">{totalLabel(t, charges)}</div>}
                  </div>
                </div>
                </div>
                ))}
              </Fragment>))}
            </div>
            </>)}
            {pages > 1 && (
              <div className="toolbar" style={{ justifyContent: "space-between", marginTop: 14 }}>
                <span className="small muted">Page {page} of {pages}</span>
                <div className="toolbar">
                  <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Newer</button>
                  <button className="btn sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Older →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {editing && (
        <TxForm
          title={editing === "new" ? "Add transaction" : "Edit transaction"}
          submitLabel={editing === "new" ? "Add transaction" : "Save changes"}
          initial={editing === "new" ? draftFrom() : draftFrom(editing)}
          onClose={() => setEditing(null)}
          onSubmit={(d) => save(d, editing === "new" ? undefined : editing.id)}
          onDelete={editing === "new" ? undefined : () => destroy(editing.id)}
          children={editing !== "new" && !readOnly && canSplit(editing) ? (
            <div className="split-cta">
              <span className="small">{editing.split ? `Split with ${editing.split.n} ${editing.split.n === 1 ? "person" : "people"}` : "Paid for others too?"}</span>
              <button type="button" className="btn sm" onClick={() => openSplit(editing)}>{editing.split ? "See shares" : "Split this payment"}</button>
            </div>
          ) : undefined}
          extra={editing === "new" ? undefined : (d, fieldErrors) =>
            d.kind === "expense" && d.category !== "Bank charges" && d.category !== "Tax deducted" && (
              chargesEdit.field(d, fieldErrors.charges?.[0])
            )
          }
        />
      )}
      {splitting && <SplitForm billId={splitting} onClose={() => { setSplitting(null); reload(); }} onChanged={reload} />}
    </>
  );
}
