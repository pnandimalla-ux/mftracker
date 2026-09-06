// Curated fund shortlist for the Lumpsum Recommendations "Curated" mode —
// used to look up 2-3 well-known Direct+Growth funds per category so the
// UI can show real fund names with real historical returns.
//
// DATA QUALITY NOTE: the scheme codes originally drafted for this file
// (from memory, not verified) were wrong for 41 of 52 entries when checked
// against mfapi.in — some catastrophically (two AMCs' codes were literally
// swapped with each other). Every code below was re-resolved via
// https://api.mfapi.in/mf/search and confirmed via https://api.mfapi.in/mf/<code>
// before being added — the same lesson already learned the hard way in
// src/lib/peers/categoryUniverse.ts. Never add a code here from memory;
// verify it the same way first.
//
// A few funds named in the original draft don't exist on mfapi.in at all
// (Parag Parikh Value Fund, Axis Equity Saver Fund, Mirae Asset Cash
// Management Fund's Direct+Growth plan, Kotak Savings Fund's Direct+Growth
// plan, Kotak Bond Short Term Fund's Direct+Growth plan) — those slots were
// filled with a comparable, verified substitute fund instead (noted inline).
export const CURATED_FUNDS: Record<string, { name: string; schemeCode: string }[]> = {
  "Large Cap": [
    { name: "Mirae Asset Large Cap Fund - Direct Plan - Growth", schemeCode: "118825" },
    { name: "Axis Large Cap Fund - Direct Plan - Growth", schemeCode: "120465" },
    { name: "HDFC Large Cap Fund - Direct Plan - Growth", schemeCode: "119018" },
    { name: "Canara Robeco Large Cap Fund - Direct Plan - Growth", schemeCode: "118269" },
  ],
  "Flexi Cap": [
    { name: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth", schemeCode: "122639" },
    { name: "HDFC Flexi Cap Fund - Direct Plan - Growth", schemeCode: "118955" },
    { name: "UTI Flexi Cap Fund - Direct Plan - Growth", schemeCode: "120662" },
    { name: "Kotak Flexi Cap Fund - Direct Plan - Growth", schemeCode: "120166" },
  ],
  "Mid Cap": [
    { name: "Mirae Asset Midcap Fund - Direct Plan - Growth", schemeCode: "147445" },
    { name: "Kotak Mid Cap Fund - Direct Plan - Growth", schemeCode: "119775" },
    { name: "DSP Midcap Fund - Direct Plan - Growth", schemeCode: "119071" },
    { name: "Axis Midcap Fund - Direct Plan - Growth", schemeCode: "120505" },
  ],
  "Small Cap": [
    { name: "DSP Small Cap Fund - Direct Plan - Growth", schemeCode: "119212" },
    { name: "Nippon India Small Cap Fund - Direct Plan - Growth", schemeCode: "118778" },
    { name: "Quant Small Cap Fund - Direct Plan - Growth", schemeCode: "120828" },
    { name: "Axis Small Cap Fund - Direct Plan - Growth", schemeCode: "125354" },
  ],
  "Large & Mid Cap": [
    { name: "Mirae Asset Large & Midcap Fund - Direct Plan - Growth", schemeCode: "118834" },
    { name: "Kotak Large & Mid Cap Fund - Direct Plan - Growth", schemeCode: "120158" },
    { name: "Canara Robeco Large and Mid Cap Fund - Direct Plan - Growth", schemeCode: "118278" },
    { name: "HDFC Large & Mid Cap Fund - Direct Plan - Growth", schemeCode: "130498" },
  ],
  "Value Fund": [
    // Parag Parikh has no "Value Fund" on mfapi.in — substituted ICICI Pru Value Fund.
    { name: "ICICI Prudential Value Fund - Direct Plan - Growth", schemeCode: "120323" },
    { name: "HDFC Capital Builder Value Fund - Direct Plan - Growth", schemeCode: "118935" },
    { name: "Kotak Contra Fund - Direct Plan - Growth", schemeCode: "119769" },
  ],
  "ELSS": [
    { name: "Mirae Asset ELSS Tax Saver Fund - Direct Plan - Growth", schemeCode: "135781" },
    { name: "Axis ELSS Tax Saver Fund - Direct Plan - Growth", schemeCode: "120503" },
    { name: "Parag Parikh ELSS Tax Saver Fund - Direct Plan - Growth", schemeCode: "147481" },
  ],
  "Liquid Fund": [
    // Mirae Asset's Liquid Fund has no Direct+Growth plan on mfapi.in — substituted SBI Liquid Fund.
    { name: "SBI Liquid Fund - Direct Plan - Growth", schemeCode: "119800" },
    { name: "HDFC Liquid Fund - Direct Plan - Growth", schemeCode: "119091" },
    { name: "Kotak Liquid Fund - Direct Plan - Growth", schemeCode: "119766" },
  ],
  "Ultra Short Duration": [
    { name: "Axis Ultra Short Term Fund - Direct Plan - Growth", schemeCode: "144754" },
    { name: "HDFC Ultra Short Term Fund - Direct Plan - Growth", schemeCode: "145034" },
    // "Kotak Savings Fund" has no Direct+Growth plan on mfapi.in — substituted ICICI Pru Ultra Short Term.
    { name: "ICICI Prudential Ultra Short Term Fund - Direct Plan - Growth", schemeCode: "120398" },
  ],
  "Money Market": [
    { name: "Mirae Asset Money Market Fund - Direct Plan - Growth", schemeCode: "149112" },
    { name: "Axis Money Market Fund - Direct Plan - Growth", schemeCode: "147567" },
    { name: "HDFC Money Market Fund - Direct Plan - Growth", schemeCode: "119092" },
  ],
  "Short Duration": [
    { name: "Axis Short Term Fund - Direct Plan - Growth", schemeCode: "120510" },
    { name: "HDFC Short Term Fund - Direct Plan - Growth", schemeCode: "119016" },
    // "Kotak Bond Short Term Fund" has no Direct+Growth plan on mfapi.in — substituted Nippon India Short Term.
    { name: "Nippon India Short Term Fund - Direct Plan - Growth", schemeCode: "118796" },
  ],
  "Balanced Advantage": [
    { name: "HDFC Balanced Advantage Fund - Direct Plan - Growth", schemeCode: "118968" },
    { name: "Kotak Balanced Advantage Fund - Direct Plan - Growth", schemeCode: "144335" },
    { name: "Nippon India Balanced Advantage Fund - Direct Plan - Growth", schemeCode: "118736" },
  ],
  "Equity Savings": [
    { name: "Mirae Asset Equity Savings Fund - Direct Plan - Growth", schemeCode: "145693" },
    { name: "Kotak Equity Savings Fund - Direct Plan - Growth", schemeCode: "131373" },
    // "Axis Equity Saver Fund" doesn't exist on mfapi.in — substituted ICICI Pru Equity Savings.
    { name: "ICICI Prudential Equity Savings Fund - Direct Plan - Cumulative", schemeCode: "133054" },
  ],
  "Gold ETF": [
    { name: "Mirae Asset Gold ETF", schemeCode: "151416" },
    { name: "Nippon India Gold ETF", schemeCode: "118777" },
    { name: "HDFC Gold ETF", schemeCode: "113049" },
  ],
  "Silver ETF": [
    { name: "Mirae Asset Silver ETF", schemeCode: "151779" },
    { name: "Nippon India Silver ETF", schemeCode: "149758" },
  ],
  "Arbitrage": [
    { name: "Kotak Arbitrage Fund - Direct Plan - Growth", schemeCode: "119771" },
    { name: "Nippon India Arbitrage Fund - Direct Plan - Growth", schemeCode: "118585" },
    { name: "HDFC Arbitrage Fund - Direct Plan - Growth", schemeCode: "129052" },
  ],
};
