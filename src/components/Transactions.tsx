"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ALL_CATEGORIES, KIND_LABEL, KINDS } from "@/lib/categories";
import { formatPaisa } from "@/lib/money";
import { formatDatePkt, formatTimePkt } from "@/lib/time";
import { apiFetch, resourceUrl, type Space } from "./api";
import { useData } from "./useData";
import { Empty, ErrorBox, Loading } from "./States";
import TxForm, { draftFrom, type TxDraft } from "./TxForm";
import ChargesField from "./ChargesField";
import { useToast } from "./Toast";
import type { Tx } from "./types";

type List = { items: Tx[]; total: number; page: number; pageSize: number; sums: { expense: number; income: number; remittance: number } };

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
  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Tx | "new" | null>(null);
  const [charges, setCharges] = useState("");
  const edit = (t: Tx | "new") => { setCharges(""); setEditing(t); };
  const dq = useDebounced(q);
  const filters = { q: dq, kind, category, source, from, to, counterparty: fixedCounterparty };
  useEffect(() => setPage(1), [dq, kind, category, source, from, to]);
  const url = resourceUrl(space, "transactions", { ...filters, page, pageSize: 25 });
  const { data, error, loading, reload } = useData<List>(url);
  const readOnly = space === "demo";
  const hasFilters = !!(dq || kind || category || source || from || to);

  async function save(d: TxDraft, id?: string) {
    const withCharges = !!id && d.kind === "expense" && charges.trim() !== "";
    await apiFetch(id ? `/api/transactions/${id}` : "/api/transactions", { method: id ? "PATCH" : "POST", body: JSON.stringify(withCharges ? { ...d, charges } : d) });
    setEditing(null);
    toast(withCharges ? "Updated, with the bank charges as a separate expense." : id ? "Transaction updated" : "Transaction added", "ok");
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
            <a className="btn" href={resourceUrl(space, "export", filters)} download>Export CSV</a>
            {readOnly ? (
              <button className="btn primary" disabled title="The demo is read-only. Sign in to your private workspace to add transactions.">+ Add transaction</button>
            ) : (
              <button className="btn primary" onClick={() => setEditing("new")}>+ Add transaction</button>
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
            <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            {hasFilters && <button className="btn ghost sm" onClick={() => { setQ(""); setKind(""); setCategory(""); setSource(""); setFrom(""); setTo(""); }}>Clear</button>}
          </div>
          {data && (
            <div className="small muted" style={{ marginTop: 10 }}>
              {data.total} result{data.total === 1 ? "" : "s"} · <span className="amt expense">{formatPaisa(data.sums.expense)}</span> out · <span className="amt income">{formatPaisa(data.sums.income)}</span> income · <span className="amt remittance">{formatPaisa(data.sums.remittance)}</span> remittances
            </div>
          )}
        </div>
      )}

      <div className="card">
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading rows={8} label="Loading transactions" /> : data && data.items.length === 0 ? (
          <Empty icon={hasFilters ? "🔍" : "🌱"} title={hasFilters ? "Nothing matches these filters" : "No transactions yet"}>
            {!hasFilters && !readOnly && <p><button className="btn primary" onClick={() => setEditing("new")}>Add your first transaction</button></p>}
          </Empty>
        ) : (
          <>
            <div className="table-wrap responsive">
              <table className="tx">
                <thead>
                  <tr><th>Date</th><th>Recipient / source</th><th>Category</th><th>Type</th><th>Source</th><th className="amt">Amount</th>{!readOnly && <th><span className="sr-only">Actions</span></th>}</tr>
                </thead>
                <tbody style={{ opacity: loading ? 0.55 : 1 }}>
                  {data!.items.map((t) => (
                    <tr key={t.id}>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>{formatDatePkt(t.occurred_at)}<div className="small muted">{formatTimePkt(t.occurred_at)}</div></td>
                      <td>{t.counterparty ?? <span className="muted">—</span>}{t.note && <div className="small muted">{t.note}</div>}</td>
                      <td>{t.category}</td>
                      <td><span className={`pill ${t.kind}`}>{KIND_LABEL[t.kind]}</span></td>
                      <td>{t.source === "sms" ? <span className="pill sms" title={t.account_hint ? `Account ending ${t.account_hint}` : undefined}>SMS</span> : <span className="pill">{t.source === "demo" ? "Demo" : "Manual"}</span>}</td>
                      <td className={`amt ${t.kind}`}>{t.kind === "expense" ? "−" : "+"}{formatPaisa(t.amount_paisa).replace("Rs ", "Rs ")}</td>
                      {!readOnly && (
                        <td><div className="row-actions"><button className="btn sm" onClick={() => edit(t)}>Edit</button><button className="btn sm danger" onClick={() => remove(t)}>Delete</button></div></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="tx-cards">
              {data!.items.map((t) => (
                <div key={t.id} className="tx-card" onClick={() => !readOnly && edit(t)} role={readOnly ? undefined : "button"} tabIndex={readOnly ? undefined : 0}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{t.counterparty ?? t.category}</div>
                    <div className="meta">{formatDatePkt(t.occurred_at)} · {t.category}{t.source === "sms" ? " · SMS" : ""}</div>
                  </div>
                  <div className={`amt ${t.kind}`} style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{t.kind === "expense" ? "−" : "+"}{formatPaisa(t.amount_paisa)}</div>
                </div>
              ))}
            </div>
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
          extra={editing === "new" ? undefined : (d, fieldErrors) =>
            d.kind === "expense" && d.category !== "Bank charges" && (
              <ChargesField title="Add bank charges / tax" amount={d.amount} value={charges} onChange={setCharges} error={fieldErrors.charges?.[0]} />
            )
          }
        />
      )}
    </>
  );
}
