"use client";
import QR from "qrcode";
import { useMemo } from "react";

/** A QR code drawn as SVG paths, so it stays crisp at any size. */
export default function QrCode({ value, size = 184, label }: { value: string; size?: number; label: string }) {
  const { path, n } = useMemo(() => {
    const { modules } = QR.create(value, { errorCorrectionLevel: "M" });
    const count = modules.size;
    let d = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) if (modules.get(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    }
    return { path: d, n: count + 8 };
  }, [value]);
  return (
    <svg className="qr" role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#111" />
    </svg>
  );
}
