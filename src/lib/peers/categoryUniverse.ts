// Static mapping of category -> the most widely held Direct Plan / Growth
// option funds in that category. This is the universe the peer comparison
// engine ranks a held fund against — not an exhaustive list of every fund
// in India. Direct Plan (lower expense ratio) + Growth option (no IDCW NAV
// resets distorting returns) only, so comparisons are apples-to-apples.
//
// DATA QUALITY NOTE (2026-09-03 full re-verification): every single code in
// this file — including every one previously marked "(unverified)" — has now
// been checked against mfapi.in's actual `meta.scheme_name` and
// `meta.scheme_category` for that exact code. That re-audit found that
// essentially every "(unverified)" code from the prior version of this file
// was wrong (resolved to a completely unrelated scheme — a stale debt fund,
// a dividend option, or a 404) — not a labeling nitpick, a real bug: a held
// fund's peer set was being built from the wrong funds entirely. All of them
// have been replaced with codes confirmed live against mfapi.in. There
// should be no "(unverified)" codes left in this file; if you ever add one,
// verify it the same way before trusting it (fetch
// https://api.mfapi.in/mf/<code> and confirm scheme_name + scheme_category
// match what you intended) — do not guess a code from memory.
//
// TWO-LAYER PEER MATCHING (see peerMatcher.ts): this file is Layer 1 only —
// it buckets funds by broad category (e.g. "Sectoral/Thematic"). Within a
// category, funds below are grouped into commented "sub-group" blocks (e.g.
// Banking, Technology, Healthcare under Sectoral/Thematic). peerMatcher.ts
// is Layer 2 — it narrows a category bucket down to just the sub-group whose
// name keywords match the held fund, so a Banking fund is compared against
// other Banking funds rather than every Sectoral/Thematic fund regardless of
// sector. The sub-group comments here are for human readers; peerMatcher.ts
// has its own independent keyword lists that must stay conceptually in sync
// with these groupings (see SECTORAL_SUBGROUPS / INTERNATIONAL_SUBGROUPS
// there) — this file does not enforce that automatically.
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

  // Re-verified against mfapi.in — every code here was previously wrong
  // (mostly stale/discontinued schemes with no relation to the fund named).
  // Nippon's fund's real name is "Nippon India Growth Mid Cap Fund"; Kotak's
  // current Mid Cap fund is "Kotak Mid Cap Fund" (formerly "Emerging Equity").
  "Mid Cap": [
    { code: "118989", name: "HDFC Mid Cap Fund - Direct Plan - Growth Option", amc: "HDFC" },
    { code: "119775", name: "Kotak Mid Cap Fund - Direct Plan - Growth", amc: "Kotak" },
    { code: "118668", name: "Nippon India Growth Mid Cap Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "119071", name: "DSP Midcap Fund - Direct Plan - Growth", amc: "DSP" },
    { code: "119716", name: "SBI Midcap Fund - Direct Plan - Growth", amc: "SBI" },
    { code: "119178", name: "Tata Mid Cap Fund - Direct Plan - Growth Option", amc: "Tata" },
    { code: "120505", name: "Axis Midcap Fund - Direct Plan - Growth", amc: "Axis" },
  ],

  // Re-verified — the 4 previously "(unverified)" codes here were wrong;
  // the 3 without that tag (SBI, Axis, Nippon) were already correct.
  "Small Cap": [
    { code: "125497", name: "SBI Small Cap Fund - Direct Plan - Growth", amc: "SBI" },
    { code: "125354", name: "Axis Small Cap Fund - Direct Plan - Growth", amc: "Axis" },
    { code: "130503", name: "HDFC Small Cap Fund - Direct Plan - Growth Option", amc: "HDFC" },
    { code: "118778", name: "Nippon India Small Cap Fund - Direct Plan - Growth", amc: "Nippon" },
    { code: "120164", name: "Kotak Small Cap Fund - Direct Plan - Growth", amc: "Kotak" },
    { code: "119212", name: "DSP Small Cap Fund - Direct Plan - Growth", amc: "DSP" },
    { code: "146130", name: "Canara Robeco Small Cap Fund - Direct Plan - Growth Option", amc: "Canara Robeco" },
  ],

  // Re-audited live against mfapi.in — three of the original codes here were
  // wrong (120828 is actually Quant SMALL CAP, not Flexi Cap; 100163 and
  // 101835 are dead/nonexistent scheme codes), which is what caused a held
  // Flexi Cap fund to get compared against Small Cap peers. All 9 codes
  // below were confirmed against mfapi.in's meta.scheme_category before
  // being added.
  "Flexi Cap": [
    { code: "122639", name: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth", amc: "PPFAS" },
    { code: "120843", name: "Quant Flexi Cap Fund - Direct Plan - Growth", amc: "Quant" },
    { code: "118955", name: "HDFC Flexi Cap Fund - Direct Plan - Growth Option", amc: "HDFC" },
    { code: "120662", name: "UTI Flexi Cap Fund - Direct Plan - Growth", amc: "UTI" },
    { code: "118275", name: "Canara Robeco Flexi Cap Fund - Direct Plan - Growth", amc: "Canara Robeco" },
    { code: "119718", name: "SBI Flexicap Fund - Direct Plan - Growth", amc: "SBI" },
    { code: "141925", name: "Axis Flexi Cap Fund - Direct Plan - Growth", amc: "Axis" },
    { code: "129046", name: "Motilal Oswal Flexi Cap Fund - Direct Plan - Growth", amc: "Motilal Oswal" },
    { code: "148481", name: "Invesco India Focused Fund - Direct Plan - Growth", amc: "Invesco" },
  ],

  // Re-verified — Kotak's ELSS fund and Motilal Oswal's were already
  // correct; the other 6 previously "(unverified)" codes were wrong.
  ELSS: [
    { code: "119773", name: "Kotak ELSS Tax Saver Fund - Direct Plan - Growth", amc: "Kotak" },
    { code: "133386", name: "Motilal Oswal ELSS Tax Saver Fund - Direct Plan - Growth", amc: "Motilal Oswal" },
    { code: "135781", name: "Mirae Asset ELSS Tax Saver Fund - Direct Plan - Growth", amc: "Mirae Asset" },
    { code: "120503", name: "Axis ELSS Tax Saver Fund - Direct Plan - Growth Option", amc: "Axis" },
    { code: "120847", name: "Quant ELSS Tax Saver Fund - Direct Plan - Growth Option", amc: "Quant" },
    { code: "118285", name: "Canara Robeco ELSS Tax Saver Fund - Direct Plan - Growth Option", amc: "Canara Robeco" },
    { code: "119723", name: "SBI ELSS Tax Saver Fund - Direct Plan - Growth", amc: "SBI" },
    { code: "119060", name: "HDFC ELSS Tax Saver Fund - Direct Plan - Growth Option", amc: "HDFC" },
  ],

  // "Hybrid" here means Balanced Advantage / Dynamic Asset Allocation funds
  // specifically (25-100% flexible equity, dynamically hedged) — NOT the
  // same as "Aggressive Hybrid" below (fixed 65-80% equity band). Several
  // funds originally guessed into this bucket (SBI Equity Hybrid, Canara
  // Robeco Equity Hybrid, DSP Equity & Bond) turned out on verification to
  // actually be Aggressive Hybrid funds and were moved to that category.
  Hybrid: [
    { code: "120377", name: "ICICI Prudential Balanced Advantage Fund - Direct Plan - Growth", amc: "ICICI Pru" },
    { code: "118968", name: "HDFC Balanced Advantage Fund - Direct Plan - Growth Option", amc: "HDFC" },
    { code: "144335", name: "Kotak Balanced Advantage Fund - Direct Plan - Growth Option", amc: "Kotak" },
    { code: "118736", name: "Nippon India Balanced Advantage Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "141642", name: "Axis Balanced Advantage Fund - Direct Plan - Growth Option", amc: "Axis" },
    { code: "118615", name: "Edelweiss Balanced Advantage Fund - Direct Plan - Growth", amc: "Edelweiss" },
  ],

  // Re-verified — all 6 previous codes here were wrong. AMC naming here is
  // "Corporate Bond Fund" throughout since that's what these AMCs' actual
  // funds are called (the original "Magnum Medium Duration" guess for SBI
  // doesn't exist under that name — SBI's equivalent is "SBI Corporate Bond
  // Fund").
  Debt: [
    { code: "118987", name: "HDFC Corporate Bond Fund - Direct Plan - Growth Option", amc: "HDFC" },
    { code: "133791", name: "Kotak Corporate Bond Fund - Direct Plan - Growth Option", amc: "Kotak" },
    { code: "146215", name: "SBI Corporate Bond Fund - Direct Plan - Growth", amc: "SBI" },
    { code: "120692", name: "ICICI Prudential Corporate Bond Fund - Direct Plan - Growth", amc: "ICICI Pru" },
    { code: "118796", name: "Nippon India Short Term Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "141588", name: "Axis Corporate Bond Fund - Direct Plan - Growth Option", amc: "Axis" },
  ],

  // Re-verified — all 7 previous codes here were wrong. Canara Robeco's
  // fund was formerly named "Emerging Equities" (SEBI recategorisation
  // renamed it to "Large and Mid Cap Fund" — same fund, same AMFI code
  // lineage, new name). Kotak's is the renamed "Equity Opportunities Fund".
  "Large & Mid Cap": [
    { code: "120158", name: "Kotak Large & Mid Cap Fund - Direct Plan - Growth", amc: "Kotak" },
    { code: "118834", name: "Mirae Asset Large & Midcap Fund - Direct Plan - Growth", amc: "Mirae Asset" },
    { code: "118278", name: "Canara Robeco Large and Mid Cap Fund (formerly Emerging Equities) - Direct Plan - Growth Option", amc: "Canara Robeco" },
    { code: "119721", name: "SBI Large & Midcap Fund - Direct Plan - Growth", amc: "SBI" },
    { code: "119202", name: "Tata Large & Mid Cap Fund - Direct Plan - Growth Option", amc: "Tata" },
    { code: "130498", name: "HDFC Large & Mid Cap Fund - Direct Plan - Growth Option", amc: "HDFC" },
    { code: "118678", name: "Nippon India Vision Large & Mid Cap Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "120665", name: "UTI Large & Mid Cap Fund - Direct Plan - Growth", amc: "UTI" },
  ],

  // Sectoral/Thematic — expanded and grouped into sub-groups so Layer 2
  // keyword matching (peerMatcher.ts) can compare, say, a Banking fund only
  // against other Banking funds rather than the whole Sectoral/Thematic
  // bucket (which spans totally unrelated sectors). Every code below was
  // re-verified against mfapi.in; every previous code in this category was
  // wrong before this pass.
  "Sectoral/Thematic": [
    // --- Banking & Financial Services sub-group ---
    // Includes BFSI (banking + non-bank financials), private/PSU bank funds.
    { code: "148623", name: "Mirae Asset Banking and Financial Services Fund - Direct Plan - Growth", amc: "Mirae Asset" },
    { code: "151791", name: "Quant BFSI Fund - Direct Plan - Growth Option", amc: "Quant" },
    { code: "120244", name: "ICICI Prudential Banking & Financial Services Fund - Direct Plan - Growth", amc: "ICICI Pru" },
    { code: "118589", name: "Nippon India Banking & Financial Services Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "135793", name: "Tata Banking & Financial Services Fund - Direct Plan - Growth Option", amc: "Tata" },
    { code: "133859", name: "SBI Banking & Financial Services Fund - Direct Plan - Growth", amc: "SBI" },
    { code: "120733", name: "UTI Banking and Financial Services Fund - Direct Plan - Growth", amc: "UTI" },
    { code: "148986", name: "HDFC Banking & Financial Services Fund - Direct Plan - Growth Option", amc: "HDFC" },

    // --- Technology sub-group ---
    // India-focused technology/digital funds only — international tech FoFs
    // (Nasdaq 100, FANG+) live under International > US-market instead.
    { code: "120594", name: "ICICI Prudential Technology Fund - Direct Plan - Growth", amc: "ICICI Pru" },
    { code: "135800", name: "Tata Digital India Fund - Direct Plan - Growth Option", amc: "Tata" },
    { code: "118537", name: "Franklin India Technology Fund - Direct Plan - Growth", amc: "Franklin" },
    { code: "120539", name: "Aditya Birla Sun Life Digital India Fund - Direct Plan - Growth", amc: "Aditya Birla Sun Life" },
    { code: "152033", name: "Nippon India Innovation Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "120578", name: "SBI Technology Opportunities Fund - Direct Plan - Growth", amc: "SBI" },

    // --- Healthcare & Pharma sub-group ---
    { code: "118759", name: "Nippon India Pharma Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "119783", name: "SBI Healthcare Opportunities Fund - Direct Plan - Growth", amc: "SBI" },
    { code: "143783", name: "Mirae Asset Healthcare Fund - Direct Plan - Growth", amc: "Mirae Asset" },
    { code: "135810", name: "Tata India Pharma & Healthcare Fund - Direct Plan - Growth Option", amc: "Tata" },
    { code: "145454", name: "DSP Healthcare Fund - Direct Plan - Growth", amc: "DSP" },
    { code: "120782", name: "UTI Healthcare Fund - Direct Plan - Growth", amc: "UTI" },

    // --- MNC sub-group ---
    // Funds investing in Indian subsidiaries/listings of multinational
    // corporations. AMFI has no distinct "MNC" scheme_category (these are
    // filed generically as Sectoral/Thematic) — the MNC-ness is in the name.
    { code: "152910", name: "Kotak MNC Fund - Direct Plan - Growth", amc: "Kotak" },
    { code: "120682", name: "UTI MNC Fund - Direct Plan - Growth", amc: "UTI" },
    { code: "147346", name: "ICICI Prudential MNC Fund - Direct Plan - Growth", amc: "ICICI Pru" },
    { code: "119646", name: "Aditya Birla Sun Life MNC Fund - Direct Plan - Growth", amc: "Aditya Birla Sun Life" },
    { code: "119711", name: "SBI MNC Fund - Direct Plan - Growth", amc: "SBI" },

    // --- Energy, PSU & Infrastructure sub-group ---
    { code: "119247", name: "DSP India T.I.G.E.R. Fund - Direct Plan - Growth", amc: "DSP" },
    { code: "118763", name: "Nippon India Power & Infra Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "118557", name: "Franklin Build India Fund - Direct Plan - Growth", amc: "Franklin" },
    { code: "120621", name: "ICICI Prudential Infrastructure Fund - Direct Plan - Growth", amc: "ICICI Pru" },
    { code: "133801", name: "Kotak Infrastructure and Economic Reform Fund - Direct Plan - Growth Option", amc: "Kotak" },

    // --- Defence sub-group ---
    // As of this audit, HDFC Defence Fund is the ONLY actively-managed
    // Direct+Growth defence thematic fund on mfapi.in — every other
    // "defence" scheme found (Motilal Oswal, Aditya Birla Sun Life, Groww)
    // is a passive index fund/ETF tracking the same theme, not a comparable
    // actively-managed peer, so they were deliberately left out rather than
    // padding this sub-group with a category mismatch. With only 1 fund,
    // peerMatcher's MIN_PEERS fallback will always kick in here today (that
    // is expected and correct, not a bug) — revisit once more active
    // defence funds launch.
    { code: "151750", name: "HDFC Defence Fund - Direct Plan - Growth Option", amc: "HDFC" },

    // --- Consumption & Consumer sub-group ---
    { code: "118837", name: "Mirae Asset Great Consumer Fund - Direct Plan - Growth", amc: "Mirae Asset" },
    { code: "120575", name: "SBI Consumption Opportunities Fund - Direct Plan - Growth", amc: "SBI" },
    { code: "135805", name: "Tata India Consumer Fund - Direct Plan - Growth Option", amc: "Tata" },
    { code: "118724", name: "Nippon India Consumption Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "120587", name: "ICICI Prudential FMCG Fund - Direct Plan - Growth", amc: "ICICI Pru" },
  ],

  // Re-verified — all 7 previous codes here were wrong. ICICI Pru's fund
  // was formally renamed from "Value Discovery Fund" to "Value Fund" (same
  // scheme lineage). HDFC's is the renamed "Capital Builder Value Fund".
  Value: [
    { code: "149335", name: "Quant Value Fund - Direct Plan - Growth Option", amc: "Quant" },
    { code: "120323", name: "ICICI Prudential Value Fund (erstwhile Value Discovery Fund) - Direct Plan - Growth", amc: "ICICI Pru" },
    { code: "118494", name: "Templeton India Value Fund - Direct Plan - Growth", amc: "Franklin" },
    { code: "118784", name: "Nippon India Value Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "119769", name: "Kotak Contra Fund - Direct Plan - Growth", amc: "Kotak" },
    { code: "120751", name: "UTI Value Fund - Direct Plan - Growth", amc: "UTI" },
    { code: "118935", name: "HDFC Value Fund (formerly Capital Builder Value) - Direct Plan - Growth Option", amc: "HDFC" },
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

  // International — expanded and grouped into sub-groups (mirrors the
  // Sectoral/Thematic treatment above) so a US-market fund is compared
  // against other US-market funds rather than a Japan or emerging-market
  // fund. Every code below (other than 122639, already verified — see the
  // file-level note on its intentional Flexi Cap dual-listing) was
  // re-verified; every previous code here was wrong before this pass.
  International: [
    { code: "122639", name: "Parag Parikh Flexi Cap Fund (Intl portion) - Direct Plan - Growth", amc: "PPFAS" },

    // --- US-focused sub-group (S&P 500, Nasdaq 100, NYSE FANG+) ---
    { code: "148381", name: "Motilal Oswal S&P 500 Index Fund - Direct Plan - Growth", amc: "Motilal Oswal" },
    { code: "148928", name: "Mirae Asset NYSE FANG+ ETF Fund of Fund - Direct Plan - Growth", amc: "Mirae Asset" },
    { code: "145552", name: "Motilal Oswal Nasdaq 100 Fund of Fund - Direct Plan - Growth", amc: "Motilal Oswal" },
    { code: "120186", name: "ICICI Prudential US Bluechip Equity Fund - Direct Plan - Growth", amc: "ICICI Pru" },

    // --- Global/Asia sub-group (Japan, China, global emerging markets, gold mining) ---
    { code: "130860", name: "Nippon India Japan Equity Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "119779", name: "Kotak Global Emerging Market Overseas Equity Active FOF - Direct Plan - Growth", amc: "Kotak" },
    { code: "119277", name: "DSP World Gold Mining Overseas Equity Omni FoF - Direct Plan - Growth", amc: "DSP" },
    { code: "140243", name: "Edelweiss Greater China Equity Off-shore Fund - Direct Plan - Growth", amc: "Edelweiss" },
  ],

  // Arbitrage funds exploit price differences between the cash (spot) and
  // futures markets on the same stock — market-neutral, low-risk, and
  // taxed as equity (not debt) despite the low-volatility debt-like return
  // profile. A common tax-efficient alternative to short-term debt funds
  // for a 3-12 month holding horizon.
  Arbitrage: [
    { code: "153426", name: "quant Arbitrage Fund - Direct Plan - Growth Option", amc: "Quant" },
    { code: "153187", name: "Motilal Oswal Arbitrage Fund - Direct Plan - Growth", amc: "Motilal Oswal" },
    { code: "118585", name: "Nippon India Arbitrage Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "119771", name: "Kotak Arbitrage Fund - Direct Plan - Growth", amc: "Kotak" },
    { code: "129052", name: "HDFC Arbitrage Fund - Direct Plan - Growth Option", amc: "HDFC" },
    { code: "120364", name: "ICICI Prudential Arbitrage Fund - Direct Plan - Growth", amc: "ICICI Pru" },
    { code: "130773", name: "Axis Arbitrage Fund - Direct Plan - Growth Option", amc: "Axis" },
  ],

  // Aggressive Hybrid funds hold a SEBI-mandated 65-80% equity / 20-35% debt
  // band — more equity-heavy and less tactically flexible than the
  // Balanced Advantage funds in "Hybrid" above (which can swing anywhere
  // from ~25% to 100% equity). Several of these were originally misfiled as
  // plain "Hybrid" before verification showed their real scheme_category.
  "Aggressive Hybrid": [
    { code: "120819", name: "Quant Aggressive Hybrid Fund - Direct Plan - Growth Option", amc: "Quant" },
    { code: "118272", name: "Canara Robeco Aggressive Hybrid Fund - Direct Plan - Growth Option", amc: "Canara Robeco" },
    { code: "119609", name: "SBI Aggressive Hybrid Fund - Direct Plan - Growth", amc: "SBI" },
    { code: "119019", name: "DSP Aggressive Hybrid Fund - Direct Plan - Growth", amc: "DSP" },
    { code: "134813", name: "Mirae Asset Aggressive Hybrid Fund - Direct Plan - Growth", amc: "Mirae Asset" },
    { code: "119062", name: "HDFC Aggressive Hybrid Fund - Direct Plan - Growth Option", amc: "HDFC" },
    { code: "119767", name: "Kotak Aggressive Hybrid Fund - Direct Plan - Growth", amc: "Kotak" },
  ],

  // Multi Asset Allocation funds must invest at least 10% each in 3+ asset
  // classes (typically equity + debt + gold/commodities) — diversification
  // across asset classes within a single fund, rather than a single-asset
  // (even if flexible) equity/debt mix like the Hybrid categories above.
  "Multi Asset Allocation": [
    { code: "152064", name: "Kotak Multi Asset Allocation Fund - Direct Plan - Growth Option", amc: "Kotak" },
    { code: "120334", name: "ICICI Prudential Multi Asset Allocation Fund - Direct Plan - Growth", amc: "ICICI Pru" },
    { code: "148457", name: "Nippon India Multi Asset Allocation Fund - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "120821", name: "Quant Multi Asset Allocation Fund - Direct Plan - Growth Option", amc: "Quant" },
    { code: "120524", name: "Axis Multi Asset Allocation Fund - Direct Plan - Growth Option", amc: "Axis" },
    { code: "119131", name: "HDFC Multi Asset Allocation Fund - Direct Plan - Growth Option", amc: "HDFC" },
    { code: "119843", name: "SBI Multi Asset Allocation Fund - Direct Plan - Growth", amc: "SBI" },
  ],

  // Fund of Funds — invests in units of other mutual funds (domestic or
  // overseas) rather than buying securities directly. Distinct from
  // "International" above by structure, not geography: some of these (the
  // Franklin European feeder) happen to also be internationally-focused,
  // but the defining trait here is the FoF wrapper itself.
  "Fund of Funds": [
    { code: "119777", name: "Kotak Multi Asset Omni FOF - Direct Plan - Growth", amc: "Kotak" },
    { code: "148666", name: "Nippon India Multi - Asset Omni FoF - Direct Plan - Growth Option", amc: "Nippon" },
    { code: "129440", name: "Franklin India Feeder - Templeton European Opportunities Fund - Direct - Growth", amc: "Franklin" },
    { code: "149441", name: "ICICI Prudential Passive Multi-Asset Fund of Funds - Direct Plan - Growth", amc: "ICICI Pru" },
  ],
};

export const ALL_CATEGORIES: string[] = Object.keys(CATEGORY_UNIVERSE);

// The "(unverified)" suffix marker described in past versions of this file's
// data-quality note is an internal maintainer convention — it should never
// reach the UI, where it just confuses users into thinking something is
// broken. Stripped here so every consumer of getCategoryFunds gets a clean,
// presentable name automatically, whether or not any code currently carries
// the marker.
function displayName(name: string): string {
  return name.replace(/\s*\(unverified\)\s*$/i, "").trim();
}

export function getCategoryFunds(category: string): CategoryFund[] {
  return (CATEGORY_UNIVERSE[category] ?? []).map((f) => ({ ...f, name: displayName(f.name) }));
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
