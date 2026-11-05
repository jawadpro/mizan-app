import { ImageResponse } from "next/og";

// The mizan (balance scale) in champagne gold on onyx, with an emerald jewel at the top, matching the
// dark dashboard design. Full bleed and kept inside the centre safe zone so iOS and Android can round or mask it.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="bg" cx="50%" cy="22%" r="85%"><stop offset="0" stop-color="#252a28"/><stop offset="0.6" stop-color="#121514"/><stop offset="1" stop-color="#080909"/></radialGradient><linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="0" y1="110" x2="0" y2="390"><stop offset="0" stop-color="#f6e2b0"/><stop offset="0.5" stop-color="#d6b06a"/><stop offset="1" stop-color="#9c7330"/></linearGradient><linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.07"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/></linearGradient><radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#34c77b" stop-opacity="0.55"/><stop offset="1" stop-color="#34c77b" stop-opacity="0"/></radialGradient></defs><rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#sheen)"/><circle cx="256" cy="128" r="52" fill="url(#glow)"/><g fill="none" stroke="url(#gold)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"><path d="M256 150V368"/><path d="M138 178H374"/><path d="M138 178L98 298M138 178L178 298M374 178L334 298M374 178L414 298"/></g><path d="M88 298H188A50 34 0 0 1 88 298Z" fill="url(#gold)"/><path d="M324 298H424A50 34 0 0 1 324 298Z" fill="url(#gold)"/><rect x="192" y="364" width="128" height="22" rx="11" fill="url(#gold)"/><circle cx="256" cy="128" r="16" fill="#34c77b"/></svg>`;

export function appIcon(size: number) {
  const src = `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`;
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={size} height={size} alt="" />,
    { width: size, height: size },
  );
}
