import data from "./dua-data.json";

/** Al-Qasas 28:24, the dua of Musa (AS) for provision, in IndoPak script. */
export type Dua = { arabic: string; urdu: string; english: string; ref: string; source: string };
export const DUA = data as Dua;
