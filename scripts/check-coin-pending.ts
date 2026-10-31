// Assertion script for PROCESSING / FAILED rows in src/lib/parsers/coinCsvParser.ts.
// Run with `npm run test:pending`. mfapi.in is stubbed out so this runs
// offline and deterministically (scheme_code resolves to null).
import { parseCoinCsv } from "@/lib/parsers/coinCsvParser";

globalThis.fetch = (async () =>
  new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

const CSV = [
  "client_id,isin,scheme_name,plan,transaction_mode,settlement_id,trade_date,ordered_at,folio_number,amount,units,nav,status,exchange_order_id,remarks,tag",
  "EKT509,INF740K01PU7,DSP India T.I.G.E.R. Fund,,BUY,,31/10/2026,03:16 AM,,10000,0,0,PROCESSING,,Pending execution (UPI Autopay SIP),coiniossip",
  "EKT509,INF740K01PU7,DSP India T.I.G.E.R. Fund,,BUY,S1001,01/10/2026,03:10 AM,F123,10000,30.5,327.87,COMPLETE,E1001,,coiniossip",
  "EKT509,INF740K01PU7,DSP India T.I.G.E.R. Fund,,BUY,S1016,16/10/2026,03:12 AM,F123,10000,30.1,332.22,COMPLETE,E1016,,coiniossip",
  "EKT509,INF205K01UP5,Invesco India Contra Fund,,BUY,,20/10/2026,10:00 AM,,5000,0,0,FAILED,,Payment failed,coinweb",
  "EKT509,INF204KB14I2,Nippon India ETF Nifty BeES,,BUY,,30/10/2026,09:30 AM,,2000,0,0,PROCESSING,,Pending execution,coinweb",
].join("\n");

let failures = 0;
function assert(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

(async () => {
  const result = await parseCoinCsv(CSV);

  const p = result.pending_orders;
  assert("exactly 1 pending order", p.length === 1, `got ${p.length}`);
  const tiger = p[0];
  assert(
    "pending is T.I.G.E.R. sip ₹10000 on 2026-10-31 for geetha",
    !!tiger &&
      tiger.isin === "INF740K01PU7" &&
      tiger.lot_type === "sip" &&
      tiger.amount === 10000 &&
      tiger.trade_date === "2026-10-31" &&
      tiger.owner === "geetha",
    JSON.stringify(tiger)
  );
  assert("pending keeps ordered_at + remarks", tiger?.ordered_at === "03:16 AM" && tiger?.remarks.includes("UPI Autopay"));

  assert("1 cancelled order", result.cancelled_orders.length === 1, `got ${result.cancelled_orders.length}`);
  assert("ETF is not pending", !p.some((o) => o.isin === "INF204KB14I2"));

  const fund = result.funds.find((f) => f.isin === "INF740K01PU7");
  assert("T.I.G.E.R. fund has 2 complete lots", fund?.lots.length === 2, `got ${fund?.lots.length}`);
  assert("T.I.G.E.R. total_invested is ₹20,000", fund?.total_invested === 20000, `got ${fund?.total_invested}`);
  assert("overall total_invested is ₹20,000", result.total_invested === 20000, `got ${result.total_invested}`);
  assert("geetha owner_split is ₹20,000", result.owner_split.geetha === 20000);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll pending-order parser checks passed");
})();
