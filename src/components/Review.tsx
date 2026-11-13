"use client";
import { useState } from "react";
import { KIND_LABEL } from "@/lib/categories";
import { formatPaisa, getDisplayCurrency } from "@/lib/money";
import { formatDatePkt, formatTimePkt } from "@/lib/time";
import { apiFetch, resourceUrl, REVIEW_CHANGED, type Space } from "./api";
import { useData } from "./useData";
import { Empty, ErrorBox, Loading } from "./States";
import TxForm, { draftFrom, type TxDraft } from "./TxForm";
import { useBanks } from "./useBanks";
import PushToggle from "./PushToggle";
import ImportQueue from "./ImportQueue";
import ChargesField, { type ChargesKind } from "./ChargesField";
import { useToast } from "./Toast";
import type { ReviewItem } from "./types";
import { findCharges } from "@/lib/sms/parser";
import { ACCOUNT_UNCLEAR, bankDigits } from "@/lib/banks";

/** A charge the alert itself names ("and Tax/Charges 5.00") fills the charges box, ready to confirm. */
function chargesIn(it: ReviewItem): string {
  const c = it.kind === "expense" && it.redacted_text ? findCharges(it.redacted_text, getDisplayCurrency()) : null;
  return c ? (c / 100).toFixed(2) : "";
}

export default function Review({ space }: { space: Space }) {
  const { data, error, loading, reload } = useData<{ items: ReviewItem[] }>(resourceUrl(space, "review"));
  const [confirming, setConfirming] = useState<ReviewItem | null>(null);
  const [charges, setCharges] = useState("");
  const [chargesKind, setChargesKind] = useState<ChargesKind>("fee");
  const [remember, setRemember] = useState(true);
  const toast = useToast();
  const readOnly = space === "demo";
  const { banks, nameOf } = useBanks(space);
  /** Digits from the alert that the picked bank doesn't have saved yet, so they can be remembered on it. */
  const newDigits = (item: ReviewItem, bankId: string | null) => {
    const b = bankId ? banks.find((x) => x.id === bankId) : null;
    return b && item.account_hint && !bankDigits(b).includes(item.account_hint) ? { bank: b, digits: item.account_hint } : null;
  };

  async function confirm(item: ReviewItem, d: TxDraft) {
    const withCharges = d.kind === "expense" && charges.trim() !== "";
    const rememberAccount = remember && !!newDigits(item, d.bankId);
    await apiFetch(`/api/review/${item.id}`, { method: "POST", body: JSON.stringify({ action: "confirm", transaction: d, charges: withCharges ? charges : undefined, chargesKind: withCharges ? chargesKind : undefined, rememberAccount }) });
    setConfirming(null);
    toast(withCharges ? `Confirmed, with the ${chargesKind === "tax" ? "tax" : "bank charges"} as a separate expense.` : "Confirmed. It now counts in your analytics.", "ok");
    reload();
    window.dispatchEvent(new Event(REVIEW_CHANGED));
  }
  async function dismiss(item: ReviewItem) {
    if (!window.confirm("Dismiss this alert? It won't be imported and its stored excerpt is deleted.")) return;
    try {
      await apiFetch(`/api/review/${item.id}`, { method: "POST", body: JSON.stringify({ action: "dismiss" }) });
      toast("Dismissed", "ok");
      reload();
      window.dispatchEvent(new Event(REVIEW_CHANGED));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Review inbox</h1>
          <p className="muted">SMS alerts Mizan couldn&apos;t read with confidence. They&apos;re left out of analytics until you confirm them.</p>
        </div>
      </div>
      {!readOnly && <PushToggle />}
      {!readOnly && <ImportQueue onImported={reload} />}
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <div className="card"><Loading rows={5} /></div> : data && data.items.length === 0 ? (
        <div className="card"><Empty icon="✅" title="All caught up">No alerts are waiting for review.</Empty></div>
      ) : (
        <div className="grid" style={{ gap: 12 }}>
          {data!.items.map((it) => (
            <div key={it.id} className="card">
              <div className="card-head">
                <div>
                  <span className="pill warn">{it.reason}</span>
                  <div className="small muted" style={{ marginTop: 6 }}>From {it.sender ?? "unknown sender"}{nameOf(it.bank_id) ? ` (${nameOf(it.bank_id)})` : ""} · received {formatDatePkt(it.received_at)}, {formatTimePkt(it.received_at)}</div>
                </div>
                <div className="toolbar">
                  <button className="btn danger sm" disabled={readOnly} onClick={() => dismiss(it)}>Dismiss</button>
                  <button className="btn primary sm" disabled={readOnly} title={readOnly ? "The demo is read-only" : undefined} onClick={() => { setCharges(chargesIn(it)); setChargesKind("fee"); setRemember(true); setConfirming(it); }}>Review & confirm</button>
                </div>
              </div>
              {it.redacted_text && <div className="redacted" aria-label="Redacted SMS text">{it.redacted_text}</div>}
              <div className="toolbar small muted" style={{ marginTop: 10 }}>
                <span>Read so far:</span>
                <span>{it.kind ? KIND_LABEL[it.kind] : "type unknown"}</span>·
                <span>{it.amount_paisa ? formatPaisa(it.amount_paisa) : "amount unknown"}</span>·
                <span>{it.counterparty ?? "no recipient"}</span>
                {it.account_hint && <>·<span>A/C ****{it.account_hint}</span></>}
              </div>
            </div>
          ))}
        </div>
      )}
      {confirming && (
        <TxForm
          title="Confirm SMS transaction"
          submitLabel="Confirm & import"
          initial={draftFrom({ ...confirming, occurred_at: confirming.occurred_at ?? confirming.received_at })}
          onClose={() => setConfirming(null)}
          onSubmit={(d) => confirm(confirming, d)}
          extra={(d, fieldErrors) => {
            const learn = newDigits(confirming, d.bankId);
            return (
              <>
                {d.kind === "expense" && (
                  <ChargesField title="Bank charges / tax" amount={d.amount} value={charges} onChange={setCharges} kind={chargesKind} onKindChange={setChargesKind} error={fieldErrors.charges?.[0]} />
                )}
                {learn && (
                  <label className="full small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" style={{ width: "auto", margin: 0 }} checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    Remember ••{learn.digits} for {learn.bank.name}, so its next alerts go there on their own
                  </label>
                )}
              </>
            );
          }}
        >
          <div className="alert warn" style={{ marginBottom: 14 }}>
            <span>
              Check every field against the message. Nothing missing has been guessed.
              {confirming.reason.startsWith(ACCOUNT_UNCLEAR) && " Pick the account it belongs to under Bank."}
            </span>
          </div>
          {confirming.redacted_text && <div className="redacted" style={{ marginBottom: 14 }}>{confirming.redacted_text}</div>}
        </TxForm>
      )}
    </>
  );
}
