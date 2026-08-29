import { createServiceRoleClient } from "@/lib/supabase/serviceRoleClient";

const MFAPI_DELAY_MS = 150;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// mfapi.in returns dates as "DD-MM-YYYY".
function toIsoDate(mfapiDate: string): string {
  const [dd, mm, yyyy] = mfapiDate.split("-");
  if (dd && mm && yyyy) {
    return `${yyyy}-${mm}-${dd}`;
  }
  return new Date().toISOString().slice(0, 10);
}

export interface SyncSingleSchemeResult {
  nav: number;
  nav_date: string;
}

// Fetches the latest NAV for one scheme from mfapi.in and upserts it into
// mf_nav_cache. Throws on failure so callers can decide how to handle it.
export async function syncSingleScheme(
  scheme_code: string
): Promise<SyncSingleSchemeResult> {
  const res = await fetch(`https://api.mfapi.in/mf/${scheme_code}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`mfapi.in returned ${res.status} for scheme ${scheme_code}`);
  }

  const json = await res.json();
  const latest = json?.data?.[0];
  if (!latest || typeof latest.nav !== "string") {
    throw new Error(`No NAV data for scheme ${scheme_code}`);
  }

  const nav = Number(latest.nav);
  if (!Number.isFinite(nav)) {
    throw new Error(`Invalid NAV value for scheme ${scheme_code}`);
  }

  const nav_date = toIsoDate(String(latest.date));
  const scheme_name =
    typeof json?.meta?.scheme_name === "string" ? json.meta.scheme_name : null;

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("mf_nav_cache").upsert({
    scheme_code,
    scheme_name,
    nav,
    nav_date,
    fetched_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to upsert nav cache for ${scheme_code}: ${error.message}`);
  }

  return { nav, nav_date };
}

export interface SyncAllHoldingsResult {
  synced: number;
  failed: number;
  errors: string[];
}

// Fetches and upserts the latest NAV for every distinct scheme_code held by
// the given user. Never throws — accumulates per-scheme failures instead.
export async function syncAllHoldings(userId: string): Promise<SyncAllHoldingsResult> {
  const supabase = createServiceRoleClient();

  const { data: holdings, error } = await supabase
    .from("mf_holdings")
    .select("scheme_code")
    .eq("user_id", userId);

  if (error) {
    return { synced: 0, failed: 0, errors: [error.message] };
  }

  const schemeCodes = Array.from(
    new Set((holdings ?? []).map((h) => h.scheme_code as string).filter(Boolean))
  );

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < schemeCodes.length; i++) {
    const schemeCode = schemeCodes[i];
    try {
      await syncSingleScheme(schemeCode);
      synced++;
    } catch (err) {
      failed++;
      errors.push(
        `${schemeCode}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (i < schemeCodes.length - 1) {
      await sleep(MFAPI_DELAY_MS);
    }
  }

  return { synced, failed, errors };
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
    new Set((holdings ?? []).map((h) => h.scheme_code as string).filter(Boolean))
  );

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < schemeCodes.length; i++) {
    const schemeCode = schemeCodes[i];
    try {
      await syncSingleScheme(schemeCode);
      synced++;
    } catch (err) {
      failed++;
      errors.push(
        `${schemeCode}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (i < schemeCodes.length - 1) {
      await sleep(MFAPI_DELAY_MS);
    }
  }

  return { synced, failed, errors };
}
