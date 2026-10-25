import type { NavPoint } from "@/lib/mfapi";

// Pure helpers behind GET /api/mf/portfolio/history: replays the current
// lots against each fund's NAV history to get "cumulative invested" vs
// "market value" over time.
//
// Caveat: this works from the lots held today. Units that were sold earlier
// aren't in mf_holdings any more, so past market value only counts what's
// still held (it's the history of the current portfolio, not of every
// rupee ever invested).

export interface HistoryLot {
  scheme_code: string | null;
  as_on_date: string; // ISO yyyy-mm-dd
  units: number;
  invested: number;
  avg_nav: number;
}

export interface HistoryPoint {
  date: string;
  invested: number;
  value: number;
}

export interface DayChange {
  amount: number;
  pct: number;
  as_of: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function monthEnd(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
}

// Month-ends from the first purchase up to a year ago, then weekly points
// for the most recent year (so 6M/1Y ranges aren't just 6–12 dots), then today.
export function buildSampleDates(firstIso: string, todayIso: string): string[] {
  const dates = new Set<string>();
  const weeklyFrom = isoAddDays(todayIso, -365);

  const [fy, fm] = firstIso.split("-").map(Number);
  let y = fy;
  let m = fm - 1;
  for (;;) {
    const end = monthEnd(y, m);
    if (end >= weeklyFrom) break;
    if (end >= firstIso) dates.add(end);
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }

  for (let d = todayIso; d >= weeklyFrom; d = isoAddDays(d, -7)) {
    if (d >= firstIso) dates.add(d);
  }
  dates.add(firstIso);
  dates.add(todayIso);

  return Array.from(dates).sort();
}

// Latest NAV on or before `iso` (NAVs aren't published on weekends/holidays).
export function navOn(points: NavPoint[], iso: string): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].date <= iso) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 ? points[found].nav : null;
}

export function buildPortfolioSeries(
  lots: HistoryLot[],
  histories: Map<string, NavPoint[]>,
  dates: string[]
): HistoryPoint[] {
  return dates.map((date) => {
    let invested = 0;
    let value = 0;
    for (const lot of lots) {
      if (lot.as_on_date > date) continue;
      invested += lot.invested;
      const history = lot.scheme_code ? histories.get(lot.scheme_code) : undefined;
      // No history (manual code, or mfapi.in didn't answer) or no NAV yet on
      // this date — value the lot at cost rather than dropping it.
      const nav = history ? navOn(history, date) : null;
      value += lot.units * (nav ?? lot.avg_nav);
    }
    return { date, invested: Math.round(invested), value: Math.round(value) };
  });
}

// Same bound as getNavHistories: beyond this the "previous" point isn't the
// previous trading day.
const MAX_DAY_CHANGE_GAP_DAYS = 4;

// Latest NAV vs the previous trading day's NAV, summed over lots. Only
// returned when every lot has a fresh history (none in `dayChangeStale`, last
// two points at most MAX_DAY_CHANGE_GAP_DAYS apart) — a partial or multi-day
// figure would be misleading next to the full-portfolio value.
export function computeDayChange(
  lots: HistoryLot[],
  histories: Map<string, NavPoint[]>,
  dayChangeStale: Set<string> = new Set()
): DayChange | null {
  if (lots.length === 0) return null;
  let amount = 0;
  let previousValue = 0;
  let asOf = "";
  for (const lot of lots) {
    if (!lot.scheme_code || dayChangeStale.has(lot.scheme_code)) return null;
    const history = histories.get(lot.scheme_code);
    if (!history || history.length < 2) return null;
    const latest = history[history.length - 1];
    const prev = history[history.length - 2];
    const gapDays = Math.round(
      (new Date(`${latest.date}T00:00:00Z`).getTime() - new Date(`${prev.date}T00:00:00Z`).getTime()) / DAY_MS
    );
    if (gapDays > MAX_DAY_CHANGE_GAP_DAYS) return null;
    // Bought at the latest NAV — it had no previous-day value to change from.
    if (lot.as_on_date >= latest.date) continue;
    amount += lot.units * (latest.nav - prev.nav);
    previousValue += lot.units * prev.nav;
    if (latest.date > asOf) asOf = latest.date;
  }
  if (previousValue <= 0) return null;
  return { amount: Math.round(amount), pct: (amount / previousValue) * 100, as_of: asOf };
}
