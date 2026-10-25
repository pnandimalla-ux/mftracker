// XIRR — the annualised rate r that makes the net present value of a set of
// dated cashflows zero:  Σ amount_i / (1 + r)^((date_i - date_0) / 365) = 0.
// Convention: money invested is negative, money received (redemptions, the
// portfolio's current value "today") is positive.
//
// Newton-Raphson converges fast from a sensible guess but can diverge or hit
// a zero derivative on awkward cashflow shapes, so it falls back to plain
// bisection over a wide bracket. Returns null when there is no sign change
// (all inflows or all outflows) or neither method converges.

export interface Cashflow {
  date: Date;
  amount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TOLERANCE = 1e-7;
const MAX_NEWTON_ITERATIONS = 100;
const MAX_BISECTION_ITERATIONS = 300;
// Rates below -100% are undefined ((1 + r) must stay positive).
const MIN_RATE = -0.9999;
const MAX_RATE = 100;

interface PreparedFlow {
  years: number;
  amount: number;
}

function npv(flows: PreparedFlow[], rate: number): number {
  let total = 0;
  for (const f of flows) total += f.amount / Math.pow(1 + rate, f.years);
  return total;
}

function npvDerivative(flows: PreparedFlow[], rate: number): number {
  let total = 0;
  for (const f of flows) {
    if (f.years === 0) continue;
    total -= (f.years * f.amount) / Math.pow(1 + rate, f.years + 1);
  }
  return total;
}

function newton(flows: PreparedFlow[], guess: number): number | null {
  let rate = guess;
  for (let i = 0; i < MAX_NEWTON_ITERATIONS; i++) {
    const value = npv(flows, rate);
    const deriv = npvDerivative(flows, rate);
    if (!Number.isFinite(value) || !Number.isFinite(deriv) || deriv === 0) return null;
    const next = rate - value / deriv;
    if (!Number.isFinite(next) || next <= -1) return null;
    if (Math.abs(next - rate) < TOLERANCE) {
      return Math.abs(npv(flows, next)) < 1e-4 * scale(flows) ? next : null;
    }
    rate = next;
  }
  return null;
}

function bisection(flows: PreparedFlow[]): number | null {
  let lo = MIN_RATE;
  let hi = MAX_RATE;
  let fLo = npv(flows, lo);
  const fHi = npv(flows, hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;

  for (let i = 0; i < MAX_BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(flows, mid);
    if (Math.abs(fMid) < 1e-6 * scale(flows) || (hi - lo) / 2 < TOLERANCE) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return null;
}

// Largest absolute flow — used to make convergence checks relative to the
// portfolio size (₹ crore vs ₹ thousand portfolios need the same accuracy).
function scale(flows: PreparedFlow[]): number {
  return Math.max(1, ...flows.map((f) => Math.abs(f.amount)));
}

// Returns the rate as a fraction (0.1 = 10% p.a.), or null.
export function xirr(cashflows: Cashflow[], guess = 0.1): number | null {
  const valid = cashflows.filter(
    (c) => c.date instanceof Date && !Number.isNaN(c.date.getTime()) && Number.isFinite(c.amount) && c.amount !== 0
  );
  if (valid.length < 2) return null;
  if (!valid.some((c) => c.amount > 0) || !valid.some((c) => c.amount < 0)) return null;

  const t0 = Math.min(...valid.map((c) => c.date.getTime()));
  const flows: PreparedFlow[] = valid.map((c) => ({
    years: (c.date.getTime() - t0) / DAY_MS / 365,
    amount: c.amount,
  }));

  // All flows on the same day — no time elapsed, rate is undefined.
  if (flows.every((f) => f.years === 0)) return null;

  const viaNewton = newton(flows, guess);
  if (viaNewton !== null && viaNewton > MIN_RATE) return viaNewton;
  return bisection(flows);
}
