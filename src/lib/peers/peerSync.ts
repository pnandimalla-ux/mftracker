import { createServiceClient } from "@/lib/supabase/service";

const MFAPI_TIMEOUT_MS = 5000;
const MATCH_TOLERANCE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, timeoutMs = MFAPI_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface NavHistoryEntry {
  date: string; // "DD-MM-YYYY", as returned by mfapi.in
  nav: string;
}

// mfapi.in dates are "DD-MM-YYYY" — not ISO, so new Date(dateStr) would
// misparse them (or silently produce "Invalid Date"). Parse the parts out
// and construct the Date explicitly instead.
function parseMFDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export interface PeriodReturns {
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
}

// Finds the nav history entry whose date is closest to `targetDate`, only
// accepting a match within MATCH_TOLERANCE_DAYS. `entries` must be parsed
// (date: Date, nav: number) and sorted newest-first, matching mfapi.in order.
function findClosestNav(
  entries: { date: Date; nav: number }[],
  targetDate: Date
): number | null {
  let best: { nav: number; diffMs: number } | null = null;

  for (const entry of entries) {
    const diffMs = Math.abs(entry.date.getTime() - targetDate.getTime());
    if (!best || diffMs < best.diffMs) {
      best = { nav: entry.nav, diffMs };
    }
  }

  if (!best) return null;
  if (best.diffMs > MATCH_TOLERANCE_DAYS * DAY_MS) return null;
  return best.nav;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateReturns(navHistory: NavHistoryEntry[]): PeriodReturns {
  if (!navHistory || navHistory.length === 0) {
    return { r6m: null, r1y: null, r3y: null, r5y: null };
  }

  const parsed = navHistory
    .map((entry) => ({
      date: parseMFDate(entry.date),
      nav: Number(entry.nav),
    }))
    .filter((entry) => Number.isFinite(entry.nav));

  if (parsed.length === 0) {
    return { r6m: null, r1y: null, r3y: null, r5y: null };
  }

  // mfapi.in returns newest-first; be defensive rather than assume order.
  parsed.sort((a, b) => b.date.getTime() - a.date.getTime());

  const latest = parsed[0];
  const oldestAvailable = parsed[parsed.length - 1];

  function returnOverDays(days: number, isCagr: boolean): number | null {
    const targetDate = new Date(latest.date.getTime() - days * DAY_MS);
    if (targetDate.getTime() < oldestAvailable.date.getTime()) return null;

    const startNav = findClosestNav(parsed, targetDate);
    if (startNav === null || startNav <= 0) return null;

    if (isCagr) {
      const years = days / 365;
      const cagr = (Math.pow(latest.nav / startNav, 1 / years) - 1) * 100;
      return round2(cagr);
    }

    const simpleReturn = ((latest.nav - startNav) / startNav) * 100;
    return round2(simpleReturn);
  }

  return {
    r6m: returnOverDays(180, false),
    r1y: returnOverDays(365, false),
    r3y: returnOverDays(1095, true),
    r5y: returnOverDays(1825, true),
  };
}

// mfapi.in-backed real scheme codes are always plain numeric strings.
// Manually-added holdings without a real code get a `manual-<timestamp>`
// placeholder (see POST /api/mf/holdings) — those can never resolve here.
export function isRealSchemeCode(code: string): boolean {
  return /^\d+$/.test(code);
}

export interface FetchedScheme {
  history: NavHistoryEntry[];
  schemeName: string | null;
}

// Fetches a scheme's full NAV history from mfapi.in. Throws on any failure
// (timeout, non-2xx, malformed body) so callers can decide how to
// record/skip it. Callers that only need ~5 years of history for return
// calculations should slice the result (see tier1Sync's sliceToFiveYears)
// before running calculateReturns, to avoid needlessly holding decades of
// daily NAV entries in memory.
export async function fetchSchemeHistory(schemeCode: string): Promise<FetchedScheme> {
  const res = await fetchWithTimeout(`https://api.mfapi.in/mf/${schemeCode}`);
  if (!res.ok) {
    throw new Error(`mfapi.in returned ${res.status}`);
  }

  const json = await res.json();

  // mfapi.in wraps history under `data`; some mirrors add a `status` field
  // ("SUCCESS"/"ERROR") — treat an explicit non-success as a miss.
  if (typeof json?.status === "string" && json.status !== "SUCCESS") {
    throw new Error(`mfapi.in status: ${json.status}`);
  }
  if (!json?.data || !Array.isArray(json.data)) {
    throw new Error("mfapi.in response missing data array");
  }

  return {
    history: json.data,
    schemeName: typeof json?.meta?.scheme_name === "string" ? json.meta.scheme_name : null,
  };
}

export interface FetchReturnsResult {
  history: NavHistoryEntry[];
  returns: PeriodReturns;
}

// Convenience wrapper for one-off single-fund lookups (e.g. the live
// on-demand fallback in /api/mf/peers/[scheme_code]) that don't need the
// 5-year slice a bulk tier1/tier2 sync applies before calculating.
export async function fetchSchemeReturns(schemeCode: string): Promise<FetchReturnsResult> {
  const { history } = await fetchSchemeHistory(schemeCode);
  return { history, returns: calculateReturns(history) };
}

// Ensures mf_peer_data has the tier/amc/fund_name columns and that
// mf_category_stats exists, via the same lazy-once-per-warm-instance
// exec_sql RPC pattern used for mf_nav_cache.nav_history (see src/lib/mfapi.ts).
// See also src/lib/supabase/tier2-schema.sql for the same statements to run
// by hand in the Supabase SQL editor.
let ensurePeerSchemaPromise: Promise<void> | null = null;

export function ensurePeerDataSchema(): Promise<void> {
  if (!ensurePeerSchemaPromise) {
    ensurePeerSchemaPromise = (async () => {
      try {
        const supabase = createServiceClient();
        await supabase.rpc("exec_sql", {
          sql: `
            alter table mf_peer_data add column if not exists tier text default 'tier1';
            alter table mf_peer_data add column if not exists amc text;
            alter table mf_peer_data add column if not exists fund_name text;

            create table if not exists mf_category_stats (
              category text primary key,
              avg_r6m numeric(8,2),
              avg_r1y numeric(8,2),
              avg_r3y numeric(8,2),
              avg_r5y numeric(8,2),
              best_fund_code text,
              best_fund_name text,
              best_fund_r1y numeric(8,2),
              worst_fund_code text,
              worst_fund_name text,
              worst_fund_r1y numeric(8,2),
              benchmark_r1y numeric(8,2),
              category_vs_benchmark numeric(8,2),
              trend text,
              fund_count integer,
              tier text default 'tier2',
              updated_at timestamptz default now()
            );
            alter table mf_category_stats enable row level security;
            drop policy if exists "Auth read category stats" on mf_category_stats;
            create policy "Auth read category stats" on mf_category_stats for select using (auth.role() = 'authenticated');
          `,
        });
      } catch (err) {
        console.error("Failed to ensure mf_peer_data/mf_category_stats schema:", err);
      }
    })();
  }
  return ensurePeerSchemaPromise;
}

interface PeerRankRow {
  scheme_code: string;
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
}

function hasAnyReturn(row: PeerRankRow): boolean {
  return row.r6m !== null || row.r1y !== null || row.r3y !== null || row.r5y !== null;
}

// Recalculates peer_rank_6m/1y/3y/5y and peer_count for every fund currently
// in mf_peer_data under `category`, ranking against the FULL current set for
// that category (not just whichever funds a particular sync pass touched) —
// this keeps ranks consistent regardless of which tier last updated which
// specific fund. Rank 1 = best (highest) return for that period.
export async function recalculateCategoryRanks(category: string): Promise<{ errors: string[] }> {
  const supabase = createServiceClient();
  const errors: string[] = [];

  const { data: rows, error } = await supabase
    .from("mf_peer_data")
    .select("scheme_code, r6m, r1y, r3y, r5y")
    .eq("category", category);

  if (error) {
    return { errors: [error.message] };
  }
  if (!rows || rows.length === 0) {
    return { errors: [] };
  }

  const peerCount = rows.filter(hasAnyReturn).length;
  const periods: Array<{ key: keyof PeriodReturns; rankCol: string }> = [
    { key: "r6m", rankCol: "peer_rank_6m" },
    { key: "r1y", rankCol: "peer_rank_1y" },
    { key: "r3y", rankCol: "peer_rank_3y" },
    { key: "r5y", rankCol: "peer_rank_5y" },
  ];

  const rankUpdates = new Map<string, Record<string, number | null>>();
  for (const row of rows as PeerRankRow[]) {
    rankUpdates.set(row.scheme_code, { peer_count: peerCount });
  }

  for (const { key, rankCol } of periods) {
    const ranked = (rows as PeerRankRow[])
      .filter((r) => r[key] !== null)
      .sort((a, b) => (b[key] as number) - (a[key] as number));

    ranked.forEach((r, idx) => {
      const existing = rankUpdates.get(r.scheme_code) ?? {};
      existing[rankCol] = idx + 1;
      rankUpdates.set(r.scheme_code, existing);
    });
  }

  for (const [schemeCode, updates] of Array.from(rankUpdates.entries())) {
    const { error: updateError } = await supabase
      .from("mf_peer_data")
      .update(updates)
      .eq("scheme_code", schemeCode);
    if (updateError) {
      console.error("Rank update failed for", schemeCode, updateError.message);
      errors.push(`Rank update failed for ${schemeCode}: ${updateError.message}`);
    }
  }

  return { errors };
}
