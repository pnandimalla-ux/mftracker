import { createServiceClient } from "@/lib/supabase/service";
import { CATEGORY_UNIVERSE } from "./categoryUniverse";

const MFAPI_DELAY_MS = 150;
const MFAPI_TIMEOUT_MS = 5000;
const MATCH_TOLERANCE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function sleep(ms: number) {
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

export interface SyncPeerDataResult {
  processed: number;
  failed: number;
  errors: string[];
}

export async function syncPeerData(category: string): Promise<SyncPeerDataResult> {
  console.log("Starting peer sync for category:", category);

  const schemeCodes = CATEGORY_UNIVERSE[category];
  if (!schemeCodes) {
    console.error("Unknown category:", category);
    return { processed: 0, failed: 0, errors: [`Unknown category: ${category}`] };
  }

  const supabase = createServiceClient();

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];
  const computed: Array<{ scheme_code: string } & PeriodReturns> = [];

  for (let i = 0; i < schemeCodes.length; i++) {
    const schemeCode = schemeCodes[i];
    console.log("Fetching scheme:", schemeCode);
    try {
      const res = await fetchWithTimeout(`https://api.mfapi.in/mf/${schemeCode}`);
      if (!res.ok) {
        throw new Error(`mfapi.in returned ${res.status}`);
      }

      const json = await res.json();

      // mfapi.in wraps history under `data`; some mirrors add a `status`
      // field ("SUCCESS"/"ERROR") — treat an explicit non-success as a miss.
      if (typeof json?.status === "string" && json.status !== "SUCCESS") {
        throw new Error(`mfapi.in status: ${json.status}`);
      }
      if (!json?.data || !Array.isArray(json.data)) {
        throw new Error("mfapi.in response missing data array");
      }

      const history: NavHistoryEntry[] = json.data;
      console.log("NAV history length:", history.length, "for scheme:", schemeCode);

      const returns = calculateReturns(history);
      console.log("Calculated returns:", returns, "for scheme:", schemeCode);

      computed.push({ scheme_code: schemeCode, ...returns });
      processed++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed scheme:", schemeCode, message);
      errors.push(`${schemeCode}: ${message}`);
    }

    if (i < schemeCodes.length - 1) {
      await sleep(MFAPI_DELAY_MS);
    }
  }

  if (computed.length === 0) {
    console.error("No schemes synced successfully for category:", category);
    return { processed, failed, errors };
  }

  const now = new Date().toISOString();

  console.log("Upserting to mf_peer_data:", computed.map((c) => c.scheme_code).join(", "));

  const { error: upsertError } = await supabase.from("mf_peer_data").upsert(
    computed.map((c) => ({
      scheme_code: c.scheme_code,
      category,
      r6m: c.r6m,
      r1y: c.r1y,
      r3y: c.r3y,
      r5y: c.r5y,
      updated_at: now,
    })),
    { onConflict: "scheme_code" }
  );

  if (upsertError) {
    console.error("Upsert to mf_peer_data failed:", upsertError.message);
    errors.push(`Upsert failed: ${upsertError.message}`);
    return { processed, failed, errors };
  }

  const periods: Array<{ key: keyof PeriodReturns; rankCol: string }> = [
    { key: "r6m", rankCol: "peer_rank_6m" },
    { key: "r1y", rankCol: "peer_rank_1y" },
    { key: "r3y", rankCol: "peer_rank_3y" },
    { key: "r5y", rankCol: "peer_rank_5y" },
  ];

  const peerCount = computed.filter((c) =>
    periods.some((p) => c[p.key] !== null)
  ).length;

  const rankUpdates = new Map<string, Record<string, number | null>>();
  for (const c of computed) {
    rankUpdates.set(c.scheme_code, { peer_count: peerCount });
  }

  for (const { key, rankCol } of periods) {
    const ranked = computed
      .filter((c) => c[key] !== null)
      .sort((a, b) => (b[key] as number) - (a[key] as number));

    ranked.forEach((c, idx) => {
      const existing = rankUpdates.get(c.scheme_code) ?? {};
      existing[rankCol] = idx + 1;
      rankUpdates.set(c.scheme_code, existing);
    });
  }

  for (const [schemeCode, updates] of Array.from(rankUpdates.entries())) {
    const { error } = await supabase
      .from("mf_peer_data")
      .update(updates)
      .eq("scheme_code", schemeCode);
    if (error) {
      console.error("Rank update failed for", schemeCode, error.message);
      errors.push(`Rank update failed for ${schemeCode}: ${error.message}`);
    }
  }

  console.log(
    `Finished peer sync for category: ${category} — processed=${processed} failed=${failed}`
  );

  return { processed, failed, errors };
}

export interface SyncAllPeerDataResult {
  processed: number;
  failed: number;
  errors: string[];
  byCategory: Record<string, SyncPeerDataResult>;
}

export async function syncAllPeerData(): Promise<SyncAllPeerDataResult> {
  const categories = Object.keys(CATEGORY_UNIVERSE);
  const byCategory: Record<string, SyncPeerDataResult> = {};

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const category of categories) {
    const result = await syncPeerData(category);
    byCategory[category] = result;
    processed += result.processed;
    failed += result.failed;
    errors.push(...result.errors.map((e) => `[${category}] ${e}`));
  }

  return { processed, failed, errors, byCategory };
}
