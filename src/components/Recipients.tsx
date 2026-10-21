"use client";
import { useMemo, useRef, useState } from "react";
import { formatPaisa } from "@/lib/money";
import { formatDatePkt } from "@/lib/time";
import { resourceUrl, type Space } from "./api";
import { useData } from "./useData";
import { Empty, ErrorBox, Loading } from "./States";
import Transactions from "./Transactions";
import type { Recipient } from "./types";

export default function Recipients({ space }: { space: Space }) {
  const { data, error, loading, reload } = useData<{ items: Recipient[] }>(resourceUrl(space, "recipients"));
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const items = useMemo(
    () => (data?.items ?? []).filter((r) => r.counterparty.toLowerCase().includes(filter.toLowerCase())),
    [data, filter],
  );
  const detailRef = useRef<HTMLDivElement>(null);
  // On a phone the history sits below the list, so bring it into view after a tap.
  const pick = (name: string) => {
    setSelected(name);
    if (window.matchMedia("(max-width: 720px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };
  const sel = items.find((r) => r.counterparty === selected) ?? data?.items.find((r) => r.counterparty === selected);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Recipients</h1>
          <p className="muted">Everyone you pay or receive from, with totals and full history.</p>
        </div>
        <input type="search" placeholder="Filter recipients…" aria-label="Filter recipients" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="grid two">
        <div className="card">
          {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading rows={8} /> : items.length === 0 ? (
            <Empty icon="👥" title={filter ? "No recipient matches" : "No recipients yet"}>
              <p>Transactions with a recipient or sender name appear here.</p>
            </Empty>
          ) : (
            <>
            <div className="tx-cards">
              {items.map((r) => (
                <button key={r.counterparty} type="button" className={`tx-card tap${r.counterparty === selected ? " selected" : ""}`} onClick={() => pick(r.counterparty)}>
                  <div style={{ minWidth: 0, textAlign: "left" }}>
                    <div style={{ fontWeight: 600 }}>{r.counterparty}</div>
                    <div className="meta">{r.n} {r.n === 1 ? "transaction" : "transactions"} · last {formatDatePkt(r.last_at)}</div>
                  </div>
                  <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {r.sent ? <div className="amt expense num">−{formatPaisa(r.sent)}</div> : null}
                    {r.received ? <div className="amt income num">+{formatPaisa(r.received)}</div> : null}
                  </div>
                </button>
              ))}
            </div>
            <div className="table-wrap responsive">
              <table className="tx">
                <thead><tr><th>Name</th><th className="amt">Sent</th><th className="amt">Received</th><th className="amt">Count</th><th>Last</th></tr></thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.counterparty} onClick={() => setSelected(r.counterparty)} style={{ cursor: "pointer", background: r.counterparty === selected ? "var(--sage-soft)" : undefined }}>
                      <td><button className="btn ghost sm" style={{ padding: 0, fontWeight: 600 }} onClick={() => setSelected(r.counterparty)}>{r.counterparty}</button></td>
                      <td className="amt expense">{r.sent ? formatPaisa(r.sent) : "—"}</td>
                      <td className="amt income">{r.received ? formatPaisa(r.received) : "—"}</td>
                      <td className="amt">{r.n}</td>
                      <td className="small muted" style={{ whiteSpace: "nowrap" }}>{formatDatePkt(r.last_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
        <div ref={detailRef} style={{ scrollMarginTop: 72 }}>
          {sel ? (
            <div className="grid" style={{ gap: 12 }}>
              <div className="card">
                <h2>{sel.counterparty}</h2>
                <p className="muted small" style={{ margin: "4px 0 12px" }}>Since {formatDatePkt(sel.first_at)}</p>
                <div className="grid half" style={{ gap: 10 }}>
                  <div><div className="small muted">Total sent</div><div className="num amt expense" style={{ fontSize: "1.2rem", fontWeight: 600 }}>{formatPaisa(sel.sent)}</div></div>
                  <div><div className="small muted">Total received</div><div className="num amt income" style={{ fontSize: "1.2rem", fontWeight: 600 }}>{formatPaisa(sel.received)}</div></div>
                </div>
              </div>
              <Transactions key={sel.counterparty} space={space} fixedCounterparty={sel.counterparty} />
            </div>
          ) : (
            <div className="card hide-mobile"><Empty icon="👈" title="Pick a recipient">See every transfer to and from them.</Empty></div>
          )}
        </div>
      </div>
    </>
  );
}
