"use client";
import "@/app/security.css";
import { useEffect, useState } from "react";
import { formatDatePkt } from "@/lib/time";
import { apiFetch, CancelledError } from "./api";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";
import PasswordInput from "./PasswordInput";

type LinkedNumber = { id: string; phone: string; display: string; name: string; linked_at: string; last_message_at: string | null; message_count: number };
type Status = {
  ok: true;
  ready: { meta: boolean; ai: boolean };
  webhookUrl: string;
  verifyToken: string;
  phoneNumberId: string | null;
  accessToken: string | null;
  appSecret: string | null;
  anthropicKey: string | null;
  model: string;
  models: { id: string; label: string; hint: string }[];
  fromEnv: Record<"phoneNumberId" | "accessToken" | "appSecret" | "verifyToken" | "anthropicKey" | "model", boolean>;
  numbers: LinkedNumber[];
  maxNumbers: number;
};
type Draft = { phoneNumberId?: string; accessToken?: string; appSecret?: string; anthropicKey?: string; model?: string };

function Copy({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <div className="wa-copy">
      <code>{value}</code>
      <button type="button" className="btn sm" onClick={() => navigator.clipboard.writeText(value).then(() => toast(`${label} copied`, "ok"), () => toast("Couldn't copy. Select it and copy by hand.", "error"))}>Copy</button>
    </div>
  );
}

function KeyField({ label, hint, saved, env, value, onChange, secret = true, placeholder }: {
  label: string; hint?: React.ReactNode; saved: string | null; env: boolean; value: string | undefined; onChange: (v: string) => void; secret?: boolean; placeholder?: string;
}) {
  const ph = env ? "Set on the server" : saved ? `Saved (${saved}). Paste to replace` : placeholder ?? "";
  return (
    <label className="wa-field">
      <span className="set-title">{label}</span>
      {hint && <span className="set-hint">{hint}</span>}
      {secret
        ? <PasswordInput value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={ph} disabled={env} autoComplete="off" spellCheck={false} />
        : <input value={value ?? saved ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={ph} disabled={env} autoComplete="off" spellCheck={false} inputMode="numeric" />}
    </label>
  );
}

/** Settings › WhatsApp: the keys the bot needs, the address to give Meta, and the numbers that may talk to it. */
export default function WhatsAppSettings() {
  const { data, error, loading, reload } = useData<Status>("/api/whatsapp");
  const [local, setLocal] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; minutes: number; count: number } | null>(null);
  const toast = useToast();
  const s = local ?? data;

  // While a code is on screen, check every few seconds for the number that sends it.
  useEffect(() => {
    if (!code) return;
    const t = setInterval(async () => {
      try {
        const next = await apiFetch<Status>("/api/whatsapp");
        setLocal(next);
        if (next.numbers.length > code.count) {
          setCode(null);
          toast("Number linked", "ok");
        }
      } catch {
        // keep trying quietly
      }
    }, 4000);
    const stop = setTimeout(() => setCode(null), code.minutes * 60_000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [code, toast]);

  async function run<T>(key: string, fn: () => Promise<T>, done?: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (done) toast(done, "ok");
      return r;
    } catch (e) {
      if (!(e instanceof CancelledError)) toast((e as Error).message, "error");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const body: Draft = {};
    for (const [k, v] of Object.entries(draft) as [keyof Draft, string | undefined][]) if (v !== undefined) body[k] = v.trim();
    const r = await run("save", () => apiFetch<Status>("/api/whatsapp", { method: "PUT", body: JSON.stringify(body) }), "WhatsApp settings saved");
    if (r) {
      setLocal(r);
      setDraft({});
    }
  }

  async function makeCode() {
    const r = await run("code", () => apiFetch<{ code: string; minutes: number }>("/api/whatsapp", { method: "POST", body: JSON.stringify({ action: "code" }) }));
    if (r && s) setCode({ code: r.code, minutes: r.minutes, count: s.numbers.length });
  }

  async function unlink(n: LinkedNumber) {
    const ok = await run(n.id, () => apiFetch(`/api/whatsapp/${n.id}`, { method: "DELETE" }), `${n.display} unlinked`);
    if (ok !== null) setLocal(await apiFetch<Status>("/api/whatsapp"));
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !s) return <Loading rows={5} />;
  if (!s) return null;
  const dirty = Object.values(draft).some((v) => v !== undefined);
  const set = (k: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <>
      <div className="set-row column">
        <div className="set-text">
          <div className="set-title">
            Status{" "}
            <span className={`dev-tag${s.ready.meta ? " on" : ""}`}>{s.ready.meta ? (s.ready.ai ? "Ready · AI chat" : "Ready · commands") : "Not set up"}</span>
          </div>
          <div className="set-hint">
            {s.ready.meta
              ? s.ready.ai
                ? "Messages from linked numbers are answered by Claude using your Mizan data. Changes always wait for you to reply YES."
                : "Messages from linked numbers are answered in free command mode (send help to the bot to see the commands). Add an Anthropic key below for full chat."
              : "Fill in the Meta keys below, then give Meta the webhook address and verify token."}
          </div>
        </div>
      </div>

      <div className="set-row column">
        <div className="set-text">
          <div className="set-title">Linked numbers</div>
          <div className="set-hint">Only these WhatsApp numbers get answers. Anyone else is told the number isn&apos;t linked and sees nothing.</div>
        </div>
        <div className="dev-list">
          {s.numbers.map((n) => (
            <div key={n.id} className="dev">
              <div className="dev-text">
                <div className="dev-name">{n.name} <span className="muted">{n.display}</span></div>
                <div className="dev-meta">linked {formatDatePkt(n.linked_at)}{n.last_message_at ? ` · last message ${formatDatePkt(n.last_message_at)} · ${n.message_count} messages` : " · no messages yet"}</div>
              </div>
              <div className="wa-actions">
                <button className="btn sm" disabled={!!busy || !s.ready.meta} onClick={() => run(`t${n.id}`, () => apiFetch("/api/whatsapp", { method: "POST", body: JSON.stringify({ action: "test", numberId: n.id }) }), "Test message sent")}>
                  {busy === `t${n.id}` ? "Sending…" : "Test"}
                </button>
                <button className="btn sm danger" disabled={!!busy} onClick={() => unlink(n)}>{busy === n.id ? "Unlinking…" : "Unlink"}</button>
              </div>
            </div>
          ))}
          {s.numbers.length === 0 && !code && <div className="small muted">No numbers linked yet.</div>}
          {code ? (
            <div className="wa-code">
              <div className="small">From the WhatsApp you want to link, send this message to your bot&apos;s number within {code.minutes} minutes:</div>
              <Copy value={`link ${code.code}`} label="Message" />
              <div className="small muted">Waiting for it… This updates by itself.</div>
            </div>
          ) : s.numbers.length < s.maxNumbers && (
            <div><button className="btn sm" disabled={!!busy} onClick={makeCode}>{busy === "code" ? "Making a code…" : "Link a number"}</button></div>
          )}
        </div>
      </div>

      <div className="set-row column">
        <div className="set-text">
          <div className="set-title">Meta WhatsApp Cloud API</div>
          <div className="set-hint">
            From your app at developers.facebook.com › WhatsApp › API Setup. Use a permanent token from a System User, as the temporary one stops after a day.
          </div>
        </div>
        <div className="wa-grid">
          <KeyField label="Phone number ID" secret={false} saved={s.phoneNumberId} env={s.fromEnv.phoneNumberId} value={draft.phoneNumberId} onChange={set("phoneNumberId")} placeholder="e.g. 106540352242922" />
          <KeyField label="Access token" saved={s.accessToken} env={s.fromEnv.accessToken} value={draft.accessToken} onChange={set("accessToken")} placeholder="EAAG…" />
          <KeyField label="App secret" hint="App settings › Basic. Used to check each message really comes from Meta." saved={s.appSecret} env={s.fromEnv.appSecret} value={draft.appSecret} onChange={set("appSecret")} />
        </div>
        <div className="wa-field">
          <span className="set-title">Webhook address</span>
          <span className="set-hint">Paste in Meta under WhatsApp › Configuration › Webhook, then subscribe to <b>messages</b>.</span>
          <Copy value={s.webhookUrl} label="Webhook address" />
        </div>
        <div className="wa-field">
          <span className="set-title">Verify token</span>
          <Copy value={s.verifyToken} label="Verify token" />
        </div>
      </div>

      <div className="set-row column">
        <div className="set-text">
          <div className="set-title">AI chat (optional)</div>
          <div className="set-hint">
            Without a key the bot is free and answers set commands (&ldquo;food this month&rdquo;, &ldquo;split 3000 dinner with Ali&rdquo;, &ldquo;who owes me&rdquo;). With an Anthropic key it understands any question. You pay Anthropic per message: Haiku costs a fraction of a rupee each. Get a key at console.anthropic.com.
          </div>
        </div>
        <div className="wa-grid">
          <KeyField label="Anthropic API key" saved={s.anthropicKey} env={s.fromEnv.anthropicKey} value={draft.anthropicKey} onChange={set("anthropicKey")} placeholder="sk-ant-…" />
          <label className="wa-field">
            <span className="set-title">Model</span>
            <select value={draft.model ?? s.model} onChange={(e) => set("model")(e.target.value)} disabled={s.fromEnv.model}>
              {s.models.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.hint}</option>)}
            </select>
          </label>
        </div>
        {s.anthropicKey && !s.fromEnv.anthropicKey && (
          <div><button className="btn sm ghost" disabled={!!busy} onClick={() => setDraft((d) => ({ ...d, anthropicKey: "" }))}>Remove the key (back to free command mode)</button></div>
        )}
      </div>

      <div className="wa-save">
        <button className="btn primary" disabled={!dirty || !!busy} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
        {dirty && <button className="btn ghost" disabled={!!busy} onClick={() => setDraft({})}>Discard</button>}
        <span className="small muted">Keys are stored encrypted. Saving asks for your passphrase.</span>
      </div>
    </>
  );
}
