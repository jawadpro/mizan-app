"use client";
import { receiptRef } from "@/lib/splits";
import ImageShareModal from "./ImageShareModal";
import { receiptPng, receiptText, type ReceiptShare } from "./receipt";

/** Shows a share's receipt as an image, with Share (phone share sheet), Save and Copy. */
export default function ReceiptModal({ share, owner, onClose }: { share: ReceiptShare; owner: string | null; onClose: () => void }) {
  return (
    <ImageShareModal
      title={`Receipt for ${share.person}`}
      subtitle="Share it as a picture, e.g. on WhatsApp."
      what="receipt"
      fileName={`${receiptRef(share.id)}-${share.person.replace(/[^\p{L}\p{N}]+/gu, "-")}.png`}
      make={() => receiptPng(share, owner)}
      text={receiptText(share, owner)}
      onClose={onClose}
    />
  );
}
