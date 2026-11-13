"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatPaisa } from "@/lib/money";
import { formatDatePkt } from "@/lib/time";
import { apiFetch, resourceUrl } from "./api";
import { useData } from "./useData";
import { Empty, ErrorBox, Loading } from "./States";
import CloseButton from "./CloseButton";
import ReceiptModal from "./ReceiptModal";
import SplitForm from "./SplitForm";
import { billTitle } from "./receipt";
import { useToast } from "./Toast";
import type { Tx } from "./types";
import BankPicker, { useBankTag } from "./BankPicker";
import { useBanks } from "./useBanks";
import { useSelectedBank } from "./useSelectedBank";
import "@/app/monthly.css";
import "@/app/splits.css";

type InTx = { id: string; amount_paisa: number; occurred_at: string; counterparty: string | null; note: string | null };
export type Share = {
  id: string;
  transaction_id: string;
  person: string;
  amount_paisa: number;
  note: string | null;
  settled_at: string | null;
  settled_note: string | null;
  created_at: string;
  bill: { id: string; amount_paisa: number; occurred_at: string; category: string; counterparty: string | null; note: string | null; bank_id: string | null };
  shares_on_bill: number;
  shared_total: number;
  payments: (InTx & { kind: string })[];
  paid: number;
  state: "open" | "settled";
  settled_on: string | null;
};
type OpenShare = Share & { suggestion: (InTx & { score: number }) | null };
type Data = { owner: string | null; owed: number; open: OpenShare[]; settled: Share[]; settledCount: number };

const whole = (p: number) => formatPaisa(p).replace(/\.00$/, "");
const owedOn = (s: Share) => Math.max(0, s.amount_paisa - s.paid);

export default function Splits() {
  // A split belongs to the bank its payment went out of; with a bank picked, only its splits and cash ones show.
  const [bank] = useSelectedBank();
  const { nameOf } = useBanks();
  const bankTag = useBankTag();
  const { data, error, loading, reload } = useData<Data>(bank ? `/api/splits?bank=${encodeURIComponent(bank)}` : "/api/splits");
  const [receipt, setReceipt] = useState<Share | null>(null);
  const [linking, setLinking] = useState<Share | null>(null);
  const [billId, setBillId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const toast = useToast();

  // Open shares grouped by person, the one owing most first.
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; owed: number; shares: OpenShare[] }>();
    for (const s of data?.open ?? []) {
      const k = s.person.trim().toLowerCase();
      const g = m.get(k) ?? { name: s.person, owed: 0, shares: [] };
      g.owed += owedOn(s);
      g.shares.push(s);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.owed - a.owed);
  }, [data]);

  async function act(s: Share, body: object, msg: string) {
    try {
      await apiFetch(`/api/splits/${s.id}`, { method: "POST", body: JSON.stringify(body) });
      toast(msg, "ok");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  const link = (s: Share, t: InTx) => act(s, { action: "link", transactionId: t.id }, t.amount_paisa >= owedOn(s) * 0.98 ? `${s.person} paid you back ${whole(t.amount_paisa)}` : `${whole(t.amount_paisa)} from ${s.person} linked, ${whole(owedOn(s) - t.amount_paisa)} still to come`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bill splits</h1>
          <p className="muted">Paid for everyone? Split the payment, share a receipt, and tick each person off when their money comes in.</p>
        </div>
        <div className="toolbar">
          <BankPicker />
          <button className="btn primary" onClick={() => setPicking(true)}>+ Split a payment</button>
        </div>
      </div>

      {error ? <div className="card"><ErrorBox message={error} onRetry={reload} /></div> : loading && !data ? <div className="card"><Loading rows={4} label="Loading splits" /></div> : data && (
        <>
          <div className="card split-summary">
            <div>
              <div className="small muted">Owed to you{bank && bank !== "none" && nameOf(bank) ? ` · ${nameOf(bank)}` : bank === "none" ? " · cash" : ""}</div>
              <div className="split-owed num">{whole(data.owed)}</div>
            </div>
            <div className="small muted">
              {groups.length ? `${groups.length} ${groups.length === 1 ? "person" : "people"} · ${data.open.length} open ${data.open.length === 1 ? "share" : "shares"}` : "Nobody owes you anything"}
              {data.settledCount > 0 && ` · ${data.settledCount} paid back`}
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="card">
              <Empty icon="🧾" title="No open splits">
                <p className="muted">{bank ? "Nothing is owed on payments for the bank picked above. Pick All banks to see every split, or " : "When you pay a bill for a group, open it in Transactions and tap Split, or "}start here.</p>
                <p><button className="btn primary" onClick={() => setPicking(true)}>Split a payment</button></p>
              </Empty>
            </div>
          ) : (
            <div className="split-groups">
              {groups.map((g) => (
                <div key={g.name} className="card split-group">
                  <div className="split-person">
                    <span className="split-avatar" aria-hidden>{g.name.trim()[0]?.toUpperCase()}</span>
                    <strong>{g.name}</strong>
                    <span className="num split-person-owed">{whole(g.owed)}</span>
                  </div>
                  {g.shares.map((s) => (
                    <div key={s.id} className="split-item">
                      <div className="split-item-main">
                        <div className="split-item-title">{billTitle(s)}{!bank && bankTag(s.bill.bank_id) && <span className="pill sms" style={{ marginLeft: 6 }}>{bankTag(s.bill.bank_id)}</span>}</div>
                        <div className="small muted">
                          {formatDatePkt(s.bill.occurred_at)} · bill {whole(s.bill.amount_paisa)}
                          {s.paid > 0 && <> · <span className="mp-paid">{whole(s.paid)} paid</span></>}
                        </div>
                        {s.suggestion && (
                          <div className="mp-suggest split-suggest">
                            <span className="small">Looks like {s.suggestion.counterparty ?? "someone"} sent <strong>{whole(s.suggestion.amount_paisa)}</strong> on {formatDatePkt(s.suggestion.occurred_at)}</span>
                            <button className="btn sm primary" onClick={() => link(s, s.suggestion!)}>Link it</button>
                          </div>
                        )}
                      </div>
                      <div className="split-item-side">
                        <div className="num split-item-amt">{whole(owedOn(s))}</div>
                        <div className="split-item-actions">
                          <button className="btn sm" onClick={() => setReceipt(s)}>Receipt</button>
                          <button className="btn sm" onClick={() => setLinking(s)}>Paid back</button>
                          <button className="btn ghost sm" onClick={() => setBillId(s.transaction_id)}>Edit</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {data.settled.length > 0 && (
            <details className="card split-settled">
              <summary><strong>Paid back recently</strong> <span className="muted small">({data.settled.length})</span></summary>
              {data.settled.map((s) => (
                <div key={s.id} className="split-item settled">
                  <div className="split-item-main">
                    <div className="split-item-title">{s.person} <span className="split-state settled">Paid back</span></div>
                    <div className="small muted">
                      {billTitle(s)} · {s.settled_on ? formatDatePkt(s.settled_on) : ""}
                      {s.payments.length ? ` · from ${s.payments.map((p) => p.counterparty ?? "a transfer").join(", ")}` : s.settled_note ? ` · ${s.settled_note}` : " · marked by hand"}
                    </div>
                  </div>
                  <div className="split-item-side">
                    <div className="num split-item-amt">{whole(s.amount_paisa)}</div>
                    <div className="split-item-actions">
                      <button className="btn sm" onClick={() => setReceipt(s)}>Receipt</button>
                      <button className="btn ghost sm" onClick={() => setLinking(s)}>Details</button>
                    </div>
                  </div>
                </div>
              ))}
            </details>
          )}
        </>
      )}

      {receipt && <ReceiptModal share={receipt} owner={data?.owner ?? null} onClose={() => setReceipt(null)} />}
      {linking && <PaidBack share={linking} onClose={() => setLinking(null)} onDone={() => { setLinking(null); reload(); }} />}
      {billId && <SplitForm billId={billId} onClose={() => { setBillId(null); reload(); }} onChanged={reload} />}
      {picking && <BillPicker bank={bank} onClose={() => setPicking(false)} onPick={(t) => { setPicking(false); setBillId(t.id); }} />}
    </>
  );
}

function useEscape(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && ref.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function useDebounced(v: string, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v.trim()), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Link the incoming money that paid a share back, or settle it by hand (cash, or let off). */
function PaidBack({ share, onClose, onDone }: { share: Share; onClose: () => void; onDone: () => void }) {
  const [tab, setTab] = useState<"link" | "hand">(share.state === "settled" && share.settled_at ? "hand" : "link");
  const [q, setQ] = useState("");
  const search = useDebounced(q);
  const [note, setNote] = useState(share.settled_note ?? "");
  const toast = useToast();
  useEscape(onClose);
  const matches = useData<{ items: (InTx & { score: number })[] }>(tab === "link" && share.state === "open" ? `/api/splits/${share.id}?matches=1${search ? `&q=${encodeURIComponent(search)}` : ""}` : null);
  const left = owedOn(share);

  async function post(body: object, msg: string) {
    try {
      await apiFetch(`/api/splits/${share.id}`, { method: "POST", body: JSON.stringify(body) });
      toast(msg, "ok");
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  const items = matches.data?.items ?? [];
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="paid-title">
        <div className="modal-head">
          <div>
            <h2 id="paid-title">{share.person} · {billTitle(share)}</h2>
            <div className="small muted">Share {whole(share.amount_paisa)}{share.state === "open" && share.paid > 0 ? ` · ${whole(left)} still to pay` : ""}</div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {(share.payments.length > 0 || share.settled_at) && (
          <div className="mp-sofar">
            <div className="mp-sofar-head"><strong className="small">{share.state === "settled" ? "Paid back" : `Paid so far: ${whole(share.paid)}`}</strong></div>
            <div className="mp-parts">
              {share.payments.map((p) => (
                <div key={p.id} className="mp-part small">
                  <span>{formatDatePkt(p.occurred_at)} · {p.counterparty ?? "Transfer"} · <span className="num">{whole(p.amount_paisa)}</span></span>
                  <button className="btn ghost sm" onClick={() => post({ action: "unlink", transactionId: p.id }, `Unlinked ${whole(p.amount_paisa)}`)}>Unlink</button>
                </div>
              ))}
              {share.settled_at && (
                <div className="mp-part small">
                  <span>Marked as paid on {formatDatePkt(share.settled_at)}{share.settled_note ? ` · ${share.settled_note}` : ""}</span>
                  <button className="btn ghost sm" onClick={() => post({ action: "reopen" }, `${share.person}'s share is open again`)}>Undo</button>
                </div>
              )}
            </div>
          </div>
        )}

        {share.state === "open" && (
          <>
            <div className="seg mp-tabs" role="tablist">
              <button role="tab" aria-selected={tab === "link"} className={tab === "link" ? "on" : ""} onClick={() => setTab("link")}>Pick the money that came in</button>
              <button role="tab" aria-selected={tab === "hand"} className={tab === "hand" ? "on" : ""} onClick={() => setTab("hand")}>Paid another way</button>
            </div>
            {tab === "link" ? (
              <>
                <input className="mp-search" type="search" placeholder="Search incoming money by name, note or amount" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search incoming money" />
                {matches.error ? <ErrorBox message={matches.error} onRetry={matches.reload} /> : matches.loading && !matches.data ? <Loading rows={3} /> : items.length === 0 ? (
                  <p className="small muted">{search ? "No incoming money matches that search." : "No incoming money since the bill yet. When it arrives it shows up here, or mark it as paid another way."}</p>
                ) : (
                  <div className="mp-cands">
                    {items.map((t) => (
                      <button key={t.id} className="mp-cand" onClick={() => post({ action: "link", transactionId: t.id }, t.amount_paisa >= left * 0.98 ? `${share.person} paid you back` : `${whole(t.amount_paisa)} linked, ${whole(left - t.amount_paisa)} still to come`)}>
                        <span className="mp-cand-main">
                          <span>{t.counterparty ?? "Incoming transfer"}{t.score >= 60 && <span className="pill income" style={{ marginLeft: 6 }}>Likely</span>}</span>
                          <span className="small muted">{formatDatePkt(t.occurred_at)}{t.note ? ` · ${t.note}` : ""}</span>
                        </span>
                        <span className="num amt income">+{whole(t.amount_paisa)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <form className="mp-pane" onSubmit={(e) => { e.preventDefault(); post({ action: "settle", note: note || null }, `${share.person}'s share is settled`); }}>
                <p className="small muted">For a share paid in cash, or one you let go. It doesn&apos;t change your balance.</p>
                <label className="field">Note (optional)
                  <input maxLength={200} placeholder="e.g. Paid in cash" value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                <div className="toolbar" style={{ marginTop: 12 }}><button type="submit" className="btn primary">Mark as paid back</button></div>
              </form>
            )}
          </>
        )}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

/** Choose which payment to split: recent spending, searchable. */
function BillPicker({ bank, onClose, onPick }: { bank: string; onClose: () => void; onPick: (t: Tx) => void }) {
  const [q, setQ] = useState("");
  const search = useDebounced(q);
  useEscape(onClose);
  const { data, error, loading, reload } = useData<{ items: Tx[] }>(resourceUrl("app", "transactions", { kind: "expense", q: search, pageSize: 40, bank: bank || undefined }));
  const items = (data?.items ?? []).filter((t) => t.category !== "Bank charges" && t.category !== "Tax deducted");
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pick-title">
        <div className="modal-head">
          <div>
            <h2 id="pick-title">Which payment?</h2>
            <div className="small muted">Pick the bill you paid in full.{bank ? " Showing payments from the bank picked on the page." : ""}</div>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <input className="mp-search" type="search" placeholder="Search by name, note or amount" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payments" autoFocus />
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading rows={4} /> : items.length === 0 ? (
          <p className="small muted">{search ? "No spending matches that search." : "No spending yet."}</p>
        ) : (
          <div className="mp-cands">
            {items.map((t) => (
              <button key={t.id} className="mp-cand" onClick={() => onPick(t)}>
                <span className="mp-cand-main">
                  <span>{t.counterparty ?? t.category}{t.split && <span className="pill" style={{ marginLeft: 6 }}>Split</span>}</span>
                  <span className="small muted">{formatDatePkt(t.occurred_at)} · {t.category}{t.note ? ` · ${t.note}` : ""}</span>
                </span>
                <span className="num">{whole(t.amount_paisa)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
