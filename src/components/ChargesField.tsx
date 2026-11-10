"use client";
import { useState } from "react";
import { currencySymbol, formatPaisa, paisaToDecimal, parseAmountToPaisa } from "@/lib/money";
import type { TxDraft } from "./TxForm";
import type { Tx } from "./types";
import "@/app/charges.css";

export type ChargesKind = "fee" | "tax";
type Vals = Record<ChargesKind, string>;

/**
 * The charges box state for a transaction's edit form. It starts from the bank charge and tax already
 * added on the transfer, so the box shows them, and only sends the kinds that were changed.
 */
export function useChargesEdit() {
  const [orig, setOrig] = useState<Vals>({ fee: "", tax: "" });
  const [vals, setVals] = useState<Vals>({ fee: "", tax: "" });
  const [kind, setKind] = useState<ChargesKind>("fee");
  const start = (t: Tx | "new" | null) => {
    const fee = t && t !== "new" && t.charge_fee_paisa ? paisaToDecimal(t.charge_fee_paisa) : "";
    const tax = t && t !== "new" && t.charge_tax_paisa ? paisaToDecimal(t.charge_tax_paisa) : "";
    setOrig({ fee, tax });
    setVals({ fee, tax });
    setKind(!fee && tax ? "tax" : "fee");
  };
  const changed = (["fee", "tax"] as const).filter((k) => vals[k].trim() !== orig[k]);
  /** The PATCH body for a save: the draft, plus the charge boxes that were changed. */
  const body = (d: TxDraft) => (d.kind === "expense" && changed.length ? { ...d, chargeEdits: Object.fromEntries(changed.map((k) => [k, vals[k].trim()])) } : d);
  const toastFor = (d: TxDraft) => {
    if (d.kind !== "expense" || !changed.length) return null;
    const what = changed.length > 1 ? "bank charges and tax" : changed[0] === "tax" ? "tax" : "bank charges";
    return changed.every((k) => !vals[k].trim()) ? `Updated, and the ${what} removed.` : `Updated, with the ${what} as a separate expense.`;
  };
  const field = (d: TxDraft, error?: string) => (
    <ChargesField
      title={orig.fee || orig.tax ? "Bank charges / tax" : "Add bank charges / tax"}
      amount={d.amount}
      value={vals[kind]}
      onChange={(v) => setVals((x) => ({ ...x, [kind]: v }))}
      kind={kind}
      onKindChange={setKind}
      error={error}
      hadValue={!!orig[kind]}
    />
  );
  return { start, body, toastFor, field };
}

/** The bank charges / tax box shown at the end of a transfer's form. Saved as its own "Bank charges" or "Tax deducted" expense. */
export default function ChargesField({ amount, value, onChange, error, title, kind, onKindChange, hadValue }: {
  amount: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  title: string;
  kind: ChargesKind;
  onKindChange: (k: ChargesKind) => void;
  /** The transfer already has this charge; clearing the box removes it. */
  hadValue?: boolean;
}) {
  const charge = value.trim() ? parseAmountToPaisa(value) : null;
  const base = parseAmountToPaisa(amount);
  // Once the box holds a valid amount again, the server's earlier complaint no longer applies.
  const showError = !!error && charge === null;
  return (
    <div className="full charges-box">
      <div className="charges-head">
        <span className="charges-icon" aria-hidden="true">%</span>
        <div>
          <label htmlFor="charges-input" className="charges-title">{title}</label>
          <div className="small muted">{hadValue ? "Already added on this transfer. Change it here, or clear it to remove it." : "Banks usually don\u2019t send an SMS for it. Leave empty if there was none."}</div>
        </div>
      </div>
      <div className="charges-kind" role="radiogroup" aria-label="What was it?">
        <button type="button" role="radio" aria-checked={kind === "fee"} className={kind === "fee" ? "on" : ""} onClick={() => onKindChange("fee")}>Bank fee</button>
        <button type="button" role="radio" aria-checked={kind === "tax"} className={kind === "tax" ? "on" : ""} onClick={() => onKindChange("tax")}>Tax deducted</button>
      </div>
      <div className={`charges-input${showError ? " invalid" : ""}`}>
        <span>{currencySymbol()}</span>
        <input id="charges-input" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={showError} />
      </div>
      {showError ? <div className="err">{error}</div> : charge && base ? (
        <div className="charges-total">Total out of your account: <strong>{formatPaisa(base + charge)}</strong></div>
      ) : (
        <div className="small muted">{kind === "tax" ? "Saved as a separate “Tax deducted” expense on the same date, so tax stays apart from bank fees." : "Saved as a separate “Bank charges” expense on the same date."}</div>
      )}
    </div>
  );
}
