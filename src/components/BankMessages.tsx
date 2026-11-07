"use client";
import { useEffect, useState } from "react";
import { MAX_WORDS, WORD_KINDS, WORD_LABEL, type SmsWords, type WordKind } from "@/lib/sms/keywords";
import { apiFetch } from "./api";
import { useData } from "./useData";
import { ErrorBox, Loading } from "./States";
import { useToast } from "./Toast";

type Lists = Record<WordKind, string[]>;
const same = (a: Lists, b: Lists) => WORD_KINDS.every((k) => a[k].join("\n") === b[k].join("\n"));

/** The four word lists that sort bank alerts, each a repeater of words or short phrases. */
export default function BankMessages({ onSaved }: { onSaved?: () => void }) {
  const toast = useToast();
  const saved = useData<{ words: SmsWords; defaults: SmsWords }>("/api/sms-words");
  const [lists, setLists] = useState<Lists | null>(null);
  const [base, setBase] = useState<Lists | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (saved.data && lists === null) {
      setLists(saved.data.words);
      setBase(saved.data.words);
    }
  }, [saved.data, lists]);

  const set = (k: WordKind, words: string[]) => setLists((l) => ({ ...l!, [k]: words }));
  const dirty = !!lists && !!base && !same(lists, base);
  const isDefault = !!lists && !!saved.data && same(lists, saved.data.defaults);

  async function save() {
    setBusy(true);
    try {
      const body = Object.fromEntries(WORD_KINDS.map((k) => [k, lists![k].map((w) => w.trim()).filter(Boolean)]));
      const res = await apiFetch<{ words: SmsWords }>("/api/sms-words", { method: "PUT", body: JSON.stringify(body) });
      setLists(res.words);
      setBase(res.words);
      onSaved?.();
      toast("Bank words saved", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="set-row column">
      <div className="set-text">
        <div className="set-title">Words that sort messages</div>
        <div className="set-hint">Mizan reads each bank alert for these words to tell what kind of payment it is. They apply to every bank. A word or phrase matches as whole words, in any capitals. If a bank words an alert differently, add the new word here.</div>
      </div>
      {saved.error ? <ErrorBox message={saved.error} onRetry={saved.reload} /> : !lists ? <Loading rows={2} /> : (
        <div className="words-list">
          {WORD_KINDS.map((k) => (
            <div key={k} className="words">
              <div className="words-head">
                <span className="set-title">{WORD_LABEL[k].title}</span>
                <span className="small muted">{WORD_LABEL[k].hint}</span>
              </div>
              <div className="words-items">
                {lists[k].map((w, i) => (
                  <span key={i} className="word">
                    <input value={w} maxLength={40} aria-label={`${WORD_LABEL[k].title} ${i + 1}`} size={Math.max(3, w.length)}
                      onChange={(e) => set(k, lists[k].map((x, j) => (j === i ? e.target.value : x)))} />
                    <button type="button" className="word-x" aria-label={`Remove ${w || "word"}`} onClick={() => set(k, lists[k].filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
                <button type="button" className="btn ghost sm" disabled={lists[k].length >= MAX_WORDS} onClick={() => set(k, [...lists[k], ""])}>+ Add</button>
              </div>
            </div>
          ))}
          <div className="toolbar">
            <button className="btn sm primary" onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : dirty ? "Save words" : "Saved"}</button>
            {!isDefault && <button className="btn sm ghost" onClick={() => setLists(saved.data!.defaults)}>Reset to defaults</button>}
          </div>
        </div>
      )}
    </div>
  );
}
