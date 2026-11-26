"use client";
import "@/app/security.css";
import { useState } from "react";
import { formatDatePkt } from "@/lib/time";
import { apiFetch, CancelledError } from "./api";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";

type Token = { id: string; name: string; hint: string; scope: "read" | "write"; created_at: string; last_used_at: string | null; use_count: number; last_client: string | null };
type Status = { ok: true; serverUrl: string; tokens: Token[]; maxTokens: number };
type Made = { token: string; connectorUrl: string; serverUrl: string; name: string; scope: "read" | "write" };
type App = "claude" | "chatgpt" | "grok";

function Copy({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <div className="wa-copy">
      <code>{value}</code>
      <button type="button" className="btn sm" onClick={() => navigator.clipboard.writeText(value).then(() => toast(`${label} copied`, "ok"), () => toast("Couldn't copy. Select it and copy by hand.", "error"))}>Copy</button>
    </div>
  );
}

const APPS: { id: App; label: string }[] = [{ id: "claude", label: "Claude" }, { id: "chatgpt", label: "ChatGPT" }, { id: "grok", label: "Grok" }];

/** Where to paste the connector address in each app. Kept short; docs/ai-apps.md has the long version. */
function Steps({ app }: { app: App }) {
  if (app === "claude") return (
    <ol className="small ai-steps">
      <li>On claude.ai (or the Claude app), open <b>Customize › Connectors</b> and choose <b>Add custom connector</b>.</li>
      <li>Name it Mizan and paste the connector address above as the URL. Leave sign-in as <b>No sign-in</b>, then <b>Add</b>.</li>
      <li>In a chat, turn Mizan on under <b>+ › Connectors</b> and ask &ldquo;How much did I spend on groceries this month?&rdquo;</li>
    </ol>
  );
  if (app === "chatgpt") return (
    <ol className="small ai-steps">
      <li>On chatgpt.com, with <b>Developer mode</b> on (it depends on your plan), open <b>Plugins</b> (chatgpt.com/plugins), press <b>+</b> and choose <b>Add custom MCP server</b>.</li>
      <li>Name it Mizan and paste the connector address as the <b>Server URL</b>.</li>
      <li>Set authentication to <b>No authentication</b> (the token is already in the address), accept the warning and create it.</li>
      <li>Pick Mizan from the <b>+</b> menu in a chat and ask away. ChatGPT asks before it runs a tool that adds an expense.</li>
    </ol>
  );
  return (
    <ol className="small ai-steps">
      <li>On grok.com, open <b>Connectors</b> (grok.com/connectors), choose <b>New Connector › Custom</b>.</li>
      <li>Paste the connector address as the MCP server URL and save. No sign-in is needed.</li>
      <li>For the xAI API instead, use the server address with the token as <code>authorization</code>: <code>{"{ type: \"mcp\", server_label: \"mizan\", server_url, authorization: \"Bearer mzn_…\" }"}</code>.</li>
    </ol>
  );
}

/** Settings › AI apps: tokens that let Claude, ChatGPT or Grok read Mizan (and add expenses, if allowed) over MCP. */
export default function AiApps() {
  const { data, error, loading, reload } = useData<Status>("/api/ai-access");
  const [local, setLocal] = useState<Status | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [made, setMade] = useState<Made | null>(null);
  const [app, setApp] = useState<App>("claude");
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const s = local ?? data;

  async function refresh() {
    setLocal(await apiFetch<Status>("/api/ai-access"));
  }

  async function create() {
    setBusy("create");
    try {
      const r = await apiFetch<Made>("/api/ai-access", { method: "POST", body: JSON.stringify({ name: name.trim() || "AI app", scope }) });
      setMade({ ...r, name: name.trim() || "AI app", scope });
      setName("");
      await refresh();
    } catch (e) {
      if (!(e instanceof CancelledError)) toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(t: Token) {
    if (!window.confirm(`Revoke “${t.name}”? The AI app using it loses access straight away.`)) return;
    setBusy(t.id);
    try {
      await apiFetch(`/api/ai-access/${t.id}`, { method: "DELETE" });
      toast(`${t.name} revoked`, "ok");
      await refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !s) return <Loading rows={4} />;
  if (!s) return null;

  return (
    <>
      <div className="set-row column">
        <div className="set-text">
          <div className="set-title">Ask Claude, ChatGPT or Grok about your money</div>
          <div className="set-hint">
            Mizan has an MCP server: connect it to an AI app and ask things like &ldquo;What did I spend on food last month?&rdquo; or &ldquo;Add 1,200 for petrol&rdquo;.
            Each app gets its own token, which you can revoke here at any time. Read-only tokens can look but never change anything.
          </div>
        </div>
      </div>

      {made && (
        <div className="set-row column">
          <div className="wa-code">
            <div className="set-title">Token for {made.name} ({made.scope === "write" ? "read + add expenses" : "read-only"})</div>
            <div className="small"><b>Copy it now.</b> Mizan keeps only a fingerprint of it, so it can&apos;t be shown again.</div>
            <div className="wa-field">
              <span className="set-title">Connector address</span>
              <span className="set-hint">For Claude, ChatGPT and Grok: paste this one address. It includes the token, so treat it like a password.</span>
              <Copy value={made.connectorUrl} label="Connector address" />
            </div>
            <div className="wa-field">
              <span className="set-title">Or: server address + token</span>
              <span className="set-hint">For apps that take a header (Claude Code, the xAI or OpenAI APIs): send <code>Authorization: Bearer &lt;token&gt;</code>.</span>
              <Copy value={made.serverUrl} label="Server address" />
              <Copy value={made.token} label="Token" />
            </div>
            <div className="set-tabs seg" role="tablist" aria-label="App">
              {APPS.map((a) => <button key={a.id} type="button" role="tab" aria-selected={app === a.id} className={app === a.id ? "on" : ""} onClick={() => setApp(a.id)}>{a.label}</button>)}
            </div>
            <Steps app={app} />
            <div><button className="btn sm" onClick={() => setMade(null)}>Done, I&apos;ve copied it</button></div>
          </div>
        </div>
      )}

      <div className="set-row column">
        <div className="set-text">
          <div className="set-title">Connected apps</div>
          <div className="set-hint">Revoke a token when you stop using an app, or if the address was shared by mistake.</div>
        </div>
        <div className="dev-list">
          {s.tokens.map((t) => (
            <div key={t.id} className="dev">
              <div className="dev-text">
                <div className="dev-name">{t.name} <span className={`dev-tag${t.scope === "write" ? " on" : ""}`}>{t.scope === "write" ? "Read + add expenses" : "Read-only"}</span></div>
                <div className="dev-meta">
                  …{t.hint} · made {formatDatePkt(t.created_at)}
                  {t.last_used_at ? ` · last used ${formatDatePkt(t.last_used_at)}${t.last_client ? ` by ${t.last_client}` : ""} · ${t.use_count} requests` : " · not used yet"}
                </div>
              </div>
              <div className="wa-actions">
                <button className="btn sm danger" disabled={!!busy} onClick={() => revoke(t)}>{busy === t.id ? "Revoking…" : "Revoke"}</button>
              </div>
            </div>
          ))}
          {s.tokens.length === 0 && <div className="small muted">No AI apps connected yet.</div>}
        </div>
      </div>

      {s.tokens.length < s.maxTokens && (
        <div className="set-row column">
          <div className="set-text">
            <div className="set-title">Connect an app</div>
            <div className="set-hint">Making a token asks for your passphrase.</div>
          </div>
          <div className="wa-grid">
            <label className="wa-field">
              <span className="set-title">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude, ChatGPT, Grok" maxLength={60} autoComplete="off" />
            </label>
            <label className="wa-field">
              <span className="set-title">Access</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as "read" | "write")}>
                <option value="read">Read-only: look up spending and balances</option>
                <option value="write">Read + add expenses</option>
              </select>
            </label>
          </div>
          <div><button className="btn primary" disabled={!!busy} onClick={create}>{busy === "create" ? "Making…" : "Make token"}</button></div>
        </div>
      )}
    </>
  );
}
