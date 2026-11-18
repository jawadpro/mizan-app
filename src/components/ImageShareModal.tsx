"use client";
import { useEffect, useRef, useState } from "react";
import CloseButton from "./CloseButton";
import { useToast } from "./Toast";

type Props = {
  /** Heading and the line under it. */
  title: string;
  subtitle: string;
  /** What the image is, in lower case, for messages ("receipt", "invoice"). */
  what: string;
  fileName: string;
  /** Draws the image. Called once when the modal opens. */
  make: () => Promise<Blob>;
  /** Plain text sent with the image and used as its alt text. */
  text: string;
  onClose: () => void;
};

/** Shows a drawn image with Share (phone share sheet), Save and Copy. */
export default function ImageShareModal({ title, subtitle, what, fileName, make, text, onClose }: Props) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const makeRef = useRef(make);
  makeRef.current = make;
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    makeRef.current()
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
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const file = blob ? new File([blob], fileName, { type: "image/png" }) : null;
  const canShare = !!file && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });
  const canCopy = typeof window !== "undefined" && "ClipboardItem" in window && !!navigator.clipboard?.write;
  const What = what.charAt(0).toUpperCase() + what.slice(1);

  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: What, text });
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast("Couldn't open the share sheet. Save the image instead.", "error");
    }
  }
  async function copy() {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast(`${What} copied. Paste it into a chat.`, "ok");
    } catch {
      toast("Couldn't copy the image here. Save it instead.", "error");
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal receipt-modal" role="dialog" aria-modal="true" aria-labelledby="share-image-title">
        <div className="modal-head">
          <div>
            <h2 id="share-image-title">{title}</h2>
            <div className="small muted">{subtitle}</div>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <div className="receipt-preview">
          {err ? <div className="alert error">{err}</div> : url ? <img src={url} alt={text} /> : <div className="skeleton" style={{ height: 420 }} />}
        </div>
        <div className="modal-foot receipt-foot">
          {canCopy && <button type="button" className="btn" onClick={copy} disabled={!blob}>Copy image</button>}
          {url && <a className="btn" href={url} download={fileName}>Save image</a>}
          {canShare && <button type="button" className="btn primary" onClick={share}>Share</button>}
          {!canShare && <button type="button" className="btn primary" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  );
}
