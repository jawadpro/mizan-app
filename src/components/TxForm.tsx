"use client";
import { useEffect, useRef, useState } from "react";
import { CATEGORIES, KIND_LABEL, KINDS, type Kind } from "@/lib/categories";
import { paisaToDecimal } from "@/lib/money";
import { dateToPktLocal } from "@/lib/time";
import { ApiError } from "./api";
import { useData } from "./useData";
import type { SetAside } from "./types";

export type TxDraft = { kind: Kind; amount: string; occurredAt: string; category: string; counterparty: string; note: string; setAsideId: string | null };

export function draftFrom(t?: Partial<{ kind: Kind | null; amount_paisa: number | null; occurred_at: string | null; category: string | null; counterparty: string | null; note: string | null; set_aside_id: string | null }>): TxDraft {
  const kind = t?.kind ?? "expense";
  return {
    kind,
    amount: t?.amount_paisa ? paisaToDecimal(t.amount_paisa) : "",
    occurredAt: dateToPktLocal(t?.occurred_at ?? new Date()),
    category: t?.category && CATEGORIES[kind].includes(t.category) ? t.category : t?.category ?? (kind === "expense" ? "Groceries" : kind === "income" ? "Salary" : "Family support"),
    counterparty: t?.counterparty ?? "",
    note: t?.note ?? "",
    setAsideId: t?.set_aside_id ?? null,
  };
}

export default function TxForm({
  title, initial, submitLabel, onSubmit, onClose, children, extra,
}: {
  title: string;
  initial: TxDraft;
  submitLabel: string;
  onSubmit: (d: TxDraft) => Promise<void>;
  onClose: () => void;
  children?: React.ReactNode;
  /** Extra inputs shown at the end of the form; receives the server's field errors. */
  extra?: (d: TxDraft, fieldErrors: Record<string, string[]>) => React.ReactNode;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const first = useRef<HTMLSelectElement>(null);
  const funds = useData<{ items: SetAside[] }>("/api/set-asides").data?.items ?? [];
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cats = Array.from(new Set([...CATEGORIES[d.kind], ...(d.category ? [d.category] : [])]));
  const set = (k: keyof TxDraft, v: string) => setD((x) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setFields({});
    try {
      await onSubmit(d);
    } catch (ex) {
      const a = ex as ApiError;
      setErr(a.message);
      setFields(a.fields ?? {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="txform-title">
        <div className="modal-head">
          <h2 id="txform-title">{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <label className="field">Type
              <select ref={first} value={d.kind} onChange={(e) => { const k = e.target.value as Kind; setD((x) => ({ ...x, kind: k, category: CATEGORIES[k].includes(x.category) ? x.category : CATEGORIES[k][0] })); }}>
                {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="field">Amount (PKR)
              <input inputMode="decimal" placeholder="e.g. 2,450.00" value={d.amount} onChange={(e) => set("amount", e.target.value)} required aria-invalid={!!fields.amount} />
              {fields.amount && <span className="err">{fields.amount[0]}</span>}
            </label>
            <label className="field">Date & time (PKT)
              <input type="datetime-local" value={d.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} required aria-invalid={!!fields.occurredAt} />
              {fields.occurredAt && <span className="err">{fields.occurredAt[0]}</span>}
            </label>
            <label className="field">Category
              <select value={d.category} onChange={(e) => set("category", e.target.value)}>
                {cats.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field full">{d.kind === "expense" ? "Paid to (recipient or merchant)" : "Received from"}
              <input maxLength={120} placeholder={d.kind === "expense" ? "e.g. Ammi, K-Electric, Imtiaz" : "e.g. Employer, Bhai"} value={d.counterparty} onChange={(e) => set("counterparty", e.target.value)} />
            </label>
            {d.kind === "expense" && funds.length > 0 && (
              <label className="field full">Paid from a set-aside?
                <select value={d.setAsideId ?? ""} onChange={(e) => setD((x) => ({ ...x, setAsideId: e.target.value || null }))}>
                  <option value="">No, regular spending</option>
                  {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                {fields.setAsideId && <span className="err">{fields.setAsideId[0]}</span>}
              </label>
            )}
            <label className="field full">Note
              <textarea rows={2} maxLength={500} value={d.note} onChange={(e) => set("note", e.target.value)} />
            </label>
            {extra?.(d, fields)}
          </div>
          {err && <div className="alert error" style={{ marginTop: 14 }} role="alert">{err}</div>}
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
