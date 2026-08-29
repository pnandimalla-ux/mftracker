// Static mapping of category -> the most widely held Direct Plan / Growth
// option funds in that category. This is the universe the peer comparison
// engine ranks a held fund against — not an exhaustive list of every fund
// in India. Direct Plan (lower expense ratio) + Growth option (no IDCW NAV
// resets distorting returns) only, so comparisons are apples-to-apples.
//
// DATA QUALITY NOTE: every code below was checked against mfapi.in's actual
// `meta.scheme_name` for the code (not guessed). Several codes as originally
// drafted collided across categories (the same code labeled as two
// different funds) — a sure sign of a wrong code, since a real mfapi.in
// code identifies exactly one scheme. Those have been corrected here; codes
// marked "(unverified)" were taken as given and have NOT been individually
// checked against mfapi.in — do the same lookup for those before fully
// trusting the "Large & Mid Cap" / "Sectoral/Thematic" / "Value" / "Index"
// (rows 2+) / "International" cross-comparison context.
//
// One structural limitation worth flagging: a scheme_code can only live
// under ONE category key here (getCategoryForCode returns the first match).
// Parag Parikh Flexi Cap's international sleeve is intentionally listed
// under both "Flexi Cap" and "International" with the same code (122639) —
// it will only ever resolve to "Flexi Cap" via getCategoryForCode.

export interface CategoryFund {
  code: string;
  name: string;
  amc: string;
}

export const CATEGORY_UNIVERSE: Record<string, CategoryFund[]> = {
  "Large Cap": [
    { code: "118825", name: "Mirae Asset Large Cap Fund - Direct Plan - Growth", amc: "Mirae Asset" },
    { code: "120465", name: "Axis Large Cap Fund (formerly Bluechip) - Direct Plan - Growth", amc: "Axis" },
    { code: "119018", name: "HDFC Large Cap Fund (formerly Top 100) - Direct Plan - Growth", amc: "HDFC" },
    { code: "119598", name: "SBI Large Cap Fund (formerly Bluechip) - Direct Plan - Growth", amc: "SBI" },
    { code: "118269", name: "Canara Robeco Large Cap Fund (formerly Bluechip Equity) - Direct Plan - Growth", amc: "Canara Robeco" },
    { code: "120152", name: "Kotak Large Cap Fund (formerly Bluechip) - Direct Plan - Growth", amc: "Kotak" },
    { code: "120586", name: "ICICI Pru Large Cap Fund (erstwhile Bluechip) - Direct Plan - Growth", amc: "ICICI Pru" },
    { code: "118632", name: "Nippon India Large Cap Fund - Direct Plan - Growth", amc: "Nippon" },
  ],

  "Mid Cap": [
    { code: "100029", name: "HDFC Mid-Cap Opportunities - Direct - Growth (unverified)", amc: "HDFC" },
    { code: "131597", name: "Kotak Emerging Equity - Direct - Growth (unverified)", amc: "Kotak" },
    { code: "101808", name: "Nippon India Growth Fund - Direct - Growth (unverified)", amc: "Nippon" },
    { code: "120505", name: "Axis Midcap Fund - Direct Plan - Growth", amc: "Axis" },
    { code: "100016", name: "DSP Midcap Fund - Direct - Growth (unverified)", amc: "DSP" },
    { code: "100051", name: "SBI Magnum Midcap Fund - Direct - Growth (unverified)", amc: "SBI" },
    { code: "100119", name: "Tata Mid Cap Growth Fund - Direct - Growth (unverified)", amc: "Tata" },
  ],

  "Small Cap": [
    { code: "125497", name: "SBI Small Cap Fund - Direct Plan - Growth", amc: "SBI" },
    { code: "125354", name: "Axis Small Cap Fund - Direct Plan - Growth", amc: "Axis" },
    { code: "100025", name: "HDFC Small Cap Fund - Direct - Growth (unverified)", amc: "HDFC" },
    { code: "118778", name: "Nippon India Small Cap Fund - Direct Plan - Growth", amc: "Nippon" },
    { code: "120464", name: "Kotak Small Cap Fund - Direct - Growth (unverified)", amc: "Kotak" },
    { code: "100017", name: "DSP Small Cap Fund - Direct - Growth (unverified)", amc: "DSP" },
    { code: "141328", name: "Canara Robeco Small Cap Fund - Direct - Growth (unverified)", amc: "Canara Robeco" },
  ],

  "Flexi Cap": [
    { code: "122639", name: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth", amc: "PPFAS" },
    { code: "120828", name: "Quant Flexi Cap Fund - Direct - Growth (unverified)", amc: "Quant" },
    { code: "118955", name: "HDFC Flexi Cap Fund - Direct Plan - Growth Option", amc: "HDFC" },
    { code: "100163", name: "UTI Flexi Cap Fund - Direct - Growth (unverified)", amc: "UTI" },
    { code: "101835", name: "Canara Robeco Flexi Cap - Direct - Growth (unverified)", amc: "Canara Robeco" },
    { code: "119718", name: "SBI Flexicap Fund - Direct Plan - Growth", amc: "SBI" },
    { code: "125358", name: "Axis Flexi Cap Fund - Direct - Growth (unverified)", amc: "Axis" },
  ],

  ELSS: [
    { code: "118990", name: "Mirae Asset ELSS Tax Saver - Direct - Growth (unverified)", amc: "Mirae Asset" },
    { code: "112385", name: "Axis Long Term Equity - Direct - Growth (unverified)", amc: "Axis" },
    { code: "120832", name: "Quant ELSS Tax Saver - Direct - Growth (unverified)", amc: "Quant" },
    { code: "101833", name: "Canara Robeco ELSS Tax Saver - Direct - Growth (unverified)", amc: "Canara Robeco" },
    { code: "119773", name: "Kotak ELSS Tax Saver Fund - Direct Plan - Growth", amc: "Kotak" },
    { code: "100058", name: "SBI Long Term Equity - Direct - Growth (unverified)", amc: "SBI" },
    { code: "100026", name: "HDFC ELSS Tax Saver - Direct - Growth (unverified)", amc: "HDFC" },
    { code: "133386", name: "Motilal Oswal ELSS Tax Saver Fund - Direct Plan - Growth", amc: "Motilal Oswal" },
  ],

  Hybrid: [
    { code: "100022", name: "HDFC Balanced Advantage - Direct - Growth (unverified)", amc: "HDFC" },
    { code: "120377", name: "ICICI Prudential Balanced Advantage Fund - Direct Plan - Growth", amc: "ICICI Pru" },
    { code: "120467", name: "Kotak Balanced Advantage - Direct - Growth (unverified)", amc: "Kotak" },
    { code: "100055", name: "SBI Equity Hybrid - Direct - Growth (unverified)", amc: "SBI" },
    { code: "101831", name: "Canara Robeco Equity Hybrid - Direct - Growth (unverified)", amc: "Canara Robeco" },
    { code: "100015", name: "DSP Equity & Bond - Direct - Growth (unverified)", amc: "DSP" },
  ],

  Debt: [
    { code: "100024", name: "HDFC Corporate Bond - Direct - Growth (unverified)", amc: "HDFC" },
    { code: "120462", name: "Kotak Bond Fund - Direct - Growth (unverified)", amc: "Kotak" },
    { code: "100052", name: "SBI Magnum Medium Duration - Direct - Growth (unverified)", amc: "SBI" },
    { code: "120588", name: "ICICI Pru Corporate Bond - Direct - Growth (unverified)", amc: "ICICI Pru" },
    { code: "101812", name: "Nippon India Short Term - Direct - Growth (unverified)", amc: "Nippon" },
    { code: "125355", name: "Axis Corporate Debt - Direct - Growth (unverified)", amc: "Axis" },
  ],

  "Large & Mid Cap": [
    { code: "120463", name: "Kotak Equity Opportunities - Direct - Growth (unverified)", amc: "Kotak" },
    { code: "118988", name: "Mirae Asset Large & Midcap - Direct - Growth (unverified)", amc: "Mirae Asset" },
    { code: "101832", name: "Canara Robeco Emerging Equities - Direct - Growth (unverified)", amc: "Canara Robeco" },
    { code: "100060", name: "SBI Large & Midcap Fund - Direct - Growth (unverified)", amc: "SBI" },
    { code: "100013", name: "DSP Equity Opportunities - Direct - Growth (unverified)", amc: "DSP" },
    { code: "100028", name: "HDFC Large and Mid Cap - Direct - Growth (unverified)", amc: "HDFC" },
    { code: "135801", name: "Axis Growth Opportunities - Direct - Growth (unverified)", amc: "Axis" },
  ],

  "Sectoral/Thematic": [
    { code: "101564", name: "Kotak MNC Fund - Direct - Growth (unverified)", amc: "Kotak" },
    { code: "101809", name: "Nippon India Pharma Fund - Direct - Growth (unverified)", amc: "Nippon" },
    { code: "120596", name: "ICICI Pru Technology Fund - Direct - Growth (unverified)", amc: "ICICI Pru" },
    { code: "100062", name: "SBI Healthcare Opportunities - Direct - Growth (unverified)", amc: "SBI" },
    { code: "145980", name: "quant BFSI Fund - Direct - Growth (unverified)", amc: "Quant" },
    { code: "145744", name: "Tata Digital India Fund - Direct - Growth (unverified)", amc: "Tata" },
    { code: "139832", name: "Mirae Asset Healthcare Fund - Direct - Growth (unverified)", amc: "Mirae Asset" },
  ],

  Value: [
    { code: "148836", name: "Quant Value Fund - Direct - Growth (unverified)", amc: "Quant" },
    { code: "120592", name: "ICICI Pru Value Discovery - Direct - Growth (unverified)", amc: "ICICI Pru" },
    { code: "100126", name: "Templeton India Value Fund - Direct - Growth (unverified)", amc: "Franklin" },
    { code: "120468", name: "Kotak India EQ Contra - Direct - Growth (unverified)", amc: "Kotak" },
    { code: "100166", name: "UTI Value Opportunities - Direct - Growth (unverified)", amc: "UTI" },
    { code: "101811", name: "Nippon India Value Fund - Direct - Growth (unverified)", amc: "Nippon" },
    { code: "100023", name: "HDFC Capital Builder Value - Direct - Growth (unverified)", amc: "HDFC" },
  ],

  // UTI Nifty 50 Index Fund (120716) doubles as the Nifty 50 benchmark for
  // Tier 2 category-vs-benchmark stats — verified correct.
  Index: [
    { code: "120716", name: "UTI Nifty 50 Index Fund - Direct Plan - Growth", amc: "UTI" },
    { code: "119063", name: "HDFC Nifty 50 Index Fund - Direct Plan - Growth Option", amc: "HDFC" },
    { code: "118741", name: "Nippon India Index Fund - Nifty 50 Plan - Direct Plan - Growth", amc: "Nippon" },
    { code: "120620", name: "ICICI Prudential Nifty 50 Index Fund - Direct Plan - Growth", amc: "ICICI Pru" },
    { code: "147622", name: "Motilal Oswal Nifty Midcap 150 Index Fund - Direct Plan - Growth", amc: "Motilal Oswal" },
    { code: "147623", name: "Motilal Oswal Nifty Smallcap 250 Index Fund - Direct Plan - Growth", amc: "Motilal Oswal" },
  ],

  International: [
    { code: "122639", name: "Parag Parikh Flexi Cap Fund (Intl portion) - Direct - Growth (unverified)", amc: "PPFAS" },
    { code: "120829", name: "Mirae Asset NYSE FANG+ ETF FoF - Direct - Growth (unverified)", amc: "Mirae Asset" },
    { code: "148001", name: "Motilal Oswal S&P 500 Index - Direct - Growth (unverified)", amc: "Motilal Oswal" },
    { code: "135786", name: "Edelweiss US Technology FoF - Direct - Growth (unverified)", amc: "Edelweiss" },
  ],
};

export const ALL_CATEGORIES: string[] = Object.keys(CATEGORY_UNIVERSE);

export function getCategoryFunds(category: string): CategoryFund[] {
  return CATEGORY_UNIVERSE[category] ?? [];
}

export function getAllSchemeCodes(): string[] {
  return Array.from(new Set(ALL_CATEGORIES.flatMap((c) => CATEGORY_UNIVERSE[c].map((f) => f.code))));
}

export function getCategoryForCode(code: string): string | null {
  for (const category of ALL_CATEGORIES) {
    if (CATEGORY_UNIVERSE[category].some((f) => f.code === code)) {
      return category;
    }
  }
  return null;
}

// Categories that contain at least one of the given (held) scheme codes.
// Matches purely by scheme_code against the universe — it will miss a held
// fund whose code isn't in the universe at all even though its *category*
// (as stored on the holding) is a known one; callers that have the holding's
// own category field available should prefer that directly instead.
export function getHeldCategories(heldSchemeCodes: string[]): string[] {
  const heldSet = new Set(heldSchemeCodes);
  return ALL_CATEGORIES.filter((category) =>
    CATEGORY_UNIVERSE[category].some((f) => heldSet.has(f.code))
  );
}
