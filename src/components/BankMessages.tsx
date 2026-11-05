"use client";
import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, KIND_LABEL, KINDS, OWN_ACCOUNTS, type Kind } from "@/lib/categories";
import { formatPaisa } from "@/lib/money";
import { formatDatePkt, formatTimePkt } from "@/lib/time";
import { AI_MODELS, type Prefs } from "@/lib/preferences";
import { compileTemplate, readWithTemplate, type SmsTemplate } from "@/lib/sms/templates";
import { apiFetch } from "./api";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";

type Row = SmsTemplate & { key: number };
type KeyStatus = { saved: boolean; ending: string | null };
const blank = (key: number): Row => ({ key, bank: "", sender: "", kind: "expense", category: null, example: "", payee: "" });
const PROVIDER_LABEL = { claude: "Claude", openai: "OpenAI" } as const;
const KEY_HELP = {
  claude: "Create one at console.anthropic.com under API keys.",
  openai: "Create one at platform.openai.com under API keys.",
} as const;

function Check({ row }: { row: Row }) {
  const out = useMemo(() => {
    if (row.example.trim().length < 15) return null;
    const c = compileTemplate(row);
    if (!c.ok) return { ok: false as const, text: c.error };
    const r = readWithTemplate({ ...row, sender: "" }, { sender: "", text: row.example, receivedAt: new Date() });
    if (!r) return { ok: false as const, text: "This example can't be read. Check that it's a completed payment, not an OTP or a pending one." };
    const when = r.dateSource === "message" ? ` on ${formatDatePkt(r.occurredAt)}${r.hasExplicitTime ? ` ${formatTimePkt(r.occurredAt)}` : ""}` : "";
    const who = r.counterparty ? ` ${r.kind === "expense" ? "to" : "from"} ${r.counterparty}` : "";
    return { ok: true as const, text: `Reads: ${formatPaisa(r.amountPaisa).replace(/\.00$/, "")} ${KIND_LABEL[r.kind].toLowerCase()}${who}${when} · ${r.category}` };
  }, [row]);
  if (!out) return <div className="tpl-check muted">Paste an example to check it.</div>;
  return <div className={`tpl-check ${out.ok ? "ok" : "bad"}`}>{out.ok ? "✓ " : ""}{out.text}</div>;
}

export default function BankMessages({ p, save }: { p: Prefs; save: (patch: Partial<Prefs>) => Promise<void> }) {
  const toast = useToast();
  const saved = useData<{ items: SmsTemplate[] }>("/api/sms-templates");
  const keys = useData<{ keys: Record<"claude" | "openai", KeyStatus> }>("/api/ai");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<string | null>(null);
  const provider = p.aiProvider;
  const model = provider === "claude" ? p.aiModelClaude : p.aiModelOpenai;
  const [modelInput, setModelInput] = useState(model);
  useEffect(() => setModelInput(model), [model]);

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
  async function saveKey() {
    try {
      await apiFetch("/api/ai", { method: "PUT", body: JSON.stringify({ provider, key: keyInput }) });
      setKeyInput("");
      toast(`${PROVIDER_LABEL[provider]} key saved`, "ok");
      keys.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function removeKey() {
    if (!window.confirm(`Remove the saved ${PROVIDER_LABEL[provider]} key?`)) return;
    try {
      await apiFetch("/api/ai", { method: "DELETE", body: JSON.stringify({ provider }) });
      toast("Key removed", "ok");
      keys.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const r = await apiFetch<{ reading: { amountPaisa: number; kind: Kind; counterparty: string | null; category: string } | null; why: string | null }>("/api/ai", { method: "POST", body: JSON.stringify({ provider }) });
      setTest(r.reading ? `✓ It works. Read the sample as ${formatPaisa(r.reading.amountPaisa).replace(/\.00$/, "")} ${KIND_LABEL[r.reading.kind].toLowerCase()} at ${r.reading.counterparty ?? "an unknown payee"} · ${r.reading.category}` : `Connected, but: ${r.why}`);
    } catch (e) {
      setTest(`✕ ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  const key = keys.data?.keys[provider];
  const cats = (k: Kind) => CATEGORIES[k].filter((c) => c !== OWN_ACCOUNTS);

  return (
    <>
      <div className="set-row column">
        <div className="set-text">
          <div className="set-title">Other banks’ messages</div>
          <div className="set-hint">MCB alerts are read automatically. For another bank, add one row per kind of message (for example, card payment, money received). Paste one real message, with any account number replaced by ****. Later messages worded the same way are read automatically.</div>
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
                  <label className="field">Sender (optional)<input value={r.sender} maxLength={64} placeholder="As it shows in Messages" onChange={(e) => update(r.key, { sender: e.target.value })} /></label>
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
                <Check row={r} />
              </div>
            ))}
            <div className="toolbar">
              <button className="btn sm" onClick={() => { setRows([...rows, blank(nextKey())]); setDirty(true); }} disabled={rows.length >= 30}>+ Add a message type</button>
              {(dirty || rows.length > 0) && <button className="btn sm primary" onClick={saveTemplates} disabled={busy || !dirty}>{busy ? "Saving…" : dirty ? "Save message types" : "Saved"}</button>}
            </div>
            <p className="small muted" style={{ margin: 0 }}>Also add an iPhone Shortcut automation for that bank’s sender, the same way as in <a href="/app/sms">SMS setup</a>.</p>
          </div>
        )}
      </div>

      <div className="set-row">
        <div className="set-text">
          <div className="set-title">Read unknown messages with AI</div>
          <div className="set-hint">When neither MCB rules nor your message types match, the message is sent to the AI you choose, using your own API key. Account numbers and balances are hidden first. This costs a little per message on your AI account.</div>
        </div>
        <div className="set-control"><button type="button" role="switch" aria-checked={p.aiEnabled} aria-label="Read unknown messages with AI" className={`switch${p.aiEnabled ? " on" : ""}`} onClick={() => save({ aiEnabled: !p.aiEnabled })}><span className="knob" aria-hidden /></button></div>
      </div>
      {p.aiEnabled && (
        <div className="ai-box">
          <Row2 title="AI provider">
            <div className="seg" role="group" aria-label="AI provider">
              {(["claude", "openai"] as const).map((x) => <button key={x} className={provider === x ? "on" : ""} onClick={() => { setTest(null); save({ aiProvider: x }); }}>{PROVIDER_LABEL[x]}</button>)}
            </div>
          </Row2>
          <Row2 title="Model" hint={provider === "claude" ? "Haiku is cheapest and is usually enough for SMS." : undefined}>
            <span className="ai-model">
              <input list={`models-${provider}`} value={modelInput} onChange={(e) => setModelInput(e.target.value)} aria-label="Model"
                onBlur={() => modelInput.trim() && modelInput !== model && save(provider === "claude" ? { aiModelClaude: modelInput.trim() } : { aiModelOpenai: modelInput.trim() })} />
              <datalist id={`models-${provider}`}>{AI_MODELS[provider].map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
            </span>
          </Row2>
          <Row2 title={`${PROVIDER_LABEL[provider]} API key`} hint={key?.saved ? `Saved, ending in …${key.ending}. It's stored encrypted and never shown again.` : KEY_HELP[provider]}>
            <span className="ai-key">
              <input type="password" autoComplete="off" value={keyInput} placeholder={key?.saved ? "Paste a new key to replace it" : "Paste your API key"} onChange={(e) => setKeyInput(e.target.value)} aria-label="API key" />
              <button className="btn sm primary" onClick={saveKey} disabled={keyInput.trim().length < 20}>Save key</button>
              {key?.saved && <button className="btn sm danger" onClick={removeKey}>Remove</button>}
            </span>
          </Row2>
          <Row2 title="Import AI results directly" hint="Off: AI results wait in the Review inbox for you to confirm. On: they're added straight to your transactions.">
            <button type="button" role="switch" aria-checked={p.aiAutoImport} aria-label="Import AI results directly" className={`switch${p.aiAutoImport ? " on" : ""}`} onClick={() => save({ aiAutoImport: !p.aiAutoImport })}><span className="knob" aria-hidden /></button>
          </Row2>
          <div className="ai-test">
            <button className="btn sm" onClick={runTest} disabled={testing || !key?.saved}>{testing ? "Testing…" : "Test with a sample message"}</button>
            {test && <span className={`small ${test.startsWith("✓") ? "ink-ok" : "ink-bad"}`}>{test}</span>}
          </div>
        </div>
      )}
    </>
  );
}

function Row2({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row sub">
      <div className="set-text"><div className="set-title">{title}</div>{hint && <div className="set-hint">{hint}</div>}</div>
      <div className="set-control">{children}</div>
    </div>
  );
}
