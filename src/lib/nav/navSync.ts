import { createServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { fetchLatestNav, refreshNavAndHistory, searchDirectGrowthScheme } from "@/lib/mfapi";
import { isRealSchemeCode } from "@/lib/peers/peerSync";

// Schemes are fetched a few at a time rather than strictly one-by-one: a
// sequential sweep of ~25 full-history requests (plus a delay between each)
// could run past Vercel's function timeout and silently leave the funds at
// the end of the list with no cached NAV — those then fell back to avg_nav
// in GET /api/mf/holdings and showed a ~₹0 P&L.
const SYNC_CONCURRENCY = 5;
const MFAPI_DELAY_MS = 150;
const MAX_MANUAL_RESOLUTIONS = 10;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SyncSingleSchemeResult {
  nav: number;
  nav_date: string;
}

// Per-request mfapi.in timeout during a sync. Worst case is
// ceil(schemes / SYNC_CONCURRENCY) × this, which must stay inside the sync
// route's 60s maxDuration alongside the tier1 peer sync that follows it.
const SYNC_FETCH_TIMEOUT_MS = 8000;

// Fetches one scheme's full NAV history from mfapi.in and upserts both the
// latest NAV and nav_history into mf_nav_cache, so the value chart / day
// change are as fresh as the headline NAV. If the full-history request fails,
// falls back to the lightweight latest-NAV endpoint so the NAV itself still
// updates. Throws only when neither works.
export async function syncSingleScheme(
  scheme_code: string
): Promise<SyncSingleSchemeResult> {
  try {
    return await refreshNavAndHistory(scheme_code, SYNC_FETCH_TIMEOUT_MS);
  } catch (err) {
    console.error(`Full NAV history refresh failed for ${scheme_code}, falling back to latest NAV:`, err);
  }

  const latest = await fetchLatestNav(scheme_code);
  if (!latest) {
    throw new Error(`No NAV data for scheme ${scheme_code}`);
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("mf_nav_cache").upsert({
    scheme_code,
    scheme_name: latest.schemeName || null,
    nav: latest.nav,
    nav_date: latest.navDate,
    fetched_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to upsert nav cache for ${scheme_code}: ${error.message}`);
  }

  return { nav: latest.nav, nav_date: latest.navDate };
}

export interface SyncAllHoldingsResult {
  synced: number;
  failed: number;
  errors: string[];
  // manual-* placeholder codes that were matched to a real mfapi.in scheme
  // during this sync (see resolveManualSchemeCodes).
  resolved?: { scheme_name: string; scheme_code: string }[];
}

async function syncSchemeCodes(schemeCodes: string[]): Promise<SyncAllHoldingsResult> {
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < schemeCodes.length; i += SYNC_CONCURRENCY) {
    const batch = schemeCodes.slice(i, i + SYNC_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((code) => syncSingleScheme(code)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") {
        synced++;
      } else {
        failed++;
        errors.push(`${batch[j]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
    });
    if (i + SYNC_CONCURRENCY < schemeCodes.length) {
      await sleep(MFAPI_DELAY_MS);
    }
  }

  return { synced, failed, errors };
}

// Holdings whose scheme couldn't be resolved at import time get a
// `manual-<ts>` placeholder code, which never has a NAV (so the fund shows
// current value = invested) and never gets a peer rank. The import-time
// search was a plain substring match that missed common spelling
// differences ("Midcap" vs "Mid Cap", "and" vs "&"); searchDirectGrowthScheme
// now tries those variants, so retry every placeholder here and, only on a
// confident Direct+Growth match (strict mode), re-point the lots (and their
// ledger rows) at the real code.
async function resolveManualSchemeCodes(
  userId: string
): Promise<{ scheme_name: string; scheme_code: string }[]> {
  const supabase = createServiceRoleClient();
  const { data: rows, error } = await supabase
    .from("mf_holdings")
    .select("scheme_code, scheme_name")
    .eq("user_id", userId);
  if (error || !rows) return [];

  const placeholdersByName = new Map<string, Set<string>>();
  for (const r of rows) {
    const code = r.scheme_code as string | null;
    if (code && isRealSchemeCode(code)) continue;
    const name = (r.scheme_name as string).trim();
    const set = placeholdersByName.get(name) ?? new Set<string>();
    if (code) set.add(code);
    placeholdersByName.set(name, set);
  }

  const names = Array.from(placeholdersByName.keys()).slice(0, MAX_MANUAL_RESOLUTIONS);
  const resolved: { scheme_name: string; scheme_code: string }[] = [];

  await Promise.all(
    names.map(async (name) => {
      // Strict: a Direct+Growth match scoring >= 0.75 or nothing — these
      // lots are re-pointed without anyone reviewing the match.
      const match = await searchDirectGrowthScheme(name, { strict: true });
      if (!match || !isRealSchemeCode(match.scheme_code)) return;
      const oldCodes = Array.from(placeholdersByName.get(name) ?? []);
      try {
        const { error: holdingsErr } = await supabase
          .from("mf_holdings")
          .update({ scheme_code: match.scheme_code })
          .eq("user_id", userId)
          .eq("scheme_name", name)
          .in("scheme_code", oldCodes);
        if (holdingsErr) throw holdingsErr;

        await supabase
          .from("mf_transactions")
          .update({ scheme_code: match.scheme_code })
          .eq("user_id", userId)
          .eq("scheme_name", name)
          .in("scheme_code", oldCodes);
        await supabase
          .from("mf_transactions")
          .update({ scheme_code: match.scheme_code })
          .eq("user_id", userId)
          .eq("scheme_name", name)
          .is("scheme_code", null);

        resolved.push({ scheme_name: name, scheme_code: match.scheme_code });
      } catch (err) {
        console.error(`Failed to re-point manual scheme code for "${name}":`, err);
      }
    })
  );

  return resolved;
}

// Fetches and upserts the latest NAV for every distinct scheme_code held by
// the given user. Never throws — accumulates per-scheme failures instead.
export async function syncAllHoldings(userId: string): Promise<SyncAllHoldingsResult> {
  let resolved: { scheme_name: string; scheme_code: string }[] = [];
  try {
    resolved = await resolveManualSchemeCodes(userId);
  } catch (err) {
    console.error("resolveManualSchemeCodes failed:", err);
  }

  const supabase = createServiceRoleClient();

  const { data: holdings, error } = await supabase
    .from("mf_holdings")
    .select("scheme_code")
    .eq("user_id", userId);

  if (error) {
    return { synced: 0, failed: 0, errors: [error.message], resolved };
  }

  const schemeCodes = Array.from(
    new Set((holdings ?? []).map((h) => h.scheme_code as string).filter((c) => c && isRealSchemeCode(c)))
  );

  return { ...(await syncSchemeCodes(schemeCodes)), resolved };
}

// Fetches and upserts the latest NAV for every distinct scheme_code held by
// any user — used by the daily cron job.
export async function syncAllHoldingsForAllUsers(): Promise<SyncAllHoldingsResult> {
  const supabase = createServiceRoleClient();

  const { data: holdings, error } = await supabase
    .from("mf_holdings")
    .select("scheme_code");

  if (error) {
    return { synced: 0, failed: 0, errors: [error.message] };
  }

  const schemeCodes = Array.from(
    new Set((holdings ?? []).map((h) => h.scheme_code as string).filter((c) => c && isRealSchemeCode(c)))
  );

  return syncSchemeCodes(schemeCodes);
}
