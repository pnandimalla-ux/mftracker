import { createServiceClient } from "@/lib/supabase/service";
import {
  calculateReturns,
  delay,
  ensurePeerDataSchema,
  fetchSchemeHistory,
  recalculateCategoryRanks,
} from "./peerSync";
import { ALL_CATEGORIES, getCategoryFunds } from "./categoryUniverse";
import { sliceToFiveYears } from "./tier1Sync";

const MFAPI_DELAY_MS = 200;
const CATEGORY_PAUSE_MS = 2000;

// UTI Nifty 50 Index Fund - Direct Plan - Growth — used as the benchmark
// every category's average 1Y return is compared against.
const BENCHMARK_SCHEME_CODE = "120716";

function avg(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return Math.round((present.reduce((s, v) => s + v, 0) / present.length) * 100) / 100;
}

export interface SyncCategoryResult {
  processed: number;
  failed: number;
  errors: string[];
  duration_ms: number;
}

// Tier 2 — syncs every fund in a category (not just held ones) and rolls up
// category-level statistics for the AI recommendation engine. Slower/less
// urgent than tier1, so it uses a longer inter-request delay and marks rows
// tier:'tier2' so freshness/provenance is visible later.
export async function syncTier2Category(category: string): Promise<SyncCategoryResult> {
  const startedAt = Date.now();
  console.log("Starting tier2 sync for category:", category);
  await ensurePeerDataSchema();

  const supabase = createServiceClient();
  const funds = getCategoryFunds(category);

  if (funds.length === 0) {
    return {
      processed: 0,
      failed: 0,
      errors: [`No funds found for category: ${category}`],
      duration_ms: Date.now() - startedAt,
    };
  }

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();
  const computed: Array<{
    code: string;
    name: string;
    r6m: number | null;
    r1y: number | null;
    r3y: number | null;
    r5y: number | null;
  }> = [];

  for (let i = 0; i < funds.length; i++) {
    const fund = funds[i];
    console.log("Fetching scheme:", fund.code);
    try {
      const { history, schemeName } = await fetchSchemeHistory(fund.code);
      const sliced = sliceToFiveYears(history);
      const returns = calculateReturns(sliced);
      console.log("NAV history length:", sliced.length, "for scheme:", fund.code);
      console.log("Calculated returns:", returns, "for scheme:", fund.code);

      const fundName = fund.name || schemeName || null;

      const { error } = await supabase.from("mf_peer_data").upsert(
        {
          scheme_code: fund.code,
          category,
          r6m: returns.r6m,
          r1y: returns.r1y,
          r3y: returns.r3y,
          r5y: returns.r5y,
          tier: "tier2",
          amc: fund.amc || null,
          fund_name: fundName,
          updated_at: now,
        },
        { onConflict: "scheme_code" }
      );
      if (error) throw new Error(error.message);

      console.log("Upserted to mf_peer_data:", fund.code);
      computed.push({ code: fund.code, name: fundName ?? fund.code, ...returns });
      processed++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed scheme:", fund.code, message);
      errors.push(`${fund.code}: ${message}`);
    }

    if (i < funds.length - 1) {
      await delay(MFAPI_DELAY_MS);
    }
  }

  const { errors: rankErrors } = await recalculateCategoryRanks(category);
  errors.push(...rankErrors);

  // Category-level intelligence for the AI recommendation engine.
  let benchmarkR1y: number | null = null;
  try {
    const { history } = await fetchSchemeHistory(BENCHMARK_SCHEME_CODE);
    benchmarkR1y = calculateReturns(sliceToFiveYears(history)).r1y;
  } catch (err) {
    console.error("Failed to fetch Nifty 50 benchmark for category stats:", err);
  }

  const withR1y = computed.filter((c) => c.r1y !== null);
  const avgR1y = avg(computed.map((c) => c.r1y));

  let categoryVsBenchmark: number | null = null;
  let trend: "outperforming" | "underperforming" | "neutral" = "neutral";
  if (avgR1y !== null && benchmarkR1y !== null) {
    categoryVsBenchmark = Math.round((avgR1y - benchmarkR1y) * 100) / 100;
    if (categoryVsBenchmark > 1) trend = "outperforming";
    else if (categoryVsBenchmark < -1) trend = "underperforming";
  }

  const best = withR1y.length > 0
    ? withR1y.reduce((a, b) => ((b.r1y as number) > (a.r1y as number) ? b : a))
    : null;
  const worst = withR1y.length > 0
    ? withR1y.reduce((a, b) => ((b.r1y as number) < (a.r1y as number) ? b : a))
    : null;

  const { error: statsError } = await supabase.from("mf_category_stats").upsert(
    {
      category,
      avg_r6m: avg(computed.map((c) => c.r6m)),
      avg_r1y: avgR1y,
      avg_r3y: avg(computed.map((c) => c.r3y)),
      avg_r5y: avg(computed.map((c) => c.r5y)),
      best_fund_code: best?.code ?? null,
      best_fund_name: best?.name ?? null,
      best_fund_r1y: best?.r1y ?? null,
      worst_fund_code: worst?.code ?? null,
      worst_fund_name: worst?.name ?? null,
      worst_fund_r1y: worst?.r1y ?? null,
      benchmark_r1y: benchmarkR1y,
      category_vs_benchmark: categoryVsBenchmark,
      trend,
      fund_count: computed.length,
      tier: "tier2",
      updated_at: now,
    },
    { onConflict: "category" }
  );

  if (statsError) {
    console.error("Failed to upsert mf_category_stats for", category, statsError.message);
    errors.push(`Category stats upsert failed: ${statsError.message}`);
  }

  console.log(
    `Finished tier2 sync for category: ${category} — processed=${processed} failed=${failed}`
  );

  return { processed, failed, errors, duration_ms: Date.now() - startedAt };
}

export interface SyncAllTier2Result {
  processed: number;
  failed: number;
  errors: string[];
  byCategory: Record<string, SyncCategoryResult>;
  duration_ms: number;
}

// Syncs every category in the universe, sequentially, with a 2s pause
// between categories to stay gentle on mfapi.in. Meant for the monthly cron
// or an explicit "Full sync" from the dashboard — not something to run on
// every page load.
export async function syncAllTier2(): Promise<SyncAllTier2Result> {
  const startedAt = Date.now();
  const supabase = createServiceClient();
  const byCategory: Record<string, SyncCategoryResult> = {};

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < ALL_CATEGORIES.length; i++) {
    const category = ALL_CATEGORIES[i];
    const result = await syncTier2Category(category);
    byCategory[category] = result;
    processed += result.processed;
    failed += result.failed;
    errors.push(...result.errors.map((e) => `[${category}] ${e}`));

    if (i < ALL_CATEGORIES.length - 1) {
      await delay(CATEGORY_PAUSE_MS);
    }
  }

  const duration_ms = Date.now() - startedAt;
  const status = errors.length === 0 ? "success" : processed === 0 ? "failed" : "partial";

  try {
    await supabase.from("mf_sync_log").insert({
      cron_name: "tier2-monthly",
      status,
      rows_updated: processed,
      error_message: errors.length > 0 ? errors.join("; ") : null,
    });
  } catch (logErr) {
    console.error("Failed to write tier2-monthly sync log:", logErr);
  }

  return { processed, failed, errors, byCategory, duration_ms };
}
