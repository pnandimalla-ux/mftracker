import { createServiceRoleClient } from "@/lib/supabase/serviceRoleClient";

const MFAPI_TIMEOUT_MS = 5000;
const NAV_HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const RECENT_DAYS_THRESHOLD = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface MfapiLatestNav {
  schemeCode: string;
  schemeName: string;
  nav: number;
  navDate: string; // ISO yyyy-mm-dd
}

export interface MfapiSchemeMatch {
  scheme_code: string;
  scheme_name: string;
}

export interface MfapiSchemeMeta {
  mf_api_category: string;
  fund_house: string;
}

// Cached per warm server instance — a sync run touching the same scheme
// repeatedly (tier1/tier2 sweeps) shouldn't re-fetch its meta every time.
const schemeMetaCache = new Map<string, MfapiSchemeMeta | null>();

// Fetches a scheme's raw mfapi.in category (meta.scheme_category, e.g.
// "Equity Scheme - Sectoral/Thematic") and fund house — used to derive an
// accurate peer_group via derivePeerGroup() instead of the broad SEBI
// category alone.
export async function fetchSchemeMeta(schemeCode: string): Promise<MfapiSchemeMeta | null> {
  if (schemeMetaCache.has(schemeCode)) {
    return schemeMetaCache.get(schemeCode) ?? null;
  }
  try {
    const res = await fetchWithTimeout(`https://api.mfapi.in/mf/${schemeCode}/latest`);
    if (!res.ok) {
      schemeMetaCache.set(schemeCode, null);
      return null;
    }
    const json = await res.json();
    const category = json?.meta?.scheme_category;
    const fundHouse = json?.meta?.fund_house;
    if (typeof category !== "string" || !category) {
      schemeMetaCache.set(schemeCode, null);
      return null;
    }
    const meta: MfapiSchemeMeta = {
      mf_api_category: category,
      fund_house: typeof fundHouse === "string" ? fundHouse : "",
    };
    schemeMetaCache.set(schemeCode, meta);
    return meta;
  } catch (err) {
    console.error(`fetchSchemeMeta(${schemeCode}) failed:`, err);
    schemeMetaCache.set(schemeCode, null);
    return null;
  }
}

// Searches mfapi.in for a fund name and returns the first Direct Plan +
// Growth option result — used when importing holdings from a source (Coin
// CSV, CAS) whose ISIN isn't in a known local mapping. Falls back to the
// first result of any kind if no Direct+Growth match is found.
export async function searchDirectGrowthScheme(query: string): Promise<MfapiSchemeMatch | null> {
  try {
    const res = await fetchWithTimeout(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return null;

    const results = await res.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    const directGrowth = results.find(
      (r: { schemeName?: string }) =>
        typeof r.schemeName === "string" &&
        /direct/i.test(r.schemeName) &&
        /growth/i.test(r.schemeName) &&
        !/idcw|dividend/i.test(r.schemeName)
    );

    const match = directGrowth ?? results[0];
    if (!match || typeof match.schemeCode === "undefined") return null;

    return { scheme_code: String(match.schemeCode), scheme_name: String(match.schemeName) };
  } catch (err) {
    console.error(`searchDirectGrowthScheme("${query}") failed:`, err);
    return null;
  }
}

// mfapi.in returns dates as "DD-MM-YYYY".
function toIsoDate(mfapiDate: string): string {
  const [dd, mm, yyyy] = mfapiDate.split("-");
  if (dd && mm && yyyy) {
    return `${yyyy}-${mm}-${dd}`;
  }
  return new Date().toISOString().slice(0, 10);
}

// mfapi.in can take seconds to respond (or hang) — never let a request to it
// block ours indefinitely.
async function fetchWithTimeout(url: string, timeoutMs = MFAPI_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Fetches just the latest NAV via mfapi.in's lightweight /latest endpoint —
// a tiny payload instead of the full multi-year history. Falls back to the
// full-history endpoint (still capped by the same timeout) if /latest is
// unavailable or returns something unexpected.
export async function fetchLatestNav(schemeCode: string): Promise<MfapiLatestNav | null> {
  const fast = await fetchLatestNavFast(schemeCode);
  if (fast) return fast;
  return fetchLatestNavFromFullHistory(schemeCode);
}

export async function fetchLatestNavFast(schemeCode: string): Promise<MfapiLatestNav | null> {
  try {
    const res = await fetchWithTimeout(`https://api.mfapi.in/mf/${schemeCode}/latest`);
    if (!res.ok) return null;

    const json = await res.json();
    const latest = json?.data?.[0];
    if (!latest || typeof latest.nav !== "string") return null;

    const nav = Number(latest.nav);
    if (!Number.isFinite(nav)) return null;

    return {
      schemeCode,
      schemeName: typeof json?.meta?.scheme_name === "string" ? json.meta.scheme_name : "",
      nav,
      navDate: toIsoDate(String(latest.date)),
    };
  } catch (err) {
    console.error(`fetchLatestNavFast(${schemeCode}) failed:`, err);
    return null;
  }
}

async function fetchLatestNavFromFullHistory(schemeCode: string): Promise<MfapiLatestNav | null> {
  try {
    const res = await fetchWithTimeout(`https://api.mfapi.in/mf/${schemeCode}`);
    if (!res.ok) return null;

    const json = await res.json();
    const latest = json?.data?.[0];
    if (!latest || typeof latest.nav !== "string") return null;

    const nav = Number(latest.nav);
    if (!Number.isFinite(nav)) return null;

    return {
      schemeCode,
      schemeName: typeof json?.meta?.scheme_name === "string" ? json.meta.scheme_name : "",
      nav,
      navDate: toIsoDate(String(latest.date)),
    };
  } catch (err) {
    console.error(`fetchLatestNavFromFullHistory(${schemeCode}) failed:`, err);
    return null;
  }
}

export interface MfapiNavForDate {
  scheme_code: string;
  scheme_name: string;
  nav: number;
  nav_date: string; // ISO yyyy-mm-dd, matches the requested date
}

interface MfapiHistoryEntry {
  date: string;
  nav: string;
}

// Best-effort: ensures mf_nav_cache has the nav_history/nav_history_fetched_at
// columns used to cache full NAV histories. Cheap and idempotent (ADD COLUMN
// IF NOT EXISTS), but we still only attempt it once per warm server instance.
let ensureNavHistoryColumnsPromise: Promise<void> | null = null;

function ensureNavHistoryColumns(): Promise<void> {
  if (!ensureNavHistoryColumnsPromise) {
    ensureNavHistoryColumnsPromise = (async () => {
      try {
        const supabase = createServiceRoleClient();
        await supabase.rpc("exec_sql", {
          sql: `
            alter table mf_nav_cache add column if not exists nav_history jsonb;
            alter table mf_nav_cache add column if not exists nav_history_fetched_at timestamptz;
          `,
        });
      } catch (err) {
        console.error("Failed to ensure mf_nav_cache.nav_history columns exist:", err);
      }
    })();
  }
  return ensureNavHistoryColumnsPromise;
}

async function getCachedNavHistory(
  schemeCode: string
): Promise<{ history: MfapiHistoryEntry[]; schemeName: string } | null> {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("mf_nav_cache")
      .select("scheme_name, nav_history, nav_history_fetched_at")
      .eq("scheme_code", schemeCode)
      .maybeSingle();

    if (error || !data) return null;

    const fetchedAt = data.nav_history_fetched_at as string | null;
    const history = data.nav_history as MfapiHistoryEntry[] | null;

    if (
      !fetchedAt ||
      !Array.isArray(history) ||
      history.length === 0 ||
      Date.now() - new Date(fetchedAt).getTime() > NAV_HISTORY_TTL_MS
    ) {
      return null;
    }

    return { history, schemeName: (data.scheme_name as string | null) ?? "" };
  } catch (err) {
    console.error(`getCachedNavHistory(${schemeCode}) failed:`, err);
    return null;
  }
}

async function fetchAndCacheNavHistory(
  schemeCode: string
): Promise<{ history: MfapiHistoryEntry[]; schemeName: string } | null> {
  const res = await fetchWithTimeout(`https://api.mfapi.in/mf/${schemeCode}`);
  if (!res.ok) return null;

  const json = await res.json();
  const history: MfapiHistoryEntry[] = Array.isArray(json?.data) ? json.data : [];
  if (history.length === 0) return null;

  const schemeName = typeof json?.meta?.scheme_name === "string" ? json.meta.scheme_name : "";

  await ensureNavHistoryColumns();
  try {
    const supabase = createServiceRoleClient();
    await supabase.from("mf_nav_cache").upsert({
      scheme_code: schemeCode,
      scheme_name: schemeName || null,
      nav_history: history,
      nav_history_fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`Failed to cache nav_history for ${schemeCode}:`, err);
  }

  return { history, schemeName };
}

async function fetchNavForDateFromHistory(
  schemeCode: string,
  isoDate: string
): Promise<MfapiNavForDate | null> {
  try {
    const cached = await getCachedNavHistory(schemeCode);
    const { history, schemeName } = cached ?? (await fetchAndCacheNavHistory(schemeCode)) ?? {
      history: [],
      schemeName: "",
    };

    const match = history.find((row) => toIsoDate(row.date) === isoDate);
    if (!match) return null;

    const nav = Number(match.nav);
    if (!Number.isFinite(nav)) return null;

    return { scheme_code: schemeCode, scheme_name: schemeName, nav, nav_date: isoDate };
  } catch (err) {
    console.error(`fetchNavForDateFromHistory(${schemeCode}, ${isoDate}) failed:`, err);
    return null;
  }
}

// Looks up a scheme's NAV for a given date. Recent dates (within a few days
// of today) are served from mfapi.in's lightweight /latest endpoint; older
// dates fall back to the full NAV history, which is cached in mf_nav_cache
// for 24 hours so a second lookup for the same fund is instant.
export async function fetchNavForDate(
  schemeCode: string,
  isoDate: string
): Promise<MfapiNavForDate | null> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const diffDays = Math.round(
    (new Date(`${todayIso}T00:00:00Z`).getTime() - new Date(`${isoDate}T00:00:00Z`).getTime()) /
      DAY_MS
  );

  if (diffDays >= 0 && diffDays <= RECENT_DAYS_THRESHOLD) {
    const latest = await fetchLatestNavFast(schemeCode);
    if (latest) {
      return {
        scheme_code: schemeCode,
        scheme_name: latest.schemeName,
        nav: latest.nav,
        nav_date: latest.navDate,
      };
    }
  }

  return fetchNavForDateFromHistory(schemeCode, isoDate);
}

// Best-effort: fetches the latest NAV for a scheme and upserts it into the
// shared mf_nav_cache table (via the service-role client, since regular
// users only have SELECT access to that table). Never throws.
export async function refreshNavCache(schemeCode: string): Promise<void> {
  try {
    const latest = await fetchLatestNav(schemeCode);
    if (!latest) return;

    const supabase = createServiceRoleClient();
    await supabase.from("mf_nav_cache").upsert({
      scheme_code: latest.schemeCode,
      scheme_name: latest.schemeName || null,
      nav: latest.nav,
      nav_date: latest.navDate,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`refreshNavCache(${schemeCode}) failed:`, err);
  }
}
