import { createServiceClient } from "@/lib/supabase/service";
import { getCategoryForCode } from "@/lib/peers/categoryUniverse";

// Category pairs that share a meaningfully similar stock universe (e.g. a
// Large Cap fund's top holdings overlap a lot with a Large & Mid Cap fund's
// large-cap sleeve) without being the *same* category.
const ADJACENT_CATEGORY_PAIRS: Array<[string, string]> = [
  ["Large Cap", "Large & Mid Cap"],
  ["Mid Cap", "Large & Mid Cap"],
  ["Mid Cap", "Small Cap"],
  ["Flexi Cap", "Large Cap"],
  ["Flexi Cap", "Large & Mid Cap"],
  ["Flexi Cap", "Value"],
  ["ELSS", "Large Cap"],
  ["ELSS", "Flexi Cap"],
  ["Value", "Large Cap"],
  ["Value", "Contra"],
];

function categoriesAreAdjacent(categoryA: string, categoryB: string): boolean {
  return ADJACENT_CATEGORY_PAIRS.some(
    ([a, b]) => (a === categoryA && b === categoryB) || (a === categoryB && b === categoryA)
  );
}

// Rule-based overlap estimate — a proxy until real stock-level data exists.
// TODO: Replace with AMFI holdings data in Prompt 7. Once mf_fund_holdings
// is populated, calculate actual stock-level overlap using Jaccard
// similarity: overlap = |stocks in A ∩ stocks in B| / |stocks in A ∪ stocks
// in B| × 100.
export function estimateOverlapRange(
  categoryA: string,
  amcA: string | null,
  categoryB: string,
  amcB: string | null
): string {
  if (categoryA === categoryB) {
    if (amcA && amcB && amcA === amcB) return "~75-85%";
    return "~55-70%";
  }
  if (categoriesAreAdjacent(categoryA, categoryB)) return "~40-55%";
  return "~15-30%";
}

interface SchemeInfo {
  category: string | null;
  amc: string | null;
}

async function lookupSchemeInfo(schemeCode: string): Promise<SchemeInfo> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("mf_peer_data")
      .select("category, amc")
      .eq("scheme_code", schemeCode)
      .maybeSingle();

    return {
      category: (data?.category as string | null) ?? getCategoryForCode(schemeCode),
      amc: (data?.amc as string | null) ?? null,
    };
  } catch (err) {
    console.error(`lookupSchemeInfo(${schemeCode}) failed:`, err);
    return { category: getCategoryForCode(schemeCode), amc: null };
  }
}

export interface OverlapHint {
  categoryA?: string | null;
  amcA?: string | null;
  categoryB?: string | null;
  amcB?: string | null;
}

// Estimates the portfolio overlap between two funds. Accepts an optional
// hint so callers who already have both funds' category/amc (the common
// case — the alternatives API already queried mf_peer_data) can skip the
// extra lookups; falls back to querying mf_peer_data / the category
// universe for whichever piece is missing.
export async function calculateOverlap(
  schemeCodeA: string,
  schemeCodeB: string,
  hint?: OverlapHint
): Promise<string> {
  let categoryA = hint?.categoryA ?? null;
  let amcA = hint?.amcA ?? null;
  let categoryB = hint?.categoryB ?? null;
  let amcB = hint?.amcB ?? null;

  if (categoryA === null || categoryB === null) {
    const [infoA, infoB] = await Promise.all([
      categoryA === null ? lookupSchemeInfo(schemeCodeA) : null,
      categoryB === null ? lookupSchemeInfo(schemeCodeB) : null,
    ]);
    if (infoA) {
      categoryA = infoA.category;
      amcA = amcA ?? infoA.amc;
    }
    if (infoB) {
      categoryB = infoB.category;
      amcB = amcB ?? infoB.amc;
    }
  }

  if (!categoryA || !categoryB) {
    // Unknown category on either side — assume the conservative "unrelated" bucket.
    return "~15-30%";
  }

  return estimateOverlapRange(categoryA, amcA, categoryB, amcB);
}
