"use client";
import { useEffect, useRef, useState } from "react";
import { receiptRef } from "@/lib/splits";
import CloseButton from "./CloseButton";
import { receiptPng, receiptText, type ReceiptShare } from "./receipt";
import { useToast } from "./Toast";

/** Shows a share's receipt as an image, with Share (phone share sheet), Save and Copy. */
export default function ReceiptModal({ share, owner, onClose }: { share: ReceiptShare; owner: string | null; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    receiptPng(share, owner)
      .then((b) => {
        if (!live) return;
        made = URL.createObjectURL(b);
        setBlob(b);
        setUrl(made);
      })
      .catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [share, owner]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const name = `${receiptRef(share.id)}-${share.person.replace(/[^\p{L}\p{N}]+/gu, "-")}.png`;
  const file = blob ? new File([blob], name, { type: "image/png" }) : null;
  const canShare = !!file && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });
  const canCopy = typeof window !== "undefined" && "ClipboardItem" in window && !!navigator.clipboard?.write;

  async function share_() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: "Receipt", text: receiptText(share, owner) });
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast("Couldn't open the share sheet. Save the image instead.", "error");
    }
  }
  async function copy() {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("Receipt copied. Paste it into a chat.", "ok");
    } catch {
      toast("Couldn't copy the image here. Save it instead.", "error");
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
        <div className="modal-head">
          <div>
            <h2 id="receipt-title">Receipt for {share.person}</h2>
            <div className="small muted">Share it as a picture, e.g. on WhatsApp.</div>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <div className="receipt-preview">
          {err ? <div className="alert error">{err}</div> : url ? <img src={url} alt={receiptText(share, owner)} /> : <div className="skeleton" style={{ height: 420 }} />}
        </div>
        <div className="modal-foot receipt-foot">
          {canCopy && <button type="button" className="btn" onClick={copy} disabled={!blob}>Copy image</button>}
          {url && <a className="btn" href={url} download={name}>Save image</a>}
          {canShare && <button type="button" className="btn primary" onClick={share_}>Share</button>}
          {!canShare && <button type="button" className="btn primary" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  );
}
