"use client";
import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, KIND_LABEL, KINDS, OWN_ACCOUNTS, type Kind } from "@/lib/categories";
import { formatPaisa } from "@/lib/money";
import { formatDatePkt, formatTimePkt } from "@/lib/time";
import { compileTemplate, readWithTemplate, type SmsTemplate } from "@/lib/sms/templates";
import { MCB_DEFAULT_TEMPLATES } from "@/lib/sms/mcb-defaults";
import { apiFetch } from "./api";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";

type Row = SmsTemplate & { key: number };
const blank = (key: number): Row => ({ key, bank: "", sender: "", kind: "expense", category: null, example: "", payee: "", hold: false });
const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
function Check({ row }: { row: Row }) {
  const out = useMemo(() => {
    if (row.example.trim().length < 15) return null;
    const c = compileTemplate(row);
    if (!c.ok) return { ok: false as const, text: c.error };
    const r = readWithTemplate({ ...row, sender: "" }, { sender: "", text: row.example, receivedAt: new Date() });
    if (!r) return { ok: false as const, text: "This example can't be read. Check that it's a completed payment, not an OTP or a pending one." };
    const when = r.dateSource === "message" ? ` on ${formatDatePkt(r.occurredAt)}${r.hasExplicitTime ? ` ${formatTimePkt(r.occurredAt)}` : ""}` : "";
    const who = r.counterparty ? ` ${r.kind === "expense" ? "to" : "from"} ${r.counterparty}` : "";
    return { ok: true as const, text: `Reads: ${formatPaisa(r.amountPaisa).replace(/\.00$/, "")} ${KIND_LABEL[r.kind].toLowerCase()}${who}${when} · ${r.category}${row.hold ? " · waits in Review" : ""}` };
  }, [row]);
  if (!out) return <div className="tpl-check muted">Paste an example to check it.</div>;
  return <div className={`tpl-check ${out.ok ? "ok" : "bad"}`}>{out.ok ? "✓ " : ""}{out.text}</div>;
}

export default function BankMessages() {
  const toast = useToast();
  const saved = useData<{ items: SmsTemplate[] }>("/api/sms-templates");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (saved.data && rows === null) setRows(saved.data.items.map((t, i) => ({ ...t, key: i })));
  }, [saved.data, rows]);

  const nextKey = () => Math.max(0, ...(rows ?? []).map((r) => r.key)) + 1;
  const update = (key: number, patch: Partial<Row>) => {
    setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  async function saveTemplates() {
    setBusy(true);
    try {
      const items = rows!.filter((r) => r.bank.trim() || r.example.trim()).map(({ key: _k, ...t }) => t);
      const res = await apiFetch<{ items: SmsTemplate[] }>("/api/sms-templates", { method: "PUT", body: JSON.stringify({ items }) });
      setRows(res.items.map((t, i) => ({ ...t, key: i })));
      setDirty(false);
      toast("Message types saved", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  const cats = (k: Kind) => CATEGORIES[k].filter((c) => c !== OWN_ACCOUNTS);
  const missingMcb = rows ? MCB_DEFAULT_TEMPLATES.filter((d) => !rows.some((r) => sameText(r.example, d.example))) : [];
  function addMcbDefaults() {
    let k = nextKey();
    setRows([...rows!, ...missingMcb.map((d) => ({ ...d, key: k++ }))].slice(0, 30));
    setDirty(true);
  }

  return (
    <>
      <div className="set-row column">
        <div className="set-text">
          <div className="set-title">Bank messages</div>
          <div className="set-hint">One row per kind of message (for example, card payment, money received), for MCB or any other bank. MCB’s usual messages are already here; change them if MCB rewords an alert. Paste one real message, with any account number replaced by ****. Later messages worded the same way are read automatically. MCB alerts that fit no row still go through Mizan’s built-in MCB rules.</div>
        </div>
        {saved.error ? <ErrorBox message={saved.error} onRetry={saved.reload} /> : !rows ? <Loading rows={2} /> : (
          <div className="tpl-list">
            {rows.map((r, i) => (
              <div key={r.key} className="tpl">
                <div className="tpl-head">
                  <span className="small muted">Message type {i + 1}</span>
                  <button className="btn ghost sm" onClick={() => { setRows(rows.filter((x) => x.key !== r.key)); setDirty(true); }}>Remove</button>
                </div>
                <div className="tpl-grid">
                  <label className="field">Bank<input value={r.bank} maxLength={60} placeholder="e.g. HBL" onChange={(e) => update(r.key, { bank: e.target.value })} /></label>
                  <label className="field">Sender (optional)<input value={r.sender} maxLength={64} placeholder="As in Messages; MCB*, 6222" title="Separate several with commas. End with * to match any name starting with it." onChange={(e) => update(r.key, { sender: e.target.value })} /></label>
                  <label className="field">Type
                    <select value={r.kind} onChange={(e) => { const k = e.target.value as Kind; update(r.key, { kind: k, category: r.category && cats(k).includes(r.category) ? r.category : null }); }}>
                      {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </label>
                  <label className="field">Category
                    <select value={r.category ?? ""} onChange={(e) => update(r.key, { category: e.target.value || null })} disabled={r.kind === "remittance"}>
                      <option value="">Work it out from the payee</option>
                      {cats(r.kind).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                </div>
                <label className="field">Example message
                  <textarea rows={3} maxLength={1000} value={r.example} placeholder="PKR 2,450.00 debited from your A/C ****1234 at FOODPANDA on 15-Oct-2026 14:22. Avl Bal PKR 85,301.17" onChange={(e) => update(r.key, { example: e.target.value })} />
                </label>
                <label className="field">Payee in this example (optional)
                  <input value={r.payee} maxLength={120} placeholder="Copy it from the message, e.g. FOODPANDA" onChange={(e) => update(r.key, { payee: e.target.value })} />
                </label>
                <label className="tpl-hold small">
                  <input type="checkbox" checked={!!r.hold} onChange={(e) => update(r.key, { hold: e.target.checked })} />
                  Always send to Review first (for transfers that may carry a bank charge)
                </label>
                <Check row={r} />
              </div>
            ))}
            <div className="toolbar">
              <button className="btn sm" onClick={() => { setRows([...rows, blank(nextKey())]); setDirty(true); }} disabled={rows.length >= 30}>+ Add a message type</button>
              {missingMcb.length > 0 && rows.length + missingMcb.length <= 30 && <button className="btn sm ghost" onClick={addMcbDefaults}>Add MCB defaults ({missingMcb.length})</button>}
              {(dirty || rows.length > 0) && <button className="btn sm primary" onClick={saveTemplates} disabled={busy || !dirty}>{busy ? "Saving…" : dirty ? "Save message types" : "Saved"}</button>}
            </div>
            <p className="small muted" style={{ margin: 0 }}>Also add an iPhone Shortcut automation for that bank’s sender, the same way as in <a href="/app/sms">SMS setup</a>.</p>
          </div>
        )}
      </div>
    </>
  );
}
