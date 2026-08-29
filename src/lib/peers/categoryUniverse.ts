// Static mapping of category -> the most widely held scheme codes in that
// category. This is the universe the peer comparison engine ranks a held
// fund against — not an exhaustive list of every fund in India.
//
// NOTE ON DATA QUALITY: while fixing a "missing peer data" bug, we checked
// every code in this file against mfapi.in's actual scheme names and found
// the ORIGINAL "Large Cap" entries (from an earlier, unverified pass) almost
// entirely pointed at the wrong funds — plans get renamed/merged over time
// and the codes here were never checked against mfapi.in directly. Large Cap
// has now been fully re-verified against mfapi.in (each code's real
// `meta.scheme_name` was fetched and compared). A handful of cross-category
// duplicate codes in Mid Cap/Small Cap/Flexi Cap/ELSS were also fixed since
// the duplication itself proved they were wrong. The remaining entries in
// Mid Cap, Small Cap, Flexi Cap, ELSS, Hybrid, and Debt have NOT been
// individually re-verified against mfapi.in in this pass — treat them as
// unconfirmed until someone does the same check for those categories.
//
// This inaccuracy mainly degrades the "compare against other funds in your
// category" context (wrong comparison set) — it does NOT affect a held
// fund's own return/rank, since that's computed from the fund's own
// scheme_code (stored on the holding itself, sourced from mfapi.in's search
// at import time) regardless of whether this list is right. See the dynamic
// category-based fallback in /api/mf/peers/[scheme_code]/route.ts.

export const CATEGORY_UNIVERSE: Record<string, string[]> = {
  "Large Cap": [
    "118825", // Mirae Asset Large Cap Fund - Direct Plan - Growth
    "120465", // Axis Large Cap Fund (formerly Axis Bluechip) - Direct Plan - Growth
    "119018", // HDFC Large Cap Fund (formerly HDFC Top 100) - Direct Plan - Growth
    "119598", // SBI Large Cap Fund (formerly SBI Bluechip) - Direct Plan - Growth
    "118269", // Canara Robeco Large Cap Fund (formerly Bluechip) - Direct Plan - Growth
    "120152", // Kotak Large Cap Fund (formerly Kotak Bluechip) - Direct Plan - Growth
    "120586", // ICICI Prudential Large Cap Fund (erstwhile Bluechip) - Direct Plan - Growth
    "118632", // Nippon India Large Cap Fund - Direct Plan - Growth
    "119250", // DSP Large Cap Fund (formerly DSP Top 100) - Direct Plan - Growth
    "118617", // Edelweiss Large Cap Fund - Direct Plan - Growth
    "119160", // Tata Large Cap Fund - Direct Plan - Growth
    "118531", // Franklin India Large Cap Fund (formerly Bluechip) - Direct Plan - Growth
  ],
  "Mid Cap": [
    "100029", // HDFC Mid-Cap Opportunities
    "131597", // Kotak Emerging Equity
    "101808", // Nippon India Growth
    "120505", // Axis Midcap Fund - Direct Plan - Growth Option (verified)
    "100016", // DSP Midcap
    "147622", // Motilal Oswal Midcap
    "135800", // Edelweiss Mid Cap
    "100119", // Tata Mid Cap Growth
    "100051", // SBI Magnum Midcap
    "100037", // Franklin India Prima
  ],
  "Small Cap": [
    "125497", // SBI Small Cap Fund - Direct Plan - Growth (verified)
    "125354", // Axis Small Cap Fund - Direct Plan - Growth (verified)
    "100025", // HDFC Small Cap
    "118778", // Nippon India Small Cap Fund - Direct Plan - Growth (verified)
    "120464", // Kotak Small Cap
    "100017", // DSP Small Cap
    "145740", // Tata Small Cap
    "141328", // Canara Robeco Small Cap
    "145362", // Union Small Cap
  ],
  "Flexi Cap": [
    "122639", // Parag Parikh Flexi Cap Fund - Direct Plan - Growth (verified)
    "120828", // Quant Flexi Cap
    "118955", // HDFC Flexi Cap Fund - Direct Plan - Growth Option (verified)
    "100163", // UTI Flexi Cap
    "101835", // Canara Robeco Flexi Cap
    "100014", // DSP Flexi Cap
    "119718", // SBI Flexicap Fund - Direct Plan - Growth (verified)
    "125358", // Axis Flexi Cap
  ],
  ELSS: [
    "118990", // Mirae Asset ELSS
    "112385", // Axis Long Term Equity
    "120832", // Quant ELSS
    "119242", // DSP ELSS Tax Saver Fund - Direct Plan - Growth (verified)
    "101833", // Canara Robeco ELSS
    "119773", // Kotak ELSS Tax Saver Fund - Direct Plan - Growth (verified)
    "100058", // SBI Long Term Equity
    "100026", // HDFC ELSS
    "100036", // Franklin India ELSS
    "147623", // Motilal Oswal ELSS
  ],
  Hybrid: [
    "100022", // HDFC Balanced Advantage
    "120594", // ICICI Pru Balanced Advantage
    "120467", // Kotak Balanced Advantage
    "135783", // Edelweiss Balanced Advantage
    "100055", // SBI Equity Hybrid
    "101831", // Canara Robeco Equity Hybrid
    "100015", // DSP Equity & Bond
  ],
  Debt: [
    "100024", // HDFC Corporate Bond
    "120462", // Kotak Bond
    "100052", // SBI Magnum Medium Duration
    "120588", // ICICI Pru Corporate Bond
    "101812", // Nippon India Short Term
    "125355", // Axis Corporate Debt
  ],
  "Large & Mid Cap": [
    "120463", // Kotak Equity Opportunities (Large & Mid Cap)
    "118988", // Mirae Asset Large & Midcap
    "101832", // Canara Robeco Emerging Equities
    "100060", // SBI Large & Midcap
    "100013", // DSP Equity Opportunities
    "101810", // Nippon India Vision
    "100028", // HDFC Large and Mid Cap
    "135801", // Axis Growth Opportunities
  ],
  "Sectoral/Thematic": [
    "101564", // Kotak MNC Fund
    "101809", // Nippon India Pharma
    "120596", // ICICI Pru Technology
    "100062", // SBI Healthcare Opportunities
    "139832", // Mirae Asset Healthcare
    "145980", // quant BFSI Fund
    "145744", // Tata Digital India
    "135765", // ICICI Pru BHARAT 22 FOF
  ],
  Value: [
    "148836", // Quant Value Fund
    "120592", // ICICI Pru Value Discovery
    "100126", // Templeton India Value
    "120468", // Kotak India EQ Contra
    "100166", // UTI Value Opportunities
    "101811", // Nippon India Value
    "100023", // HDFC Capital Builder Value
  ],
};

export function getCategoryForScheme(scheme_code: string): string | null {
  for (const [category, codes] of Object.entries(CATEGORY_UNIVERSE)) {
    if (codes.includes(scheme_code)) {
      return category;
    }
  }
  return null;
}

export function getPeersForScheme(scheme_code: string): string[] {
  const category = getCategoryForScheme(scheme_code);
  if (!category) return [];
  return CATEGORY_UNIVERSE[category].filter((code) => code !== scheme_code);
}
