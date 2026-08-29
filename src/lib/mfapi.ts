import { createServiceRoleClient } from "@/lib/supabase/serviceRoleClient";

export interface MfapiLatestNav {
  schemeCode: string;
  schemeName: string;
  nav: number;
  navDate: string; // ISO yyyy-mm-dd
}

// mfapi.in returns dates as "DD-MM-YYYY".
function toIsoDate(mfapiDate: string): string {
  const [dd, mm, yyyy] = mfapiDate.split("-");
  if (dd && mm && yyyy) {
    return `${yyyy}-${mm}-${dd}`;
  }
  return new Date().toISOString().slice(0, 10);
}

export async function fetchLatestNav(
  schemeCode: string
): Promise<MfapiLatestNav | null> {
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}`, {
      cache: "no-store",
    });
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
    console.error(`fetchLatestNav(${schemeCode}) failed:`, err);
    return null;
  }
}

export interface MfapiNavForDate {
  scheme_code: string;
  scheme_name: string;
  nav: number;
  nav_date: string; // ISO yyyy-mm-dd, matches the requested date
}

// Looks up a scheme's full NAV history from mfapi.in and returns the entry
// matching the given ISO date, if any (mfapi.in only has entries for actual
// trading days, so callers should retry on prior days for weekends/holidays).
export async function fetchNavForDate(
  schemeCode: string,
  isoDate: string
): Promise<MfapiNavForDate | null> {
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;

    const json = await res.json();
    const rows: Array<{ date: string; nav: string }> = Array.isArray(json?.data)
      ? json.data
      : [];
    const match = rows.find((row) => toIsoDate(row.date) === isoDate);
    if (!match) return null;

    const nav = Number(match.nav);
    if (!Number.isFinite(nav)) return null;

    return {
      scheme_code: schemeCode,
      scheme_name: typeof json?.meta?.scheme_name === "string" ? json.meta.scheme_name : "",
      nav,
      nav_date: isoDate,
    };
  } catch (err) {
    console.error(`fetchNavForDate(${schemeCode}, ${isoDate}) failed:`, err);
    return null;
  }
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
