import "server-only";
import { ImageResponse } from "next/og";
import { BRAND_SVG } from "./brand";
import { invoiceCharges, invoiceDetails, invoiceLead, invoiceRef, invoiceTitle, paidOut, type InvoiceTx } from "./invoice-data";
import { formatPaisa } from "./money";

// The transaction invoice, rendered on the server so the WhatsApp assistant can send it as a picture. It follows the
// one the app draws in the browser (components/invoice.ts): green header, who it was paid to, the details, the amount,
// and any bank charge or tax in a box of its own, never added to the amount.

const C = {
  page: "#e7eae8", card: "#ffffff", ink: "#121614", muted: "#6b726e", faint: "#9aa19c", line: "#dce0dd",
  accent: "#1f8a5b", accentInk: "#146b45", accentSoft: "#e3f3ea",
};
const W = 600;
const LOGO = `data:image/svg+xml;base64,${Buffer.from(BRAND_SVG).toString("base64")}`;

const S = 2; // drawn at twice the size, for sharp text on phones
const s = (n: number) => n * S;

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: s(36), fontSize: s(16) }}>
      <span style={{ color: C.muted }}>{k}</span>
      <span style={{ color: C.ink, fontWeight: 600, maxWidth: s(330), overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{v}</span>
    </div>
  );
}

const Dash = () => <div style={{ display: "flex", borderTop: `${s(2)}px dashed ${C.line}`, margin: `${s(14)}px 0` }} />;
const Label = ({ children, top = 0 }: { children: string; top?: number }) => (
  <span style={{ color: C.muted, fontSize: s(14), fontWeight: 600, letterSpacing: s(0.5), marginTop: s(top) }}>{children}</span>
);

/** A PNG of one transaction's invoice. */
export async function invoicePngServer(t: InvoiceTx): Promise<Buffer> {
  const rows = invoiceDetails(t);
  const extra = invoiceCharges(t);
  const title = invoiceTitle(t);
  const titleLines = Math.min(2, Math.max(1, Math.ceil(title.length / 26)));
  const H = 28 + 96 + 26 + 22 + titleLines * 38 + 30 + rows.length * 36 + 30 + 26 + 58 + (extra.length ? 22 + 38 + extra.length * 36 + 8 : 0) + 32 + 44 + 20 + 28;
  const img = new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: C.page, padding: s(28) }}>
        <div style={{ display: "flex", flexDirection: "column", width: "100%", background: C.card, borderRadius: s(20), overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: s(96), background: C.accent, padding: `0 ${s(32)}px`, color: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={LOGO} width={s(44)} height={s(44)} alt="" style={{ borderRadius: s(10) }} />
              <span style={{ marginLeft: s(12), fontSize: s(24), fontWeight: 700 }}>Mizan</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <span style={{ fontSize: s(13), fontWeight: 700, opacity: 0.8, letterSpacing: s(1) }}>INVOICE</span>
              <span style={{ fontSize: s(15) }}>{invoiceRef(t.id)}</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", padding: `${s(26)}px ${s(32)}px ${s(20)}px` }}>
            <Label>{invoiceLead(t)}</Label>
            <span style={{ color: C.ink, fontSize: s(30), fontWeight: 700, lineHeight: 1.25, marginTop: s(4), maxHeight: s(76), overflow: "hidden" }}>{title}</span>
            <Dash />
            {rows.map(([k, v]) => <Row key={k} k={k} v={v} />)}
            <Dash />
            <Label top={4}>{paidOut(t) ? "AMOUNT PAID" : "AMOUNT RECEIVED"}</Label>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: s(6) }}>
              <span style={{ color: C.accentInk, fontSize: s(40), fontWeight: 800 }}>{formatPaisa(t.amount_paisa)}</span>
              <span style={{ background: C.accentSoft, color: C.accentInk, fontSize: s(13), fontWeight: 700, padding: `${s(6)}px ${s(12)}px`, borderRadius: s(99) }}>{paidOut(t) ? "PAID" : "RECEIVED"}</span>
            </div>
            {extra.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", background: "#f1f3f2", borderRadius: s(12), padding: `${s(14)}px ${s(14)}px ${s(4)}px`, marginTop: s(22) }}>
                <span style={{ color: C.muted, fontSize: s(13), fontWeight: 600, letterSpacing: s(0.5) }}>BANK CHARGES · NOT IN THE AMOUNT</span>
                {extra.map(([k, v]) => <Row key={k} k={k} v={formatPaisa(v)} />)}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: s(32) }}>
              <span style={{ color: C.muted, fontSize: s(15), fontWeight: 500 }}>Thank you!</span>
              <span style={{ color: C.faint, fontSize: s(12), marginTop: s(6) }}>Made with Mizan</span>
            </div>
          </div>
        </div>
      </div>
    ),
    { width: s(W), height: s(H) },
  );
  return Buffer.from(await img.arrayBuffer());
}
