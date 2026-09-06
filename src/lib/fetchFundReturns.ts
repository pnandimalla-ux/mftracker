// Fetches 1Y/3Y/5Y trailing returns for a scheme from mfapi.in's full NAV
// history. Never throws — any failure (timeout, bad response, insufficient
// history) resolves to null / null fields so a single fund lookup can never
// break a request that's fetching many funds in parallel.

interface NavEntry {
  date: string; // mfapi.in format: "DD-MM-YYYY"
  nav: string;
}

export interface FundReturns {
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
}

const TIMEOUT_MS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Nearest-date tolerance when looking for the NAV ~N days back — beyond this,
// treat it as "history doesn't go back far enough" rather than a bad match.
const TOLERANCE_MS = 10 * DAY_MS;

// mfapi.in dates are "DD-MM-YYYY", not ISO.
function parseMfapiDate(d: string): number {
  const [day, month, year] = d.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}

async function fetchWithTimeout(url: string, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

function returnForDaysBack(data: NavEntry[], latestTime: number, latestNav: number, days: number): number | null {
  const targetTime = latestTime - days * DAY_MS;
  let closest: NavEntry | null = null;
  let closestDiff = Infinity;

  for (const entry of data) {
    const entryTime = parseMfapiDate(entry.date);
    const diff = Math.abs(entryTime - targetTime);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = entry;
    }
  }

  if (!closest || closestDiff > TOLERANCE_MS) return null;

  const pastNav = Number(closest.nav);
  if (!Number.isFinite(pastNav) || pastNav <= 0) return null;

  const ret = ((latestNav - pastNav) / pastNav) * 100;
  return Math.round(ret * 100) / 100;
}

export async function fetchFundReturns(schemeCode: string): Promise<FundReturns | null> {
  try {
    const res = await fetchWithTimeout(`https://api.mfapi.in/mf/${schemeCode}`);
    if (!res.ok) return null;

    const json = await res.json();
    const data: NavEntry[] = Array.isArray(json?.data) ? json.data : [];
    if (data.length === 0) return null;

    // mfapi.in returns newest-first.
    const latest = data[0];
    const latestNav = Number(latest.nav);
    if (!Number.isFinite(latestNav) || latestNav <= 0) return null;
    const latestTime = parseMfapiDate(latest.date);

    return {
      r1y: returnForDaysBack(data, latestTime, latestNav, 365),
      r3y: returnForDaysBack(data, latestTime, latestNav, 1095),
      r5y: returnForDaysBack(data, latestTime, latestNav, 1825),
    };
  } catch (err) {
    console.error(`fetchFundReturns(${schemeCode}) failed:`, err);
    return null;
  }
}
