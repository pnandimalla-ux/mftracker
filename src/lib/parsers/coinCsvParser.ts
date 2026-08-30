import Papa from "papaparse";
import { detectCategory } from "@/lib/analysis/fundCategoriser";
import { searchDirectGrowthScheme } from "@/lib/mfapi";
import { KNOWN_ISIN_MAP } from "@/lib/peers/isinMapping";
import type { Owner } from "@/types/mf";

export type LotType = "sip" | "lumpsum";

export interface CoinLot {
  trade_date: string; // ISO yyyy-mm-dd
  amount: number;
  units: number;
  nav: number;
  settlement_id: string;
  exchange_order_id: string;
  lot_type: LotType;
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
}

export interface ExcludedRow {
  scheme_name: string;
  isin: string;
  reason: string;
}

export interface SellRow {
  scheme_name: string;
  isin: string;
  trade_date: string;
  amount: number;
  units: number;
}

export interface CoinParseResult {
  funds: CoinFund[];
  excluded_etfs: ExcludedRow[];
  sell_transactions: SellRow[];
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

interface BuyRow {
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
}

// Parses a Zerodha Coin "Order History" CSV export. Only COMPLETE orders are
// considered; SELL orders are reported separately (not imported — see
// sell_transactions) since a redemption reduces units rather than adding a
// new lot, which needs different handling than this importer does.
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

  const buyRows: BuyRow[] = [];
  const excluded_etfs: ExcludedRow[] = [];
  const sell_transactions: SellRow[] = [];

  for (const r of parsed.data) {
    const status = (r.status ?? "").trim().toUpperCase();
    if (status !== "COMPLETE") continue;

    const schemeNameRaw = (r.scheme_name ?? "").trim();
    if (!schemeNameRaw) continue;

    const isin = (r.isin ?? "").trim();
    const mode = (r.transaction_mode ?? "").trim().toUpperCase();
    const tradeDate = parseCoinDate(r.trade_date ?? "");
    const amount = parseNum(r.amount);
    const units = parseNum(r.units);

    if (isEtf(schemeNameRaw)) {
      if (mode === "BUY") {
        excluded_etfs.push({ scheme_name: normalizeSchemeName(schemeNameRaw), isin, reason: "ETF" });
      }
      continue;
    }

    if (mode === "SELL") {
      sell_transactions.push({
        scheme_name: normalizeSchemeName(schemeNameRaw),
        isin,
        trade_date: tradeDate,
        amount,
        units,
      });
      continue;
    }

    if (mode !== "BUY") continue;

    if (!isin || amount <= 0 || units <= 0) {
      errors.push(`Skipped row for "${schemeNameRaw}" — missing ISIN, amount, or units`);
      continue;
    }

    buyRows.push({
      client_id: (r.client_id ?? "").trim(),
      isin,
      scheme_name: schemeNameRaw,
      trade_date: tradeDate,
      folio_number: (r.folio_number ?? "").trim(),
      amount,
      units,
      nav: parseNum(r.nav),
      settlement_id: (r.settlement_id ?? "").trim(),
      exchange_order_id: (r.exchange_order_id ?? "").trim(),
      lot_type: (r.tag ?? "").trim().toLowerCase() === "coiniossip" ? "sip" : "lumpsum",
    });
  }

  // Grouped by ISIN + client_id (not ISIN alone) so a fund held by both
  // Praveen and Geetha becomes two separate CoinFund entries, each with its
  // own single owner — matching the CSV-covers-both-accounts import flow.
  const groups = new Map<string, BuyRow[]>();
  for (const row of buyRows) {
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
  const unknownIsinRows = new Map<string, BuyRow>();
  for (const rows of groupList) {
    const isin = rows[0].isin;
    if (!KNOWN_ISIN_MAP[isin] && !unknownIsinRows.has(isin)) {
      unknownIsinRows.set(isin, rows[0]);
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

    const lots: CoinLot[] = groupRows
      .map((r) => ({
        trade_date: r.trade_date,
        amount: r.amount,
        units: r.units,
        nav: r.nav,
        settlement_id: r.settlement_id,
        exchange_order_id: r.exchange_order_id,
        lot_type: r.lot_type,
      }))
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date));

    const total_invested = lots.reduce((s, l) => s + l.amount, 0);
    const total_units = lots.reduce((s, l) => s + l.units, 0);

    funds.push({
      isin,
      scheme_name: cleanedName,
      scheme_code,
      owner,
      category,
      category_confidence,
      amc,
      total_invested,
      total_units,
      avg_nav: total_units > 0 ? total_invested / total_units : 0,
      folio_number: first.folio_number,
      lots,
    });
  }

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
    total_invested,
    owner_split,
    date_range: { from: allDates[0] ?? "", to: allDates[allDates.length - 1] ?? "" },
    errors,
  };
}
