/**
 * Optional features. Read at build time, so a change needs a redeploy.
 *
 * NEXT_PUBLIC_FAITH_FEATURES=true turns on the Quran dua card and Ramadan reminder on the
 * dashboard and the Zakat page. Off by default.
 */
export const FAITH_FEATURES = process.env.NEXT_PUBLIC_FAITH_FEATURES === "true";
