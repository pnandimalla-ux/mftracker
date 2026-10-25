import type { EnrichedMFHolding, Owner } from "@/types/mf";

export type OwnerFilter = "family" | "praveen" | "geetha";
export type Period = "6m" | "1y" | "3y" | "5y";
export type GroupOwner = Owner | "mixed";

export interface PeerInfo {
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
  rank_6m: number | null;
  rank_1y: number | null;
  rank_3y: number | null;
  rank_5y: number | null;
  peer_count: number | null;
  category_avg: {
    r6m: number | null;
    r1y: number | null;
    r3y: number | null;
    r5y: number | null;
  };
}

export interface HoldingWithPeer extends EnrichedMFHolding {
  peer: PeerInfo | null;
}

export interface HoldingGroup {
  key: string;
  scheme_code: string | null;
  scheme_name: string;
  category: string;
  amc: string | null;
  owner: GroupOwner;
  lots: HoldingWithPeer[];
  total_invested: number;
  total_units: number;
  avg_nav: number;
  current_value: number;
  pnl: number;
  pnl_pct: number;
  lot_count: number;
  earliest_date: string;
  latest_date: string;
  peer: PeerInfo | null;
  // At least one lot has no cached NAV, so current_value is just cost.
  nav_missing: boolean;
}

export interface HistoryPoint {
  date: string;
  invested: number;
  value: number;
}

export interface DayChange {
  amount: number;
  pct: number;
  as_of: string;
}

export const PERIODS: { id: Period; label: string }[] = [
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "3y", label: "3Y" },
  { id: "5y", label: "5Y" },
];

export function periodReturnKey(period: Period) {
  return ({ "6m": "r6m", "1y": "r1y", "3y": "r3y", "5y": "r5y" } as const)[period];
}

export function periodRankKey(period: Period) {
  return ({ "6m": "rank_6m", "1y": "rank_1y", "3y": "rank_3y", "5y": "rank_5y" } as const)[period];
}

// Tag-sized category names; the full name stays in the tag's tooltip.
const CATEGORY_SHORT_LABELS: Record<string, string> = {
  "Sectoral/Thematic": "Sectoral",
  "Large & Mid Cap": "Large & Mid",
  "Aggressive Hybrid": "Agg. Hybrid",
  "Multi Asset Allocation": "Multi Asset",
  "Fund of Funds": "FoF",
  International: "Intl",
};

export function shortCategory(category: string): string {
  return CATEGORY_SHORT_LABELS[category] ?? category;
}
