import { ImageResponse } from "next/og";

// The balance scale (mizan) on the brand green, full bleed so iOS and Android can round or mask it.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2f5d4c"/><g fill="none" stroke="#f6f1e7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M32 16v30M24 46h16M18 22h28"/><circle cx="32" cy="15" r="1.6" fill="#f6f1e7"/><path d="M18 22l-5 12M18 22l5 12M46 22l-5 12M46 22l5 12"/></g><path d="M12 34h12a6 6 0 0 1-12 0zM40 34h12a6 6 0 0 1-12 0z" fill="#c9a96e"/></svg>`;

export function appIcon(size: number) {
  const src = `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`;
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={size} height={size} alt="" />,
    { width: size, height: size },
  );
}
