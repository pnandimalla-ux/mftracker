// Hardcoded ISIN -> scheme_code lookup for funds already known to be in
// Praveen/Geetha's portfolio, so importing them from a Coin CSV never has to
// round-trip through mfapi.in's fuzzy name search. Every scheme_code below
// was verified live against mfapi.in's meta.isin_growth for that code before
// being added here (not guessed) — see coinCsvParser.ts for the fallback
// path (mfapi.in search by scheme name) used for ISINs not listed here.
export interface KnownIsinFund {
  scheme_code: string;
  scheme_name: string;
  category: string;
  amc: string;
}

export const KNOWN_ISIN_MAP: Record<string, KnownIsinFund> = {
  INF174KA1TG9: {
    scheme_code: "152910",
    scheme_name: "Kotak MNC Fund - Direct Plan - Growth",
    category: "Sectoral/Thematic",
    amc: "Kotak",
  },
  INF174K01LF9: {
    scheme_code: "120158",
    scheme_name: "Kotak Large & Mid Cap Fund - Direct Plan - Growth",
    category: "Large & Mid Cap",
    amc: "Kotak",
  },
  INF205KA1213: {
    scheme_code: "148481",
    scheme_name: "Invesco India Focused Fund - Direct Plan - Growth",
    category: "Flexi Cap",
    amc: "Invesco",
  },
  INF769K01GX9: {
    scheme_code: "148623",
    scheme_name: "Mirae Asset Banking and Financial Services Fund - Direct Plan - Growth",
    category: "Sectoral/Thematic",
    amc: "Mirae Asset",
  },
  INF769K01FA9: {
    scheme_code: "147445",
    scheme_name: "Mirae Asset Midcap Fund - Direct Plan - Growth",
    category: "Mid Cap",
    amc: "Mirae Asset",
  },
  INF247L01502: {
    scheme_code: "129046",
    scheme_name: "Motilal Oswal Flexi Cap Fund - Direct Plan - Growth",
    category: "Flexi Cap",
    amc: "Motilal Oswal",
  },
  INF740K01QD1: {
    scheme_code: "119212",
    scheme_name: "DSP Small Cap Fund - Direct Plan - Growth",
    category: "Small Cap",
    amc: "DSP",
  },
  INF109K01Z48: {
    scheme_code: "120594",
    scheme_name: "ICICI Prudential Technology Fund - Direct Plan - Growth",
    category: "Sectoral/Thematic",
    amc: "ICICI Pru",
  },
};
