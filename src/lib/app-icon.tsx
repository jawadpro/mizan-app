import { ImageResponse } from "next/og";

// A pocket notebook on the brand green, full bleed so iOS and Android can round or mask it.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2f5d4c"/><rect x="18" y="13" width="28" height="38" rx="4" fill="#f6f1e7"/><path d="M18 17a4 4 0 0 1 4-4h2v38h-2a4 4 0 0 1-4-4z" fill="#d9ccb2"/><path d="M38 13h5v14l-2.5-2.5L38 27z" fill="#c9a96e"/><path d="M29 33h11M29 39h11M29 45h7" stroke="#2f5d4c" stroke-width="2.4" stroke-linecap="round"/></svg>`;

export function appIcon(size: number) {
  const src = `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`;
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={size} height={size} alt="" />,
    { width: size, height: size },
  );
}
