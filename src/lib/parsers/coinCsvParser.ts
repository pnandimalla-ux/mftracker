import Papa from "papaparse";
import { detectCategory } from "@/lib/analysis/fundCategoriser";
import { searchDirectGrowthScheme } from "@/lib/mfapi";
import { KNOWN_ISIN_MAP } from "@/lib/peers/isinMapping";
import type { Owner } from "@/types/mf";

export type LotType = "sip" | "lumpsum" | "sell";

export interface CoinLot {
  trade_date: string; // ISO yyyy-mm-dd
  amount: number;
  units: number;
  nav: number;
  settlement_id: string;
  exchange_order_id: string;
  lot_type: LotType;
  transactionType: "BUY" | "SELL";
}

export interface CoinFund {
  isin: string;
  scheme_name: string;
  scheme_code: string | null;
  owner: Owner;
  category: string;
  category_confidence: "high" | "medium" | "low";
  amc: string;
  total_invested: number;
  total_units: number;
  avg_nav: number;
  folio_number: string;
  lots: CoinLot[];
  // True when this fund's net position (buys minus sells, within this CSV)
  // is <= 0 — nothing to import, existing holdings should be removed.
  fully_exited: boolean;
  // True when SELL rows in this CSV reduced (but did not zero out) this
  // fund's position — `lots` is a single synthetic lot representing what's
  // left, not the raw purchase history.
  adjusted_for_sell: boolean;
  // Number of raw SELL rows netted into this fund's position, for display /
  // response counts. Undefined/0 when there were no sells for this fund.
  sell_txn_count?: number;
  // Only set when fully_exited: how many units this CSV's sells exceeded
  // this CSV's own buys by. This CSV alone can't tell whether that excess
  // came out of pre-existing (already-imported) holdings — the confirm
  // route applies it against existing mf_holdings via FIFO when this fund
  // turns out to be a duplicate being appended to ("add_lots").
  sell_units_excess?: number;
}

export interface ExcludedRow {
  scheme_name: string;
  isin: string;
  reason: string;
}

// A SELL row whose fund has NO buy rows in this same CSV — it can't be
// netted at parse time, so the confirm route applies it against existing
// mf_holdings rows (FIFO) instead. `matched_in_csv` is kept on the type for
// clarity at call sites even though only `false` rows ever reach this array
// (see parseCoinCsv below) — sells that netted against a same-CSV buy are
// folded into the owning CoinFund instead of appearing here.
export interface SellRow {
  scheme_name: string;
  isin: string;
  scheme_code: string | null;
  owner: Owner;
  trade_date: string;
  amount: number;
  units: number;
  settlement_id: string;
  matched_in_csv: boolean;
}

// A BUY order Coin hasn't settled yet (status PROCESSING, units/nav = 0).
// Kept out of funds[] / totals entirely — stored as mf_pending_orders until
// a later import shows it COMPLETE.
export interface PendingOrder {
  isin: string;
  scheme_name: string;
  scheme_code: string | null;
  owner: Owner;
  category: string;
  amc: string;
  lot_type: "sip" | "lumpsum";
  amount: number;
  trade_date: string; // ISO yyyy-mm-dd
  ordered_at: string;
  remarks: string;
}

// A BUY order that FAILED / was REJECTED / CANCELLED — only used to clear a
// matching pending order.
export interface CancelledOrder {
  isin: string;
  owner: Owner;
  amount: number;
  trade_date: string;
  lot_type: "sip" | "lumpsum";
}

export interface CoinParseResult {
  funds: CoinFund[];
  excluded_etfs: ExcludedRow[];
  sell_transactions: SellRow[];
  pending_orders: PendingOrder[];
  cancelled_orders: CancelledOrder[];
  total_invested: number;
  owner_split: { praveen: number; geetha: number };
  date_range: { from: string; to: string };
  errors: string[];
}

const CLIENT_ID_OWNER: Record<string, Owner> = {
  YE7266: "praveen",
  EKT509: "geetha",
};

const ETF_KEYWORDS = [
  "etf",
  "exchange traded",
  "nasdaq",
  "nifty metal",
  "nifty bees",
  "gold",
  "silver",
  "liquid bees",
];

function isEtf(schemeName: string): boolean {
  const n = schemeName.toLowerCase();
  return ETF_KEYWORDS.some((k) => n.includes(k));
}

// Common multi-word AMC names — checked longest-prefix-first so e.g. "Mirae
// Asset ..." reports amc "Mirae Asset" rather than just "Mirae".
const KNOWN_AMC_PREFIXES = [
  "motilal oswal",
  "mirae asset",
  "icici prudential",
  "nippon india",
  "aditya birla",
  "franklin templeton",
  "kotak mahindra",
  "canara robeco",
  "bank of india",
  "sundaram bnp",
  "invesco india",
  "edelweiss mutual",
  "union kbc",
  "hsbc global",
];

const ACRONYMS = new Set([
  "ETF", "MNC", "ELSS", "BSE", "NSE", "ICICI", "HDFC", "SBI", "UTI",
  "IDFC", "LIC", "BNP", "DSP", "PSU", "BFSI", "NAV", "IDCW", "NIFTY", "SENSEX",
]);

// Coin's CSV export is inconsistent about casing ("KotaK Flexicap FunD" is a
// real example seen in exports) — this normalizes word casing while leaving
// known acronyms upper-cased.
function normalizeSchemeName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed
    .split(" ")
    .map((word) => {
      const upper = word.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      if (/^[A-Za-z]+$/.test(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      return word;
    })
    .join(" ");
}

function extractAmc(normalizedName: string): string {
  const words = normalizedName.split(" ");
  const lowerWords = words.map((w) => w.toLowerCase());
  for (const prefix of KNOWN_AMC_PREFIXES) {
    const prefixWords = prefix.split(" ");
    if (prefixWords.every((pw, i) => lowerWords[i] === pw)) {
      return words.slice(0, prefixWords.length).join(" ");
    }
  }
  return words[0] ?? "";
}

// Coin exports dates as "DD/MM/YYYY" — NOT ISO, so new Date() would misparse it.
function parseCoinDate(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return raw.trim();
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseNum(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

const CANCELLED_STATUSES = new Set(["FAILED", "REJECTED", "CANCELLED"]);

// Same tag rule as COMPLETE BUY rows: only "coiniossip" is a SIP.
function buyLotType(tag: string | undefined): "sip" | "lumpsum" {
  return (tag ?? "").trim().toLowerCase() === "coiniossip" ? "sip" : "lumpsum";
}

interface PendingRow {
  client_id: string;
  isin: string;
  scheme_name: string;
  trade_date: string;
  amount: number;
  lot_type: "sip" | "lumpsum";
  ordered_at: string;
  remarks: string;
}

interface TransactionRow {
  client_id: string;
  isin: string;
  scheme_name: string;
  trade_date: string;
  folio_number: string;
  amount: number;
  units: number;
  nav: number;
  settlement_id: string;
  exchange_order_id: string;
  lot_type: LotType;
  transactionType: "BUY" | "SELL";
}

// Parses a Zerodha Coin "Order History" CSV export. Only COMPLETE orders
// become lots; PROCESSING BUY orders are returned separately as
// `pending_orders` (never in funds[] or totals). BUY rows become purchase lots; SELL rows reduce the position —
// netted against same-CSV buys where possible (see the grouping pass below),
// otherwise reported in `sell_transactions` for the confirm route to apply
// against existing mf_holdings rows.
export async function parseCoinCsv(csvText: string): Promise<CoinParseResult> {
  const errors: string[] = [];

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  for (const e of parsed.errors.slice(0, 5)) {
    errors.push(`Row ${e.row ?? "?"}: ${e.message}`);
  }

  const transactionRows: TransactionRow[] = [];
  const excluded_etfs: ExcludedRow[] = [];
  const pendingRows: PendingRow[] = [];
  const cancelledRaw: { client_id: string; isin: string; amount: number; trade_date: string; lot_type: "sip" | "lumpsum" }[] = [];

  for (const r of parsed.data) {
    const status = (r.status ?? "").trim().toUpperCase();

    // Non-COMPLETE BUY rows: PROCESSING orders become pending orders,
    // FAILED / REJECTED / CANCELLED ones only clear a matching pending order.
    // Non-COMPLETE SELL rows and ETFs are still ignored.
    if (status !== "COMPLETE") {
      const schemeName = (r.scheme_name ?? "").trim();
      const mode = (r.transaction_mode ?? "").trim().toUpperCase();
      const isin = (r.isin ?? "").trim();
      const amount = parseNum(r.amount);
      if (!schemeName || mode !== "BUY" || !isin || amount <= 0 || isEtf(schemeName)) continue;
      const base = {
        client_id: (r.client_id ?? "").trim(),
        isin,
        amount,
        trade_date: parseCoinDate(r.trade_date ?? ""),
        lot_type: buyLotType(r.tag),
      };
      if (CANCELLED_STATUSES.has(status)) {
        cancelledRaw.push(base);
      } else if (status === "PROCESSING" || parseNum(r.units) === 0 || parseNum(r.nav) === 0) {
        pendingRows.push({
          ...base,
          scheme_name: schemeName,
          ordered_at: (r.ordered_at ?? "").trim(),
          remarks: (r.remarks ?? "").trim(),
        });
      }
      continue;
    }

    const schemeNameRaw = (r.scheme_name ?? "").trim();
    if (!schemeNameRaw) continue;

    const isin = (r.isin ?? "").trim();
    const mode = (r.transaction_mode ?? "").trim().toUpperCase();
    const tradeDate = parseCoinDate(r.trade_date ?? "");
    const amount = parseNum(r.amount);
    const units = parseNum(r.units);
    const nav = parseNum(r.nav);

    if (isEtf(schemeNameRaw)) {
      if (mode === "BUY") {
        excluded_etfs.push({ scheme_name: normalizeSchemeName(schemeNameRaw), isin, reason: "ETF" });
      }
      continue;
    }

    if (mode !== "BUY" && mode !== "SELL") continue;

    // PROCESSING (not-yet-settled) rows report zero units/nav — skip for
    // both directions rather than letting them corrupt totals.
    if (units === 0 || nav === 0) continue;

    if (!isin || amount <= 0 || units <= 0) {
      errors.push(`Skipped ${mode} row for "${schemeNameRaw}" — missing ISIN, amount, or units`);
      continue;
    }

    transactionRows.push({
      client_id: (r.client_id ?? "").trim(),
      isin,
      scheme_name: schemeNameRaw,
      trade_date: tradeDate,
      folio_number: (r.folio_number ?? "").trim(),
      amount,
      units,
      nav,
      settlement_id: (r.settlement_id ?? "").trim(),
      exchange_order_id: (r.exchange_order_id ?? "").trim(),
      // SELL rows carry no `tag` — lot_type is just "sell" for those; BUY
      // rows keep the existing SIP/lumpsum detection off the `tag` column.
      lot_type:
        mode === "SELL"
          ? "sell"
          : (r.tag ?? "").trim().toLowerCase() === "coiniossip"
            ? "sip"
            : "lumpsum",
      transactionType: mode as "BUY" | "SELL",
    });
  }

  // Grouped by ISIN + client_id (not ISIN alone) so a fund held by both
  // Praveen and Geetha becomes two separate CoinFund entries, each with its
  // own single owner — matching the CSV-covers-both-accounts import flow.
  const groups = new Map<string, TransactionRow[]>();
  for (const row of transactionRows) {
    const key = `${row.isin}::${row.client_id}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const groupList = Array.from(groups.values());

  // Resolve every ISIN mfapi.in doesn't already have a known scheme_code for
  // concurrently, up front — the loop below used to `await`
  // searchDirectGrowthScheme() one ISIN at a time, which at ~1-2s per call
  // was slow enough (16+ unknown ISINs) to blow past Vercel's 60s function
  // timeout on a large CSV. A single Promise.all resolves them all in a
  // couple of seconds regardless of how many there are.
  const searchCache = new Map<string, string | null>();
  const unknownIsinRows = new Map<string, { scheme_name: string }>();
  for (const rows of groupList) {
    const isin = rows[0].isin;
    if (!KNOWN_ISIN_MAP[isin] && !unknownIsinRows.has(isin)) {
      unknownIsinRows.set(isin, rows[0]);
    }
  }
  // Pending orders resolve in the same batch — a fund that only has
  // PROCESSING rows in this CSV still needs a scheme_code.
  for (const row of pendingRows) {
    if (!KNOWN_ISIN_MAP[row.isin] && !unknownIsinRows.has(row.isin)) {
      unknownIsinRows.set(row.isin, row);
    }
  }

  await Promise.all(
    Array.from(unknownIsinRows.entries()).map(async ([isin, row]) => {
      const name = normalizeSchemeName(row.scheme_name);
      const match = await searchDirectGrowthScheme(name);
      searchCache.set(isin, match?.scheme_code ?? null);
    })
  );

  const funds: CoinFund[] = [];
  const sell_transactions: SellRow[] = [];

  for (const groupRows of groupList) {
    const first = groupRows[0];
    const isin = first.isin;
    const known = KNOWN_ISIN_MAP[isin];
    const cleanedName = known?.scheme_name ?? normalizeSchemeName(first.scheme_name);

    let scheme_code: string | null;
    let category: string;
    let category_confidence: "high" | "medium" | "low";
    let amc: string;

    if (known) {
      scheme_code = known.scheme_code;
      category = known.category;
      category_confidence = "high";
      amc = known.amc;
    } else {
      // Already resolved above — no await left in this loop.
      scheme_code = searchCache.get(isin) ?? null;
      const detection = detectCategory(cleanedName);
      category = detection.category;
      category_confidence = detection.confidence;
      amc = extractAmc(cleanedName);
    }

    const resolvedOwner = CLIENT_ID_OWNER[first.client_id];
    if (!resolvedOwner) {
      errors.push(`Unrecognized client_id "${first.client_id}" for ${cleanedName} — defaulted to Praveen`);
    }
    const owner: Owner = resolvedOwner ?? "praveen";

    const buys = groupRows.filter((r) => r.transactionType === "BUY");
    const sells = groupRows.filter((r) => r.transactionType === "SELL");

    if (buys.length === 0) {
      // No BUY rows for this fund in this CSV — these SELLs can't be netted
      // here. The confirm route applies them against existing mf_holdings.
      for (const s of sells) {
        sell_transactions.push({
          scheme_name: cleanedName,
          isin,
          scheme_code,
          owner,
          trade_date: s.trade_date,
          amount: s.amount,
          units: s.units,
          settlement_id: s.settlement_id,
          matched_in_csv: false,
        });
      }
      continue;
    }

    const total_buy_units = buys.reduce((s, r) => s + r.units, 0);
    const total_buy_amount = buys.reduce((s, r) => s + r.amount, 0);
    const avg_nav = total_buy_units > 0 ? total_buy_amount / total_buy_units : 0;

    if (sells.length === 0) {
      // No sells at all for this fund — unchanged behavior: import every
      // buy row as its own lot.
      const lots: CoinLot[] = buys
        .map((r) => ({
          trade_date: r.trade_date,
          amount: r.amount,
          units: r.units,
          nav: r.nav,
          settlement_id: r.settlement_id,
          exchange_order_id: r.exchange_order_id,
          lot_type: r.lot_type,
          transactionType: r.transactionType,
        }))
        .sort((a, b) => a.trade_date.localeCompare(b.trade_date));

      funds.push({
        isin,
        scheme_name: cleanedName,
        scheme_code,
        owner,
        category,
        category_confidence,
        amc,
        total_invested: total_buy_amount,
        total_units: total_buy_units,
        avg_nav,
        folio_number: first.folio_number,
        lots,
        fully_exited: false,
        adjusted_for_sell: false,
      });
      continue;
    }

    // Buys AND sells for the same fund in this CSV — net them before import
    // rather than importing raw buy lots that overstate the current position.
    for (const s of sells) {
      sell_transactions.push({
        scheme_name: cleanedName,
        isin,
        scheme_code,
        owner,
        trade_date: s.trade_date,
        amount: s.amount,
        units: s.units,
        settlement_id: s.settlement_id,
        matched_in_csv: true,
      });
    }

    const total_sell_units = sells.reduce((s, r) => s + r.units, 0);
    const net_units = total_buy_units - total_sell_units;

    if (net_units <= 0) {
      funds.push({
        isin,
        scheme_name: cleanedName,
        scheme_code,
        owner,
        category,
        category_confidence,
        amc,
        total_invested: 0,
        total_units: 0,
        avg_nav,
        folio_number: first.folio_number,
        lots: [],
        fully_exited: true,
        adjusted_for_sell: false,
        sell_txn_count: sells.length,
        sell_units_excess: -net_units,
      });
      continue;
    }

    const remaining_invested = net_units * avg_nav;
    const lastTradeDate = buys.map((r) => r.trade_date).sort().at(-1) ?? first.trade_date;

    const syntheticLot: CoinLot = {
      trade_date: lastTradeDate,
      amount: remaining_invested,
      units: net_units,
      nav: avg_nav,
      settlement_id: "",
      exchange_order_id: "",
      lot_type: "lumpsum",
      transactionType: "BUY",
    };

    funds.push({
      isin,
      scheme_name: cleanedName,
      scheme_code,
      owner,
      category,
      category_confidence,
      amc,
      total_invested: remaining_invested,
      total_units: net_units,
      avg_nav,
      folio_number: first.folio_number,
      lots: [syntheticLot],
      fully_exited: false,
      adjusted_for_sell: true,
      sell_txn_count: sells.length,
    });
  }

  const ownerFor = (clientId: string): Owner => CLIENT_ID_OWNER[clientId] ?? "praveen";

  const pending_orders: PendingOrder[] = pendingRows.map((row) => {
    const known = KNOWN_ISIN_MAP[row.isin];
    const cleanedName = known?.scheme_name ?? normalizeSchemeName(row.scheme_name);
    if (!CLIENT_ID_OWNER[row.client_id]) {
      errors.push(`Unrecognized client_id "${row.client_id}" for pending ${cleanedName} — defaulted to Praveen`);
    }
    return {
      isin: row.isin,
      scheme_name: cleanedName,
      scheme_code: known ? known.scheme_code : searchCache.get(row.isin) ?? null,
      owner: ownerFor(row.client_id),
      category: known ? known.category : detectCategory(cleanedName).category,
      amc: known ? known.amc : extractAmc(cleanedName),
      lot_type: row.lot_type,
      amount: row.amount,
      trade_date: row.trade_date,
      ordered_at: row.ordered_at,
      remarks: row.remarks,
    };
  });

  const cancelled_orders: CancelledOrder[] = cancelledRaw.map((row) => ({
    isin: row.isin,
    owner: ownerFor(row.client_id),
    amount: row.amount,
    trade_date: row.trade_date,
    lot_type: row.lot_type,
  }));

  const total_invested = funds.reduce((s, f) => s + f.total_invested, 0);
  const owner_split = {
    praveen: funds.filter((f) => f.owner === "praveen").reduce((s, f) => s + f.total_invested, 0),
    geetha: funds.filter((f) => f.owner === "geetha").reduce((s, f) => s + f.total_invested, 0),
  };

  const allDates = funds
    .flatMap((f) => f.lots.map((l) => l.trade_date))
    .filter(Boolean)
    .sort();

  return {
    funds,
    excluded_etfs,
    sell_transactions,
    pending_orders,
    cancelled_orders,
    total_invested,
    owner_split,
    date_range: { from: allDates[0] ?? "", to: allDates[allDates.length - 1] ?? "" },
    errors,
  };
}
