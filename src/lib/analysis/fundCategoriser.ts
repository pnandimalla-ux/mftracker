// Auto-detects the SEBI category from a fund's name — used right after a
// user picks a fund from mfapi.in search, so they don't have to remember
// (or guess) which SEBI bucket it falls into.

export interface DetectCategoryResult {
  category: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

interface Rule {
  category: string;
  confidence: "high" | "medium";
  test: (name: string) => string | null;
}

function includesAny(name: string, keywords: string[]): string | null {
  for (const keyword of keywords) {
    if (name.includes(keyword)) return keyword;
  }
  return null;
}

// Checked in this exact order — first match wins.
const RULES: Rule[] = [
  // Priority 1 — exact SEBI category keywords.
  { category: "Large & Mid Cap", confidence: "high", test: (n) => includesAny(n, ["large & mid cap", "large and mid cap"]) },
  { category: "Flexi Cap", confidence: "high", test: (n) => includesAny(n, ["multi cap", "multicap"]) },
  { category: "Flexi Cap", confidence: "high", test: (n) => includesAny(n, ["flexi cap", "flexicap"]) },
  { category: "Mid Cap", confidence: "high", test: (n) => includesAny(n, ["mid cap", "midcap"]) },
  { category: "Small Cap", confidence: "high", test: (n) => includesAny(n, ["small cap", "smallcap"]) },
  {
    category: "Large Cap",
    confidence: "high",
    test: (n) => includesAny(n, ["large cap", "largecap", "bluechip", "blue chip", "top 100", "top 50", "top 200"]),
  },
  {
    category: "ELSS",
    confidence: "high",
    test: (n) => includesAny(n, ["elss", "tax saver", "tax saving", "long term equity", "tax relief"]),
  },
  { category: "Hybrid", confidence: "high", test: (n) => includesAny(n, ["balanced advantage", "dynamic asset"]) },
  {
    category: "Hybrid",
    confidence: "high",
    test: (n) => includesAny(n, ["equity hybrid", "aggressive hybrid", "equity & debt", "equity and debt"]),
  },
  { category: "Hybrid", confidence: "high", test: (n) => includesAny(n, ["arbitrage"]) },
  {
    category: "Debt",
    confidence: "high",
    test: (n) =>
      includesAny(n, [
        "liquid",
        "overnight",
        "money market",
        "ultra short",
        "low duration",
        "short duration",
        "medium duration",
        "corporate bond",
        "credit risk",
        "gilt",
        "banking and psu",
        "dynamic bond",
        "long duration",
      ]),
  },
  {
    category: "Index",
    confidence: "high",
    test: (n) => (n.includes("fund of fund") ? null : includesAny(n, ["index", "nifty", "sensex", "bse"])),
  },
  {
    category: "International",
    confidence: "high",
    test: (n) => includesAny(n, ["nasdaq", "s&p 500", "global", "international", "overseas", "world", "us equity"]),
  },
  { category: "Commodity", confidence: "high", test: (n) => includesAny(n, ["gold", "silver"]) },
  { category: "Fund of Funds", confidence: "high", test: (n) => includesAny(n, ["fund of fund", "fof"]) },
  {
    category: "Value",
    confidence: "high",
    test: (n) => (n.includes("value research") ? null : includesAny(n, ["value"])),
  },
  { category: "Value", confidence: "high", test: (n) => includesAny(n, ["contra"]) },
  { category: "Value", confidence: "high", test: (n) => includesAny(n, ["dividend yield"]) },

  // Priority 2 — AMC + thematic keywords.
  { category: "Sectoral/Thematic", confidence: "high", test: (n) => includesAny(n, ["pharma", "healthcare", "hospital"]) },
  { category: "Sectoral/Thematic", confidence: "high", test: (n) => includesAny(n, ["technology", "tech", "digital", "it fund"]) },
  {
    category: "Sectoral/Thematic",
    confidence: "high",
    test: (n) => includesAny(n, ["banking", "bfsi", "financial services", "bank"]),
  },
  { category: "Sectoral/Thematic", confidence: "high", test: (n) => includesAny(n, ["infrastructure", "infra"]) },
  { category: "Sectoral/Thematic", confidence: "high", test: (n) => includesAny(n, ["consumption", "fmcg"]) },
  {
    category: "Sectoral/Thematic",
    confidence: "high",
    test: (n) => includesAny(n, ["mnc", "business cycle", "esg", "psu", "commodities", "real estate", "realty"]),
  },
  {
    category: "Sectoral/Thematic",
    confidence: "high",
    test: (n) => (n.includes("quant") && n.includes("bfsi") ? "quant bfsi" : null),
  },
];

export function detectCategory(fundName: string): DetectCategoryResult {
  const name = fundName.toLowerCase();

  for (const rule of RULES) {
    const match = rule.test(name);
    if (match) {
      return {
        category: rule.category,
        confidence: rule.confidence,
        reason: `Fund name contains '${match}'`,
      };
    }
  }

  // Priority 3 — fund house known patterns (medium confidence).
  if (name.includes("parag parikh") || name.includes("ppfas")) {
    return {
      category: "Flexi Cap",
      confidence: "medium",
      reason: "Parag Parikh's flagship fund category is Flexi Cap",
    };
  }
  if (name.includes("quant")) {
    return {
      category: "Flexi Cap",
      confidence: "medium",
      reason: "Quant Mutual Fund's primary category is Flexi Cap",
    };
  }

  // Priority 4 — default.
  return {
    category: "Flexi Cap",
    confidence: "low",
    reason: "Could not auto-detect — please select manually",
  };
}
