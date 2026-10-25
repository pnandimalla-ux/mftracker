// Sanity check for src/lib/analysis/xirr.ts — the project has no test
// framework, so this is a plain assertion script. Run with `npm run test:xirr`.
import { xirr, type Cashflow } from "../src/lib/analysis/xirr";

let failures = 0;

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function check(name: string, flows: Cashflow[], expected: number | null, tolerance = 1e-4) {
  const actual = xirr(flows);
  const ok =
    expected === null ? actual === null : actual !== null && Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: expected ${expected}, got ${actual}`);
}

// Invest 10,000, get 11,000 back exactly one (365-day) year later = 10%.
check("10k -> 11k after 365 days", [
  { date: d("2023-01-01"), amount: -10000 },
  { date: d("2024-01-01"), amount: 11000 },
], 0.1);

// Loss: 10,000 -> 9,000 after one year = -10%.
check("10k -> 9k after 365 days", [
  { date: d("2021-01-01"), amount: -10000 },
  { date: d("2022-01-01"), amount: 9000 },
], -0.1);

// Excel's documented XIRR example (result 0.373362535).
check("Excel XIRR doc example", [
  { date: d("2008-01-01"), amount: -10000 },
  { date: d("2008-03-01"), amount: 2750 },
  { date: d("2008-10-30"), amount: 4250 },
  { date: d("2009-02-15"), amount: 3250 },
  { date: d("2009-04-01"), amount: 2750 },
], 0.373362535, 1e-6);

// Monthly SIP of 5,000 for 12 months, worth 66,000 a year after the first
// instalment. Hand calculation: Σ 5000·(1+r)^(k/12), k=1..12 = 66000 at r ≈ 19%.
const sip: Cashflow[] = Array.from({ length: 12 }, (_, i) => ({
  date: new Date(Date.UTC(2023, i, 5)),
  amount: -5000,
}));
sip.push({ date: d("2024-01-05"), amount: 66000 });
const sipRate = xirr(sip);
const sipOk = sipRate !== null && sipRate > 0.17 && sipRate < 0.21;
if (!sipOk) failures++;
console.log(`${sipOk ? "PASS" : "FAIL"}  12-month SIP: expected ~0.19, got ${sipRate}`);

// No sign change — undefined.
check("all outflows", [
  { date: d("2023-01-01"), amount: -100 },
  { date: d("2023-06-01"), amount: -100 },
], null);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll XIRR checks passed");
