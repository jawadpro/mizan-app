"use client";
import { currencySymbol, formatPaisa, parseAmountToPaisa } from "@/lib/money";
import "@/app/charges.css";

export type ChargesKind = "fee" | "tax";

/** The bank charges / tax box shown at the end of a transfer's form. Saved as its own "Bank charges" or "Tax deducted" expense. */
export default function ChargesField({ amount, value, onChange, error, title, kind, onKindChange }: {
  amount: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  title: string;
  kind: ChargesKind;
  onKindChange: (k: ChargesKind) => void;
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
          <div className="small muted">Banks usually don&apos;t send an SMS for it. Leave empty if there was none.</div>
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
