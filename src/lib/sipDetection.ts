// SIP schedule detection from imported Coin lots. Shared by the import
// wizard (ImportClient) and scripts/check-sip-detection.ts.
import type { Owner, SIPFrequency } from "@/types/mf";

export interface SipDetectionLot {
  trade_date: string; // ISO yyyy-mm-dd
  amount: number;
  lot_type: string;
}

export interface SipDetectionFund {
  key: string;
  scheme_name: string;
  scheme_code: string | null;
  owner: Owner;
  category: string;
  lots: SipDetectionLot[];
}

export interface DetectedSip {
  key: string;
  scheme_name: string;
  scheme_code: string | null;
  owner: Owner;
  amount: number;
  sip_date: number;
  category: string;
  frequency: SIPFrequency;
  start_date: string;
}

// A SIP for the 1st can execute up to a few days late (holidays/weekends),
// or on the 31st of the previous month.
export const SIP_DAY_TOLERANCE = 3;

// Circular day-of-month distance: the 31st and the 1st are 1 apart.
export function dayDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 31 - d);
}

// Parses a "yyyy-mm-dd" string as a local date — never `new Date(iso)`,
// which parses date-only strings as UTC midnight and causes off-by-one
// day errors under IST (UTC+5:30).
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function medianGapDays(datesAsc: string[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < datesAsc.length; i++) {
    const prev = parseLocalDate(datesAsc[i - 1]);
    const curr = parseLocalDate(datesAsc[i]);
    gaps.push(Math.round((curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000)));
  }
  if (gaps.length === 0) return 0;
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function dayOf(iso: string): number {
  return Number(iso.split("-")[2]);
}

// Most frequent day-of-month in a cluster; ties go to the earliest lot's day.
function modeDay(clusterAsc: SipDetectionLot[]): number {
  const counts = new Map<number, number>();
  for (const l of clusterAsc) counts.set(dayOf(l.trade_date), (counts.get(dayOf(l.trade_date)) ?? 0) + 1);
  let best = dayOf(clusterAsc[0].trade_date);
  let bestCount = counts.get(best) ?? 0;
  for (const l of clusterAsc) {
    const d = dayOf(l.trade_date);
    const c = counts.get(d) ?? 0;
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

// Groups lots (date-ascending) by day-of-month: a lot joins a cluster when
// it is within SIP_DAY_TOLERANCE (circular) of any lot already in it. A lot
// that bridges two clusters merges them.
function clusterByDay(sortedAsc: SipDetectionLot[]): SipDetectionLot[][] {
  let clusters: SipDetectionLot[][] = [];
  for (const lot of sortedAsc) {
    const day = dayOf(lot.trade_date);
    const matching = clusters.filter((c) =>
      c.some((l) => dayDistance(dayOf(l.trade_date), day) <= SIP_DAY_TOLERANCE)
    );
    if (matching.length === 0) {
      clusters.push([lot]);
      continue;
    }
    const merged = matching.flat().concat(lot);
    merged.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    clusters = clusters.filter((c) => !matching.includes(c));
    clusters.push(merged);
  }
  // Stable output order: by each cluster's earliest lot.
  return clusters.sort((a, b) => a[0].trade_date.localeCompare(b[0].trade_date));
}

// A monthly SIP only ever shifts by a few days (holidays). If a cluster has
// lots further than the tolerance from its own typical day, the dates are
// drifting through the month — the signature of a weekly / bi-weekly SIP
// whose short history happened to chain into fewer than 3 clusters.
function clusterDrifts(clusterAsc: SipDetectionLot[]): boolean {
  const mode = modeDay(clusterAsc);
  return clusterAsc.some((l) => dayDistance(dayOf(l.trade_date), mode) > SIP_DAY_TOLERANCE);
}

// Detects SIP schedules from each fund's SIP-tagged lots. A fund can have
// several monthly SIPs on different dates (e.g. the 1st and the 16th) — each
// day-of-month cluster becomes its own schedule. Only a genuinely sub-monthly
// cadence (lots spread across the month, median gap <= 20 days) collapses
// into a single weekly / bi-weekly schedule.
export function detectActiveSips(funds: SipDetectionFund[]): DetectedSip[] {
  const results: DetectedSip[] = [];
  for (const fund of funds) {
    const sorted = fund.lots
      .filter((l) => l.lot_type === "sip")
      .filter((l) => {
        const d = dayOf(l.trade_date);
        return Number.isInteger(d) && d >= 1 && d <= 31;
      })
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    if (sorted.length === 0) continue;

    const base = {
      scheme_name: fund.scheme_name,
      scheme_code: fund.scheme_code,
      owner: fund.owner,
      category: fund.category,
    };

    const clusters = clusterByDay(sorted);
    const overallGap = sorted.length >= 2 ? medianGapDays(sorted.map((l) => l.trade_date)) : Infinity;
    const subMonthly =
      overallGap <= 20 &&
      (clusters.length >= 3 || (sorted.length >= 4 && clusters.some(clusterDrifts)));

    if (subMonthly) {
      const mostRecent = sorted[sorted.length - 1];
      results.push({
        ...base,
        key: fund.key,
        amount: mostRecent.amount,
        sip_date: dayOf(mostRecent.trade_date),
        frequency: overallGap <= 10 ? "weekly" : "bi-weekly",
        start_date: sorted[0].trade_date,
      });
      continue;
    }

    for (const cluster of clusters) {
      const day = modeDay(cluster);
      let frequency: SIPFrequency = "monthly";
      if (cluster.length >= 2 && medianGapDays(cluster.map((l) => l.trade_date)) > 50) {
        frequency = "quarterly";
      }
      results.push({
        ...base,
        key: clusters.length === 1 ? fund.key : `${fund.key}::day${day}`,
        amount: cluster[cluster.length - 1].amount,
        sip_date: day,
        frequency,
        start_date: cluster[0].trade_date,
      });
    }
  }
  return results;
}
