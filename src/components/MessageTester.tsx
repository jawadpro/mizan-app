"use client";
import { useMemo, useState } from "react";
import { KIND_LABEL } from "@/lib/categories";
import { formatPaisa, getDisplayCurrency } from "@/lib/money";
import { formatDatePkt, formatTimePkt } from "@/lib/time";
import { readAlert } from "@/lib/sms/read";
import { findDate, monthFirstFor } from "@/lib/sms/parser";
import type { SmsWords } from "@/lib/sms/keywords";
import { useData } from "./useData";
import type { BankItem } from "./useBanks";

const EXAMPLE = "e.g. PKR 2,450.00 debited from A/C ****1234 on 15-10-2026 at 14:22 at FOODPANDA. Avl Bal PKR 85,301.17";

/** Paste any alert to see how Mizan would read it with the saved settings. Runs in the browser; nothing is saved. */
export default function MessageTester({ ownNames, version }: { ownNames: string; version: number }) {
  const banks = useData<{ items: BankItem[] }>(`/api/banks?v=${version}`).data?.items;
  const words = useData<{ words: SmsWords }>(`/api/sms-words?v=${version}`).data?.words;
  const [text, setText] = useState("");
  const [sender, setSender] = useState("");

  const out = useMemo(() => {
    if (!banks || text.trim().length < 10) return null;
    const names = ownNames.split(",").map((x) => x.trim()).filter(Boolean);
    // Read it as if it had just arrived, so an older example isn't flagged for its date.
    const currency = getDisplayCurrency();
    const d = findDate(text, monthFirstFor(currency));
    const receivedAt = d ? new Date(Date.UTC(d.y, d.m, d.d, d.hh ?? 12, (d.mm ?? 0) + 1) - 5 * 3600e3) : new Date();
    return readAlert({ sender, text, receivedAt }, { banks, words, ownNames: names, currency });
  }, [banks, words, ownNames, sender, text]);

  const r = out?.result;
  const f = r && r.status !== "ignored" ? r.fields : null;
  const none = (s = "not found") => <span className="muted">{s}</span>;

  return (
    <div className="set-row column">
      <div className="set-text">
        <div className="set-title">Test a message</div>
        <div className="set-hint">Paste an alert from any bank to see what Mizan reads from it, using your saved banks, name and words. Nothing is saved.</div>
      </div>
      <div className="tester">
        <label className="field">Message
          <textarea rows={3} maxLength={1000} value={text} placeholder={EXAMPLE} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="field">Sender <span className="hint">As it shows in Messages</span>
          <input value={sender} maxLength={64} placeholder="e.g. your bank's short code" onChange={(e) => setSender(e.target.value)} />
        </label>
      </div>
      {r && (
        <div className="tester-out" aria-live="polite">
          <div className={`tester-verdict ${r.status}`}>
            {r.status === "parsed" ? "✓ Would be imported" : r.status === "review" ? `Goes to Review · ${r.reason}` : `Ignored · ${r.reason}`}
          </div>
          {f && (
            <dl className="tester-fields">
              <dt>Bank</dt><dd>{out!.bank?.name ?? (out!.choices.length ? <span className="muted">you pick: {out!.choices.map((b) => b.name).join(", ")}</span> : none("not one of your banks"))}</dd>
              <dt>Type</dt><dd>{f.kind ? KIND_LABEL[f.kind] : none("unclear")}</dd>
              <dt>Amount</dt><dd className="num">{f.amountPaisa ? formatPaisa(f.amountPaisa) : none()}</dd>
              <dt>{f.kind === "expense" ? "Paid to" : "From"}</dt><dd>{f.counterparty ?? none()}</dd>
              {f.kind === "expense" && f.chargesPaisa ? (
                <><dt>Bank charges</dt><dd className="num">{formatPaisa(f.chargesPaisa)} <span className="muted">saved as its own expense · {formatPaisa((f.amountPaisa ?? 0) + f.chargesPaisa)} out in total</span></dd></>
              ) : null}
              <dt>Category</dt><dd>{f.category ?? (f.kind ? "Uncategorized" : none())}</dd>
              <dt>Date</dt><dd className="num">{f.occurredAt ? `${formatDatePkt(f.occurredAt)}${f.hasExplicitTime ? `, ${formatTimePkt(f.occurredAt)}` : ""}` : none("time it arrives")}</dd>
              <dt>Account</dt><dd className="num">{f.accountHint ? `••${f.accountHint}` : none()}</dd>
              <dt>Bank reference</dt><dd className="num">{f.bankRef ?? none()}</dd>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
