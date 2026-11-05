import { ImageResponse } from "next/og";

// A gold wallet with an emerald card tucked in, on onyx, matching the dark dashboard design.
// Full bleed and kept inside the centre safe zone so iOS and Android can round or mask it.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="bg" cx="50%" cy="22%" r="85%"><stop offset="0" stop-color="#252a28"/><stop offset="0.6" stop-color="#121514"/><stop offset="1" stop-color="#080909"/></radialGradient><linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.07"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient><linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="150" y1="90" x2="360" y2="420"><stop offset="0" stop-color="#f8e7bb"/><stop offset="0.45" stop-color="#d6b06a"/><stop offset="1" stop-color="#94692a"/></linearGradient><linearGradient id="goldD" gradientUnits="userSpaceOnUse" x1="150" y1="90" x2="360" y2="420"><stop offset="0" stop-color="#c9a15a"/><stop offset="1" stop-color="#7a5520"/></linearGradient><linearGradient id="em" gradientUnits="userSpaceOnUse" x1="120" y1="120" x2="390" y2="400"><stop offset="0" stop-color="#3bd486"/><stop offset="0.5" stop-color="#1f8a5b"/><stop offset="1" stop-color="#0d4a30"/></linearGradient></defs><rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#sheen)"/><rect x="150" y="118" width="220" height="150" rx="22" fill="url(#em)" transform="rotate(-10 260 190)"/><rect x="176" y="146" width="70" height="12" rx="6" fill="#fff" opacity="0.35" transform="rotate(-10 260 190)"/><rect x="104" y="186" width="304" height="200" rx="40" fill="url(#gold)"/><path d="M104 236h304" stroke="#94692a" stroke-width="6" opacity="0.5"/><rect x="300" y="256" width="132" height="76" rx="38" fill="url(#goldD)"/><circle cx="338" cy="294" r="17" fill="#34c77b"/></svg>`;

export function appIcon(size: number) {
  const src = `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`;
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={size} height={size} alt="" />,
    { width: size, height: size },
  );
}
