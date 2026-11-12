"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatPaisa, getDisplayCurrency, paisaToDecimal, parseAmountToPaisa } from "@/lib/money";
import { equalShares } from "@/lib/splits";
import { formatDatePkt } from "@/lib/time";
import { apiFetch, ApiError } from "./api";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import CloseButton from "./CloseButton";
import ReceiptModal from "./ReceiptModal";
import { useToast } from "./Toast";
import type { Share } from "./Splits";
import "@/app/splits.css";

type BillData = { owner: string | null; people: string[]; bill: { id: string; kind: string; amount_paisa: number; occurred_at: string; category: string; counterparty: string | null; note: string | null }; shares: Share[] };
type Row = { person: string; amount: string };

const whole = (p: number) => formatPaisa(p).replace(/\.00$/, "");
const amountText = (p: number) => paisaToDecimal(p).replace(/\.00$/, "");

/** Splits one payment into shares other people owe, and lists the shares it already has. */
export default function SplitForm({ billId, onClose, onChanged }: { billId: string; onClose: () => void; onChanged?: () => void }) {
  const { data, error, loading, reload } = useData<BillData>(`/api/splits?bill=${billId}`);
  const people = useData<{ items: { counterparty: string }[] }>("/api/recipients").data?.items ?? [];
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [count, setCount] = useState("2");
  const [includeMe, setIncludeMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Share | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const toast = useToast();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const receiptOpen = useRef(false);
  receiptOpen.current = !!receipt;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !receiptOpen.current && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const bill = data?.bill;
  const shares = data?.shares ?? [];
  // Start with one empty person when nothing is split yet; start the note from the payment.
  useEffect(() => {
    if (!data) return;
    setRows((r) => r ?? (data.shares.length ? [] : [{ person: "", amount: "" }]));
    setNote((n) => n ?? (data.shares[0]?.note ?? data.bill.note ?? data.bill.counterparty ?? ""));
  }, [data]);

  const list = rows ?? [];
  // People split with before come first, then everyone you've sent money to or received it from.
  const names = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of [...(data?.people ?? []), ...people.map((p) => p.counterparty)]) {
      const k = n.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(n.trim());
    }
    return out;
  }, [data, people]);
  const alreadyShared = shares.reduce((a, s) => a + s.amount_paisa, 0);
  const adding = list.reduce((a, r) => a + (parseAmountToPaisa(r.amount) ?? 0), 0);
  const mine = bill ? bill.amount_paisa - alreadyShared - adding : 0;

  function splitEqually() {
    if (!bill) return;
    const n = Math.min(30, Math.max(includeMe ? 2 : 1, Math.floor(Number(count)) || 2));
    const amounts = equalShares(bill.amount_paisa - alreadyShared, n, includeMe);
    setRows(amounts.map((a, i) => ({ person: list[i]?.person ?? "", amount: amountText(a) })));
  }
  const setRow = (i: number, k: keyof Row, v: string) => setRows(list.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const filled = list.filter((r) => r.person.trim() || r.amount.trim());
    if (!filled.length) return setErr("Add at least one person and their share.");
    const bad = filled.find((r) => !r.person.trim() || parseAmountToPaisa(r.amount) === null);
    if (bad) return setErr(!bad.person.trim() ? "Give each share a name." : `Enter ${bad.person}'s share as an amount like 1,500.`);
    if (mine < 0) return setErr(`The shares come to ${whole(-mine)} more than the payment.`);
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/splits", {
        method: "POST",
        body: JSON.stringify({ transactionId: billId, shares: filled.map((r) => ({ person: r.person.trim(), amount: r.amount, note: note || null })) }),
      });
      toast(filled.length === 1 ? `${filled[0].person.trim()} now owes you ${whole(parseAmountToPaisa(filled[0].amount)!)}` : `Split with ${filled.length} people`, "ok");
      setRows([]);
      reload();
      onChanged?.();
    } catch (ex) {
      setErr((ex as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Share) {
    try {
      await apiFetch(`/api/splits/${s.id}`, { method: "DELETE" });
      toast(`Removed ${s.person}'s share`, "ok");
      setConfirmDel(null);
      reload();
      onChanged?.();
    } catch (ex) {
      toast((ex as Error).message, "error");
    }
  }

  if (receipt) return <ReceiptModal share={receipt} owner={data?.owner ?? null} onClose={() => setReceipt(null)} />;

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal split-modal" role="dialog" aria-modal="true" aria-labelledby="split-title">
        <div className="modal-head">
          <div>
            <h2 id="split-title">Split this payment</h2>
            {bill && <div className="small muted">{bill.counterparty ?? bill.category} · {formatDatePkt(bill.occurred_at)} · {whole(bill.amount_paisa)}</div>}
          </div>
          <CloseButton onClick={onClose} />
        </div>
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading rows={3} /> : bill && bill.kind !== "expense" ? (
          <p className="muted">Only money you paid out can be split.</p>
        ) : bill && (
          <>
            {shares.length > 0 && (
              <div className="split-existing">
                <div className="split-sub">Owed to you on this payment</div>
                {shares.map((s) => (
                  <div key={s.id} className="split-share">
                    <div className="split-share-main">
                      <strong>{s.person}</strong>
                      <span className={`split-state ${s.state}`}>{s.state === "settled" ? "Paid back" : s.paid > 0 ? `${whole(s.amount_paisa - s.paid)} left` : "Owes you"}</span>
                    </div>
                    <span className="num">{whole(s.amount_paisa)}</span>
                    <div className="split-share-actions">
                      <button type="button" className="btn sm" onClick={() => setReceipt(s)}>Receipt</button>
                      {confirmDel === s.id ? (
                        <button type="button" className="btn sm danger-solid" onClick={() => remove(s)}>Remove?</button>
                      ) : (
                        <button type="button" className="btn ghost sm danger" onClick={() => setConfirmDel(s.id)} aria-label={`Remove ${s.person}'s share`}>Remove</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={save} noValidate>
              <div className="split-equal">
                <span>Split equally between</span>
                <input type="number" inputMode="numeric" min={1} max={30} value={count} onChange={(e) => setCount(e.target.value)} aria-label="Number of people" />
                <span>people</span>
                <label className="split-me"><input type="checkbox" checked={includeMe} onChange={(e) => setIncludeMe(e.target.checked)} /> including me</label>
                <button type="button" className="btn sm" onClick={splitEqually}>Fill in</button>
              </div>

              <div className="split-rows">
                {list.map((r, i) => (
                  <div key={i} className="split-row">
                    <NameCombo value={r.person} names={names} taken={list.map((x, j) => (j === i ? "" : x.person.trim().toLowerCase()))} onChange={(v) => setRow(i, "person", v)} label={`Person ${i + 1}`} />
                    <input inputMode="decimal" placeholder={`Amount (${getDisplayCurrency()})`} value={r.amount} onChange={(e) => setRow(i, "amount", e.target.value)} aria-label={`Share ${i + 1}`} />
                    <button type="button" className="btn ghost sm" onClick={() => setRows(list.filter((_, j) => j !== i))} aria-label={`Remove person ${i + 1}`}>✕</button>
                  </div>
                ))}
                <button type="button" className="btn ghost sm split-add" onClick={() => setRows([...list, { person: "", amount: "" }])}>+ Add a person</button>
              </div>

              <label className="field full" style={{ marginTop: 12 }}>What was it for? (shown on the receipt)
                <input maxLength={200} placeholder="e.g. Dinner at Kolachi" value={note ?? ""} onChange={(e) => setNote(e.target.value)} />
              </label>

              <div className={`split-mine${mine < 0 ? " over" : ""}`}>
                {mine < 0 ? <>The shares are <strong>{whole(-mine)}</strong> more than the payment</> : <>Your part: <strong>{whole(mine)}</strong>{alreadyShared + adding > 0 && <span className="muted"> · others owe {whole(alreadyShared + adding)}</span>}</>}
              </div>
              {err && <div className="alert error" style={{ marginTop: 12 }} role="alert">{err}</div>}
              <div className="modal-foot">
                <button type="button" className="btn" onClick={onClose}>{shares.length ? "Done" : "Cancel"}</button>
                <button type="submit" className="btn primary" disabled={busy || !list.length}>{busy ? "Saving…" : shares.length ? "Add shares" : "Split payment"}</button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/** Tidies a name as the bank prints it ("ALI RAZA" → "Ali Raza"); leaves mixed case alone. */
const tidy = (n: string) => (n === n.toUpperCase() ? n.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase()) : n);

/** A name box that searches past people and recipients as you type; any new name can be typed too. */
function NameCombo({ value, names, taken, onChange, label }: { value: string; names: string[]; taken: string[]; onChange: (v: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const id = useId();
  const q = value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const matches = names
    .filter((n) => !taken.includes(n.toLowerCase()) && n.toLowerCase() !== q)
    .map((n) => {
      const l = n.toLowerCase();
      const rank = !q ? 2 : l.startsWith(q) ? 0 : l.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : words.every((w) => l.includes(w)) ? 2 : -1;
      return { n, rank };
    })
    .filter((m) => m.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8)
    .map((m) => m.n);
  const show = open && matches.length > 0;
  const pick = (n: string) => { onChange(tidy(n)); setOpen(false); };
  return (
    <div className="name-combo">
      <input
        role="combobox"
        aria-expanded={show}
        aria-controls={id}
        aria-autocomplete="list"
        aria-label={label}
        autoComplete="off"
        placeholder="Name, e.g. Ali"
        maxLength={60}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % matches.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); }
          else if (e.key === "Enter") { e.preventDefault(); pick(matches[hi] ?? matches[0]); }
          else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
        }}
      />
      {show && (
        <ul className="name-combo-list" id={id} role="listbox">
          {matches.map((n, i) => (
            <li key={n} role="option" aria-selected={i === hi} className={i === hi ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); pick(n); }} onMouseEnter={() => setHi(i)}>{tidy(n)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
