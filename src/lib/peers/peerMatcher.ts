// Two-layer peer matching engine.
//
// Layer 1: category bucket — all funds in categoryUniverse.ts for the fund's
//   assigned category (e.g. "Sectoral/Thematic").
//
// Layer 2: name keyword filter — within the bucket, narrow to funds whose
//   names share the same sub-group keyword as the held fund's name.
//   This ensures Banking funds compare against Banking funds, Arbitrage
//   against Arbitrage, etc.
//
// Fallback rule: if keyword filtering produces fewer than MIN_PEERS (3)
//   funds, the filter is dropped and the full category bucket is used.
//   This prevents a fund from being compared against zero or one peer,
//   which would make ranks meaningless.

import { getCategoryFunds, type CategoryFund } from "./categoryUniverse";

/** Fallback threshold for Layer 2 keyword filtering — see matchPeers(). Never hardcode 3 elsewhere; always reference this constant. */
export const MIN_PEERS = 3;

// Sub-group keyword definitions.
// Each entry has:
//   - keywords: strings to search for in the fund name (case-insensitive)
//   - group: internal label used for logging/debugging
//
// Order matters — more specific patterns are listed before general ones
// so "Aggressive Hybrid" matches before plain "Hybrid".

interface SubGroupRule {
  group: string;
  keywords: string[];
}

// Sectoral/Thematic sub-groups — applied only when category === "Sectoral/Thematic".
// Keep this list conceptually in sync with the sub-group comments in
// categoryUniverse.ts's "Sectoral/Thematic" block — they describe the same
// groupings from two different angles (data vs. matching logic).
const SECTORAL_SUBGROUPS: SubGroupRule[] = [
  // Banking and financial services — includes BFSI, PSU bank, pvt bank, fin serv
  { group: "banking-financial", keywords: ["banking", "bfsi", "financial services", "fin serv", "psu bank", "pvt bank"] },
  // India-focused technology funds only (not international tech FoFs)
  { group: "technology", keywords: ["technology", "digital india", "tech", "innovation"] },
  // Healthcare and pharma
  { group: "healthcare-pharma", keywords: ["healthcare", "pharma", "health", "diagnostics"] },
  // MNC funds
  { group: "mnc", keywords: ["mnc"] },
  // Infrastructure and energy/PSU
  { group: "infra-energy", keywords: ["infrastructure", "infra", "power", "energy", "psu", "t.i.g.e.r"] },
  // Defence and aerospace
  { group: "defence", keywords: ["defence", "defense", "aerospace"] },
  // Consumption and consumer
  { group: "consumption", keywords: ["consumption", "consumer"] },
];

// International sub-groups — applied only when category === "International"
const INTERNATIONAL_SUBGROUPS: SubGroupRule[] = [
  // US market funds (S&P 500, Nasdaq, NYSE, FANG)
  { group: "us-market", keywords: ["s&p", "nasdaq", "nyse", "fang", "us bluechip", "us opportunities"] },
  // Asia-focused
  { group: "asia", keywords: ["china", "asia", "japan", "emerging market"] },
  // Global/World (catch-all for international — checked last)
  { group: "global", keywords: ["global", "world"] },
];

// Top-level category keyword rules — applied for all other categories.
// These handle cases like "Aggressive Hybrid" being more specific than "Hybrid".
const CATEGORY_SUBGROUPS: SubGroupRule[] = [
  { group: "aggressive-hybrid", keywords: ["aggressive hybrid"] },
  { group: "arbitrage", keywords: ["arbitrage"] },
  { group: "multi-asset", keywords: ["multi asset"] },
  { group: "fund-of-funds", keywords: ["fund of fund", "fof"] },
  { group: "flexi-cap", keywords: ["flexi cap", "flexicap"] },
  { group: "large-midcap", keywords: ["large & mid cap", "large and mid cap", "large midcap"] },
  { group: "mid-cap", keywords: ["mid cap", "midcap"] },
  { group: "small-cap", keywords: ["small cap", "smallcap"] },
  { group: "large-cap", keywords: ["large cap", "largecap"] },
];

/**
 * Returns the matched SubGroupRule for a fund name within a given set of rules,
 * or null if no rule matches. Matching is case-insensitive and checks all
 * keywords for each rule before moving to the next.
 */
function matchSubGroup(fundName: string, rules: SubGroupRule[]): SubGroupRule | null {
  const lower = fundName.toLowerCase();
  for (const rule of rules) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return rule;
    }
  }
  return null;
}

/**
 * Returns the sub-group rules to apply for a given category.
 * Sectoral and International use their own fine-grained rule sets;
 * all other categories use the general CATEGORY_SUBGROUPS list.
 */
function getRulesForCategory(category: string): SubGroupRule[] {
  if (category === "Sectoral/Thematic") return SECTORAL_SUBGROUPS;
  if (category === "International") return INTERNATIONAL_SUBGROUPS;
  return CATEGORY_SUBGROUPS;
}

export interface PeerMatchResult {
  peers: CategoryFund[];
  /** true if the keyword filter was applied and reduced the bucket; false if the full category bucket is used (no match or fallback) */
  keywordFiltered: boolean;
  /** the sub-group label that matched, for logging ("banking-financial", etc.) — null if no sub-group keyword matched the fund name */
  matchedGroup: string | null;
}

/**
 * Main entry point. Given a fund name and its assigned category, returns the
 * list of peer funds to compare against, applying the two-layer matching logic:
 * Layer 1 (category bucket, via categoryUniverse.ts) narrowed by Layer 2
 * (name keyword sub-group filtering), with an automatic fallback to the full
 * category bucket whenever the keyword filter would leave fewer than
 * MIN_PEERS funds to compare against.
 */
export function matchPeers(fundName: string, category: string): PeerMatchResult {
  const allPeers = getCategoryFunds(category);

  const rules = getRulesForCategory(category);
  const matched = matchSubGroup(fundName, rules);

  if (!matched) {
    // No keyword match — use the full category bucket
    return { peers: allPeers, keywordFiltered: false, matchedGroup: null };
  }

  // Filter bucket to funds whose names also match the same sub-group keywords
  const filtered = allPeers.filter((p) =>
    matched.keywords.some((kw) => p.name.toLowerCase().includes(kw.toLowerCase()))
  );

  if (filtered.length < MIN_PEERS) {
    // Too few peers after filtering — fall back to full category bucket
    // so ranks remain meaningful. Log for visibility.
    console.warn(
      `peerMatcher: keyword filter "${matched.group}" for "${fundName}" ` +
      `yielded only ${filtered.length} peer(s) — falling back to full ${category} bucket (${allPeers.length} funds)`
    );
    return { peers: allPeers, keywordFiltered: false, matchedGroup: matched.group };
  }

  return { peers: filtered, keywordFiltered: true, matchedGroup: matched.group };
}
