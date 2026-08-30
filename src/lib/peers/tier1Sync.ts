import { createServiceClient } from "@/lib/supabase/service";
import { fetchSchemeMeta } from "@/lib/mfapi";
import { derivePeerGroup } from "./peerGroup";
import {
  calculateReturns,
  delay,
  ensurePeerDataSchema,
  fetchSchemeHistory,
  isRealSchemeCode,
  recalculateCategoryRanks,
  type NavHistoryEntry,
} from "./peerSync";
import { getCategoryFunds, getHeldCategories, type CategoryFund } from "./categoryUniverse";

const MFAPI_DELAY_MS = 150;

// 5 years of trading days is ~1825 entries; add a ~60-entry buffer so the
// 5y CAGR calc always has a NAV within its match tolerance even on the
// oldest edge. mfapi.in returns full fund history (sometimes 20+ years of
// daily NAVs) newest-first, so slicing keeps the payload we actually parse
// small without losing anything calculateReturns needs (it never looks
// further back than 5 years + a few days).
export function sliceToFiveYears(navHistory: NavHistoryEntry[]): NavHistoryEntry[] {
  return navHistory.slice(0, 1885);
}

export interface SyncCategoryResult {
  processed: number;
  failed: number;
  errors: string[];
  duration_ms: number;
}

// Tier 1 — fast, per-category sync used both by the manual "Quick sync"
// button (once per held category) and internally by syncTier1(userId).
// Only syncs the given category's curated universe funds PLUS any held fund
// (any user) whose category matches but isn't in that curated list, so a
// fund outside the hardcoded universe still gets ranked.
export async function syncTier1Category(category: string): Promise<SyncCategoryResult> {
  const startedAt = Date.now();
  console.log("Starting tier1 sync for category:", category);
  await ensurePeerDataSchema();

  const supabase = createServiceClient();
  const universeFunds = getCategoryFunds(category);

  // `category` here may be a broad SEBI category (from the curated universe)
  // or a precise peer_group value (e.g. "Sectoral - MNC", passed by callers
  // that derived it from a user's held funds) — held funds are looked up
  // both ways so either kind of caller finds its extra (outside-universe)
  // held funds.
  const [{ data: byCategory, error: heldError }, { data: byPeerGroup }] = await Promise.all([
    supabase.from("mf_holdings").select("scheme_code").eq("category", category),
    supabase.from("mf_holdings").select("scheme_code").eq("peer_group", category),
  ]);

  if (heldError) {
    console.error("Failed to look up held funds for category:", category, heldError.message);
  }

  const heldRows = [...(byCategory ?? []), ...(byPeerGroup ?? [])];

  const universeCodes = new Set(universeFunds.map((f) => f.code));
  const extraCodes = Array.from(
    new Set(
      heldRows
        .map((r) => r.scheme_code as string)
        .filter((code) => isRealSchemeCode(code) && !universeCodes.has(code))
    )
  );

  const funds: CategoryFund[] = [
    ...universeFunds,
    ...extraCodes.map((code) => ({ code, name: "", amc: "" })),
  ];

  if (funds.length === 0) {
    return {
      processed: 0,
      failed: 0,
      errors: [`No funds found for category: ${category}`],
      duration_ms: Date.now() - startedAt,
    };
  }
  if (extraCodes.length > 0) {
    console.log(`Auto-adding ${extraCodes.length} held fund(s) outside the universe for:`, category);
  }

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();
  const touchedPeerGroups = new Set<string>();

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
      const meta = await fetchSchemeMeta(fund.code);
      const peerGroup = meta ? derivePeerGroup(meta.mf_api_category, fundName ?? fund.code) : category;
      touchedPeerGroups.add(peerGroup);

      const { error } = await supabase.from("mf_peer_data").upsert(
        {
          scheme_code: fund.code,
          category,
          mf_api_category: meta?.mf_api_category ?? null,
          peer_group: peerGroup,
          r6m: returns.r6m,
          r1y: returns.r1y,
          r3y: returns.r3y,
          r5y: returns.r5y,
          tier: "tier1",
          amc: fund.amc || null,
          fund_name: fundName,
          updated_at: now,
        },
        { onConflict: "scheme_code" }
      );
      if (error) throw new Error(error.message);

      console.log("Upserted to mf_peer_data:", fund.code);
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

  // Ranks are recalculated per actual peer_group encountered (not just the
  // outer `category`) — a "Sectoral/Thematic" sync pass can touch several
  // distinct peer groups (MNC, Technology, Banking...) that each need their
  // own ranking pass.
  for (const peerGroup of Array.from(touchedPeerGroups)) {
    const { errors: rankErrors } = await recalculateCategoryRanks(peerGroup);
    errors.push(...rankErrors);
  }

  console.log(
    `Finished tier1 sync for category: ${category} — processed=${processed} failed=${failed}`
  );

  return { processed, failed, errors, duration_ms: Date.now() - startedAt };
}

export interface Tier1Result {
  categories: string[];
  funds_processed: number;
  duration_ms: number;
}

// Syncs peer data for ONLY the categories a given user holds funds in —
// meant to run weekly (or on demand) and stay fast, unlike tier2's
// all-categories sweep. Always includes the user's exact held funds even
// when they're outside the curated universe (handled inside
// syncTier1Category, which folds in any held fund matching the category).
export async function syncTier1(userId: string): Promise<Tier1Result> {
  const startedAt = Date.now();
  const supabase = createServiceClient();

  const { data: holdings, error } = await supabase
    .from("mf_holdings")
    .select("scheme_code, category, peer_group")
    .eq("user_id", userId);

  if (error) {
    console.error("syncTier1: failed to load holdings for user:", userId, error.message);
    return { categories: [], funds_processed: 0, duration_ms: Date.now() - startedAt };
  }

  const held = holdings ?? [];
  const heldSchemeCodes = held.map((h) => h.scheme_code as string);

  // Precise peer_group values (e.g. "Sectoral - MNC") are preferred when a
  // holding has one — falling back to its broad category only for holdings
  // imported/added before peer_group existed (peer_group is still null for
  // those until their next sync). The curated universe's broad categories
  // are also included so a held fund inside the universe still pulls in the
  // rest of its universe peers.
  const categoriesFromUniverse = getHeldCategories(heldSchemeCodes);
  const groupsFromHoldings = Array.from(
    new Set(
      held
        .map((h) => (h.peer_group as string | null) ?? (h.category as string | null))
        .filter((c): c is string => !!c)
    )
  );
  const categories = Array.from(new Set([...categoriesFromUniverse, ...groupsFromHoldings]));

  let fundsProcessed = 0;
  const errors: string[] = [];

  for (const category of categories) {
    const result = await syncTier1Category(category);
    fundsProcessed += result.processed;
    errors.push(...result.errors.map((e) => `[${category}] ${e}`));
  }

  const duration_ms = Date.now() - startedAt;
  const status = errors.length === 0 ? "success" : fundsProcessed === 0 ? "failed" : "partial";

  try {
    await supabase.from("mf_sync_log").insert({
      cron_name: "tier1-weekly",
      status,
      rows_updated: fundsProcessed,
      error_message: errors.length > 0 ? errors.join("; ") : null,
    });
  } catch (logErr) {
    console.error("Failed to write tier1-weekly sync log:", logErr);
  }

  console.log(
    `syncTier1(${userId}): categories=${categories.join(", ")} funds_processed=${fundsProcessed} duration_ms=${duration_ms}`
  );

  return { categories, funds_processed: fundsProcessed, duration_ms };
}
