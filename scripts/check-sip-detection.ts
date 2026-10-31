// Assertion script for src/lib/sipDetection.ts — the project has no test
// framework. Run with `npm run test:sip`.
import { detectActiveSips, withPendingSips, type DetectedSip, type SipDetectionFund } from "@/lib/sipDetection";
import type { SIPFrequency } from "@/types/mf";

let failures = 0;

function fund(name: string, lots: [string, number?][]): SipDetectionFund {
  return {
    key: name,
    scheme_name: name,
    scheme_code: null,
    owner: "geetha",
    category: "Equity",
    lots: lots.map(([date, amount]) => ({ trade_date: `2026-${date}`, amount: amount ?? 10000, lot_type: "sip" })),
  };
}

interface Expected {
  frequency: SIPFrequency;
  sip_date?: number;
  amount?: number;
}

function check(name: string, lots: [string, number?][], expected: Expected[]) {
  const got: DetectedSip[] = detectActiveSips([fund(name, lots)]);
  const problems: string[] = [];
  if (got.length !== expected.length) {
    problems.push(`expected ${expected.length} schedule(s), got ${got.length}`);
  } else {
    const sortedGot = [...got].sort((a, b) => a.sip_date - b.sip_date);
    const sortedExp = [...expected].sort((a, b) => (a.sip_date ?? 0) - (b.sip_date ?? 0));
    sortedExp.forEach((e, i) => {
      const g = sortedGot[i];
      if (g.frequency !== e.frequency) problems.push(`#${i} frequency ${g.frequency} != ${e.frequency}`);
      if (e.sip_date !== undefined && g.sip_date !== e.sip_date) problems.push(`#${i} day ${g.sip_date} != ${e.sip_date}`);
      if (e.amount !== undefined && g.amount !== e.amount) problems.push(`#${i} amount ${g.amount} != ${e.amount}`);
    });
  }
  const keys = new Set(got.map((g) => g.key));
  if (keys.size !== got.length) problems.push("candidate keys are not unique");

  const summary = got.map((g) => `${g.frequency}@${g.sip_date} ₹${g.amount}`).join(", ");
  if (problems.length > 0) failures++;
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${name}: [${summary}]${problems.length ? " — " + problems.join("; ") : ""}`);
}

check("DSP T.I.G.E.R. (1st + 16th)", [["10-01"], ["10-16"]], [
  { frequency: "monthly", sip_date: 1 },
  { frequency: "monthly", sip_date: 16 },
]);
check("DSP T.I.G.E.R. + 31st lot", [["10-01"], ["10-16"], ["10-31"]], [
  { frequency: "monthly", sip_date: 1 },
  { frequency: "monthly", sip_date: 16 },
]);
check("Kotak MNC", [["10-09"], ["10-24"]], [
  { frequency: "monthly", sip_date: 9 },
  { frequency: "monthly", sip_date: 24 },
]);
check("Kotak Multi Cap", [["10-05"], ["10-23"]], [
  { frequency: "monthly", sip_date: 5 },
  { frequency: "monthly", sip_date: 23 },
]);
check("Kotak Multi Asset Allocation", [["10-06"], ["10-17"]], [
  { frequency: "monthly", sip_date: 6 },
  { frequency: "monthly", sip_date: 17 },
]);
check("Quant Value", [["10-05", 10000], ["10-21", 11000]], [
  { frequency: "monthly", sip_date: 5, amount: 10000 },
  { frequency: "monthly", sip_date: 21, amount: 11000 },
]);
check("Mirae Banking & FS", [["10-07", 5000], ["10-25", 10000]], [
  { frequency: "monthly", sip_date: 7, amount: 5000 },
  { frequency: "monthly", sip_date: 25, amount: 10000 },
]);
check("Quant Aggressive Hybrid (weekly)", [["10-05"], ["10-12"], ["10-19"], ["10-26"]], [
  { frequency: "weekly" },
]);
check("DSP Small Cap (single lot)", [["10-19"]], [{ frequency: "monthly", sip_date: 19 }]);
check("Two months, one SIP", [["09-05"], ["10-06"]], [{ frequency: "monthly", sip_date: 5 }]);
check("Bi-weekly", [["09-01"], ["09-15"], ["09-29"], ["10-13"], ["10-27"]], [{ frequency: "bi-weekly" }]);
// Not in the brief: a 1st + 16th SIP over two months must stay two monthly
// schedules (gaps ~15 days could otherwise look bi-weekly).
check("1st + 16th over two months", [["09-01"], ["09-16"], ["10-01"], ["10-16"]], [
  { frequency: "monthly", sip_date: 1 },
  { frequency: "monthly", sip_date: 16 },
]);
// Drift check must be circular: a 1st that executes on the 31st (or 30th)
// is 1–2 days from the cluster's day, not 30.
check("T.I.G.E.R. 1st+16th, 1st executed early on 31st", [
  ["10-01"], ["10-16"], ["10-31"], ["11-16"], ["12-01"], ["12-16"],
], [
  { frequency: "monthly", sip_date: 1 },
  { frequency: "monthly", sip_date: 16 },
]);
check("T.I.G.E.R. 1st+16th, 1st executed early on 30th", [
  ["10-01"], ["10-16"], ["10-31"], ["11-16"], ["11-30"], ["12-16"],
], [
  { frequency: "monthly", sip_date: 1 },
  { frequency: "monthly", sip_date: 16 },
]);

// Pending (PROCESSING) SIP orders count as SIP dates.
function checkWithPending(name: string, complete: string[], pending: string[], expected: Expected[]) {
  const base = complete.length > 0 ? [{ ...fund(name, complete.map((d) => [d] as [string])), isin: "INF000TEST" }] : [];
  const merged = withPendingSips(
    base,
    pending.map((d) => ({
      isin: "INF000TEST",
      scheme_name: name,
      scheme_code: null,
      owner: "geetha" as const,
      category: "Equity",
      amount: 10000,
      trade_date: `2026-${d}`,
      lot_type: "sip",
    }))
  );
  const got = detectActiveSips(merged);
  const problems: string[] = [];
  if (got.length !== expected.length) problems.push(`expected ${expected.length} schedule(s), got ${got.length}`);
  else {
    const g = [...got].sort((a, b) => a.sip_date - b.sip_date);
    expected.forEach((e, i) => {
      if (g[i].frequency !== e.frequency) problems.push(`#${i} frequency ${g[i].frequency} != ${e.frequency}`);
      if (e.sip_date !== undefined && g[i].sip_date !== e.sip_date) problems.push(`#${i} day ${g[i].sip_date} != ${e.sip_date}`);
    });
  }
  if (problems.length > 0) failures++;
  const summary = got.map((x) => `${x.frequency}@${x.sip_date}`).join(", ");
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${name}: [${summary}]${problems.length ? " — " + problems.join("; ") : ""}`);
}

checkWithPending("T.I.G.E.R. complete 1st+16th + pending 31st", ["10-01", "10-16"], ["10-31"], [
  { frequency: "monthly", sip_date: 1 },
  { frequency: "monthly", sip_date: 16 },
]);
checkWithPending("Only a pending SIP on the 31st", [], ["10-31"], [{ frequency: "monthly", sip_date: 31 }]);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll SIP detection checks passed");
