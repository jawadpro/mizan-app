"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORIES, KIND_LABEL, type Kind } from "@/lib/categories";
import { formatPaisa, paisaToDecimal } from "@/lib/money";
import { addDays, dayKeyPkt, formatDatePkt } from "@/lib/time";
import { balancesAddUp, parseStatement, StatementError, type Statement, type StatementRow } from "@/lib/statement";
import { reconcile, suggestEntry, type BookEntry } from "@/lib/reconcile";
import { apiFetch, resourceUrl } from "./api";
import { bankLabel, useBanks } from "./useBanks";
import { useSelectedBank } from "./useSelectedBank";
import { ErrorBox, Loading } from "./States";
import TxForm, { draftFrom, type TxDraft } from "./TxForm";
import { useToast } from "./Toast";
import type { Tx } from "./types";
import "@/app/reconcile.css";

/** `loose`: saved without a bank, so it counts toward no bank's balance (it can still be the statement's row). */
type Entry = BookEntry & { tx: Tx; loose: boolean };
type Choice = { kind: Kind; category: string };

const MAX_PAGES = 50;
const dateLabel = (iso: string) => formatDatePkt(`${iso}T07:00:00Z`);

/** Every Mizan transaction between two days (for one bank, when given), across as many pages as it takes. */
async function loadEntries(from: string, to: string, bank: string): Promise<Entry[]> {
  const out: Entry[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await apiFetch<{ items: Tx[]; total: number; pageSize: number }>(resourceUrl("app", "transactions", { from, to, bank: bank || undefined, page, pageSize: 200 }));
    for (const tx of res.items) out.push({ id: tx.id, kind: tx.kind, amount_paisa: tx.amount_paisa, day: dayKeyPkt(tx.occurred_at), tx, loose: bank !== "" && tx.bank_id === null });
    if (page * res.pageSize >= res.total) break;
  }
  return out;
}

export default function Reconcile() {
  const { banks, multi } = useBanks();
  const [selected] = useSelectedBank();
  const [bank, setBank] = useState("");
  const [fileName, setFileName] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [editing, setEditing] = useState<StatementRow | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // With several banks the statement belongs to one of them: start on the bank picked elsewhere, else the first.
  useEffect(() => {
    if (!multi || bank) return;
    setBank(banks.some((b) => b.id === selected) ? selected : banks[0]?.id ?? "");
  }, [multi, banks, selected, bank]);
  const bankName = multi ? banks.find((b) => b.id === bank)?.name ?? null : banks[0]?.name ?? null;

  const load = useCallback(async () => {
    if (!statement?.from || !statement.to) return;
    setLoadError(null);
    try {
      // A day either side, so a payment logged a day off still finds its row.
      const from = addDays(statement.from, -1);
      const to = addDays(statement.to, 1);
      // With several banks, entries saved without a bank are compared too: one may be this statement's row,
      // and listing that row as missing would add it twice.
      const [own, loose] = await Promise.all([loadEntries(from, to, multi ? bank : ""), multi && bank ? loadEntries(from, to, "none") : Promise.resolve([])]);
      setEntries([...own, ...loose.map((e) => ({ ...e, loose: true }))]);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [statement, bank, multi]);
  useEffect(() => {
    setEntries(null);
    void load();
  }, [load]);

  const result = useMemo(() => {
    if (!statement || !entries) return null;
    const r = reconcile(statement.rows, entries);
    // Unmatched entries without a bank are most likely cash, not this account's.
    return { ...r, extra: r.extra.filter((e) => !e.loose) };
  }, [statement, entries]);
  const looseMatched = useMemo(() => (result?.matched ?? []).filter((m) => m.entry.loose), [result]);
  const missing = useMemo(() => result?.missing ?? [], [result]);

  // Everything missing starts ticked; rows added since drop out of the list on their own.
  useEffect(() => {
    setPicked(new Set(missing.map((r) => r.line)));
  }, [missing]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setStatement(null);
    setParseError(null);
    setChoices({});
    if (file.size > 5 * 1024 * 1024) {
      setParseError("That file is over 5 MB. Export a shorter date range and try again.");
      return;
    }
    try {
      setStatement(parseStatement(await file.text()));
    } catch (e) {
      setParseError(e instanceof StatementError ? e.message : "Couldn't read that file. Make sure it's a CSV export of your statement.");
    }
  }

  const choiceFor = (r: StatementRow): Choice => {
    if (choices[r.line]) return choices[r.line];
    const s = suggestEntry(r, bankName);
    return { kind: s.kind, category: s.category };
  };

  const draftFor = (r: StatementRow, c: Choice = choiceFor(r)): TxDraft => {
    const s = suggestEntry(r, bankName);
    return { kind: c.kind, amount: paisaToDecimal(r.amountPaisa), occurredAt: `${r.date}T12:00`, category: c.category, counterparty: s.counterparty ?? "", note: s.note, setAsideId: null, bankId: multi ? bank || null : null };
  };

  const add = (d: TxDraft) => apiFetch("/api/transactions", { method: "POST", body: JSON.stringify(d) });

  async function importPicked() {
    const rows = missing.filter((r) => picked.has(r.line));
    if (!rows.length) return;
    setBusy(true);
    let done = 0;
    try {
      for (const r of rows) {
        await add(draftFor(r));
        done++;
      }
      toast(`Added ${done} transaction${done === 1 ? "" : "s"} from the statement.`, "ok");
    } catch (e) {
      toast(`Added ${done} of ${rows.length}. ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
      await load();
    }
  }

  /** Files matched entries that have no bank under the statement's bank, so they count toward its balance. */
  async function fileLoose() {
    setBusy(true);
    let done = 0;
    try {
      for (const m of looseMatched) {
        await apiFetch(`/api/transactions/${m.entry.id}`, { method: "PATCH", body: JSON.stringify({ ...draftFrom(m.entry.tx), bankId: bank }) });
        done++;
      }
      toast(`Filed ${done} under ${bankName}.`, "ok");
    } catch (e) {
      toast(`Filed ${done} of ${looseMatched.length}. ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function saveEdited(d: TxDraft) {
    await add(d);
    setEditing(null);
    toast("Added from the statement.", "ok");
    await load();
  }

  const pickedRows = missing.filter((r) => picked.has(r.line));
  const pickedOut = pickedRows.reduce((n, r) => n + (r.direction === "out" ? r.amountPaisa : 0), 0);
  const pickedIn = pickedRows.reduce((n, r) => n + (r.direction === "in" ? r.amountPaisa : 0), 0);
  const check = statement ? balancesAddUp(statement) : null;
  const toggle = (line: number) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(line)) n.delete(line);
    else n.add(line);
    return n;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Check a bank statement</h1>
          <p className="muted">Upload the CSV statement from your bank&apos;s app or website. Mizan lists what&apos;s on it that you haven&apos;t recorded, and you can add those in one go. The file is read on this device and isn&apos;t uploaded.</p>
        </div>
      </div>

      <div className="card recon-pick">
        {multi && (
          <label className="field">Statement for
            <select value={bank} onChange={(e) => setBank(e.target.value)}>
              {banks.map((b) => <option key={b.id} value={b.id}>{bankLabel(b)}</option>)}
            </select>
          </label>
        )}
        <label className="field">Statement file (CSV)
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {fileName && !parseError && statement && (
          <p className="small muted">
            {fileName}: {statement.rows.length} transaction{statement.rows.length === 1 ? "" : "s"} from {dateLabel(statement.from!)} to {dateLabel(statement.to!)}.
            {statement.skipped.length > 0 && ` ${statement.skipped.length} line${statement.skipped.length === 1 ? "" : "s"} skipped (line ${statement.skipped.slice(0, 5).map((s) => s.line).join(", ")}${statement.skipped.length > 5 ? ", …" : ""}).`}
          </p>
        )}
        {check && (
          <p className={`small ${check.ok ? "muted" : ""}`}>
            {check.ok
              ? "✓ Opening balance plus these rows comes to the closing balance, so every row was read."
              : `The rows don't add up to the closing balance (off by ${formatPaisa(Math.abs(check.differencePaisa))}). Some rows may not have been read.`}
          </p>
        )}
        {parseError && <div className="alert error" role="alert">{parseError}</div>}
      </div>

      {statement && (loadError ? <ErrorBox message={loadError} onRetry={load} /> : !result ? <div className="card"><Loading rows={4} label="Comparing" /></div> : (
        <>
          <div className="recon-stats">
            <div className="card recon-stat ok"><div className="small muted">Already in Mizan</div><div className="recon-stat-n">{result.matched.length}</div></div>
            <div className="card recon-stat missing"><div className="small muted">Missing</div><div className="recon-stat-n">{missing.length}</div>
              {missing.length > 0 && <div className="small muted">{[["out", "−"], ["in", "+"]].map(([dir, sign]) => { const n = missing.reduce((t, r) => t + (r.direction === dir ? r.amountPaisa : 0), 0); return n ? `${sign}${formatPaisa(n)}` : null; }).filter(Boolean).join(", ")}</div>}
            </div>
            <div className="card recon-stat extra"><div className="small muted">In Mizan, not on it</div><div className="recon-stat-n">{result.extra.length}</div></div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Missing from Mizan</h2>
              {missing.length > 0 && (
                <div className="toolbar">
                  <button className="btn sm" onClick={() => setPicked(picked.size === missing.length ? new Set() : new Set(missing.map((r) => r.line)))}>{picked.size === missing.length ? "Untick all" : "Tick all"}</button>
                  <button className="btn primary sm" disabled={busy || pickedRows.length === 0} onClick={importPicked}>
                    {busy ? "Adding…" : `Add ${pickedRows.length} ticked`}
                  </button>
                </div>
              )}
            </div>
            {missing.length === 0 ? (
              <p className="muted">Nothing is missing. Every row on this statement is in Mizan.</p>
            ) : (
              <>
                <p className="small muted recon-hint">Matched on amount, in or out, and date (a day either side). Check the category on each before adding; you can change it here or tap Edit for the rest.</p>
                {missing.map((r) => {
                  const c = choiceFor(r);
                  const kinds: Kind[] = r.direction === "out" ? ["expense"] : ["income", "remittance"];
                  const options = kinds.flatMap((k) => CATEGORIES[k].map((cat) => ({ k, cat })));
                  return (
                    <div key={r.line} className="tx-row recon-row">
                      <input type="checkbox" className="recon-check" checked={picked.has(r.line)} onChange={() => toggle(r.line)} aria-label={`Add ${r.description || "this row"}`} />
                      <div className="tx-row-main">
                        <div className="tx-row-title">{r.description || "No description"}</div>
                        <div className="meta">{dateLabel(r.date)}{r.reference ? ` · ref ${r.reference}` : ""}</div>
                        <select className="recon-cat" value={`${c.kind}|${c.category}`} aria-label="Category"
                          onChange={(e) => { const [k, cat] = e.target.value.split("|"); setChoices((x) => ({ ...x, [r.line]: { kind: k as Kind, category: cat } })); }}>
                          {kinds.map((k) => (
                            <optgroup key={k} label={KIND_LABEL[k]}>
                              {options.filter((o) => o.k === k).map((o) => <option key={o.cat} value={`${k}|${o.cat}`}>{o.cat}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <div className="tx-row-side">
                        <span className={`amt ${r.direction === "out" ? "expense" : "income"}`}>{r.direction === "out" ? "−" : "+"}{formatPaisa(r.amountPaisa)}</span>
                        <div className="row-actions"><button className="btn sm" onClick={() => setEditing(r)}>Edit</button></div>
                      </div>
                    </div>
                  );
                })}
                {pickedRows.length > 0 && (
                  <p className="small muted recon-total">Ticked: {pickedOut > 0 && `−${formatPaisa(pickedOut)}`}{pickedOut > 0 && pickedIn > 0 && ", "}{pickedIn > 0 && `+${formatPaisa(pickedIn)}`}</p>
                )}
              </>
            )}
          </div>

          {looseMatched.length > 0 && (
            <div className="card recon-loose">
              <div className="card-head">
                <h2>On the statement, but saved without a bank</h2>
                <button className="btn primary sm" disabled={busy} onClick={fileLoose}>{busy ? "Saving…" : `File ${looseMatched.length} under ${bankName}`}</button>
              </div>
              <p className="small muted">These are in Mizan, so they aren&apos;t missing, but with no bank they don&apos;t count toward the {bankName} balance ({formatPaisa(looseMatched.reduce((n, m) => n + (m.row.direction === "out" ? -m.row.amountPaisa : m.row.amountPaisa), 0), { sign: true })}).</p>
              {looseMatched.map((m) => (
                <div key={m.entry.id} className="tx-row">
                  <div className="tx-row-main">
                    <div className="tx-row-title">{m.entry.tx.counterparty || m.entry.tx.category}</div>
                    <div className="meta">{dateLabel(m.entry.day)} · {m.entry.tx.category}</div>
                  </div>
                  <div className="tx-row-side"><span className={`amt ${m.entry.kind}`}>{m.entry.kind === "expense" ? "−" : "+"}{formatPaisa(m.entry.amount_paisa)}</span></div>
                </div>
              ))}
            </div>
          )}

          {result.extra.length > 0 && (
            <details className="card recon-more">
              <summary><strong>In Mizan, not on this statement ({result.extra.length})</strong></summary>
              <p className="small muted">Often cash, another account, or something entered twice. Worth a look, but nothing is wrong by itself.</p>
              {result.extra.map((e) => (
                <div key={e.id} className="tx-row">
                  <div className="tx-row-main">
                    <div className="tx-row-title">{e.tx.counterparty || e.tx.category}</div>
                    <div className="meta">{dateLabel(e.day)} · {e.tx.category}</div>
                  </div>
                  <div className="tx-row-side"><span className={`amt ${e.kind}`}>{e.kind === "expense" ? "−" : "+"}{formatPaisa(e.amount_paisa)}</span></div>
                </div>
              ))}
            </details>
          )}

          {result.matched.length > 0 && (
            <details className="card recon-more">
              <summary><strong>Already in Mizan ({result.matched.length})</strong></summary>
              {result.matched.map((m) => (
                <div key={m.row.line} className="tx-row">
                  <div className="tx-row-main">
                    <div className="tx-row-title">{m.row.description || "No description"}</div>
                    <div className="meta">{dateLabel(m.row.date)} · in Mizan as {m.entry.tx.counterparty || m.entry.tx.category}{m.dayDiff ? `, ${dateLabel(m.entry.day)}` : ""}</div>
                  </div>
                  <div className="tx-row-side"><span className={`amt ${m.row.direction === "out" ? "expense" : "income"}`}>{m.row.direction === "out" ? "−" : "+"}{formatPaisa(m.row.amountPaisa)}</span></div>
                </div>
              ))}
            </details>
          )}
        </>
      ))}

      {editing && (
        <TxForm
          title="Add from statement"
          submitLabel="Add transaction"
          initial={{ ...draftFrom(), ...draftFor(editing) }}
          onClose={() => setEditing(null)}
          onSubmit={saveEdited}
        >
          <div className="redacted" style={{ marginBottom: 14 }}>{dateLabel(editing.date)} · {editing.description}{editing.reference ? ` · ref ${editing.reference}` : ""}</div>
        </TxForm>
      )}
    </>
  );
}
