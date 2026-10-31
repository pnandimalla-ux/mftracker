import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchSchemeMeta, refreshNavCache } from "@/lib/mfapi";
import { syncNewFund } from "@/lib/peers/tier3Sync";
import { isRealSchemeCode } from "@/lib/peers/peerSync";
import { derivePeerGroup } from "@/lib/peers/peerGroup";
import { CATEGORY_OPTIONS } from "@/lib/categoryOptions";

export const maxDuration = 60;

type DuplicateAction = "skip" | "add_lots" | "replace";
type Owner = "praveen" | "geetha";

interface ConfirmLot {
  trade_date: string;
  amount: number;
  units: number;
  nav: number;
  lot_type?: "sip" | "lumpsum" | "sell";
  settlement_id?: string;
}

interface ConfirmFund {
  isin: string;
  scheme_code: string | null;
  scheme_name: string;
  owner: Owner;
  category: string;
  amc: string | null;
  lots: ConfirmLot[];
  fully_exited: boolean;
  sell_txn_count: number;
  sell_units_excess: number;
}

interface RawConfirmSell {
  isin?: unknown;
  scheme_code?: unknown;
  scheme_name?: unknown;
  owner?: unknown;
  trade_date?: unknown;
  amount?: unknown;
  units?: unknown;
  settlement_id?: unknown;
  matched_in_csv?: unknown;
}

interface PendingOrderInput {
  isin: string;
  scheme_code: string | null;
  scheme_name: string;
  owner: Owner;
  category: string | null;
  lot_type: "sip" | "lumpsum";
  amount: number;
  trade_date: string;
  ordered_at: string | null;
  remarks: string | null;
}

interface CancelledOrderInput {
  isin: string;
  owner: Owner;
  amount: number;
  trade_date: string;
  lot_type: "sip" | "lumpsum";
}

// Something that proves an order is no longer pending: a COMPLETE lot (in
// this CSV or already in mf_holdings) or a FAILED / CANCELLED order.
interface SettleEvidence {
  owner: Owner;
  scheme_code: string | null;
  isin: string | null;
  amount: number;
  trade_date: string;
  lot_type: string | null;
}

interface PendingRowLike {
  owner: string;
  scheme_code: string | null;
  isin: string | null;
  amount: number;
  trade_date: string;
  lot_type: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PENDING_MATCH_DAYS = 3;
const PENDING_CONFLICT_KEY = "user_id,owner,isin,trade_date,amount,lot_type";

function isoToUtcMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function shiftIsoDays(iso: string, days: number): string {
  return new Date(isoToUtcMs(iso) + days * 86400000).toISOString().slice(0, 10);
}

// Same owner + fund (scheme_code when both sides have a real one, else ISIN)
// + amount + lot type, with the trade date within ±3 days.
function evidenceMatchesPending(e: SettleEvidence, p: PendingRowLike): boolean {
  if (e.owner !== p.owner) return false;
  const eCode = e.scheme_code && isRealSchemeCode(e.scheme_code) ? e.scheme_code : null;
  const pCode = p.scheme_code && isRealSchemeCode(p.scheme_code) ? p.scheme_code : null;
  if (eCode && pCode) {
    if (eCode !== pCode) return false;
  } else if (!(e.isin && p.isin && e.isin === p.isin)) {
    return false;
  }
  if (Math.abs(e.amount - p.amount) > 0.01) return false;
  if (e.lot_type && p.lot_type && e.lot_type !== p.lot_type) return false;
  if (!ISO_DATE_RE.test(e.trade_date) || !ISO_DATE_RE.test(p.trade_date)) return false;
  return Math.abs(isoToUtcMs(e.trade_date) - isoToUtcMs(p.trade_date)) / 86400000 <= PENDING_MATCH_DAYS;
}

function pendingKey(p: { owner: string; isin: string | null; trade_date: string; amount: number; lot_type: string }) {
  return `${p.owner}|${p.isin ?? ""}|${p.trade_date}|${p.amount.toFixed(2)}|${p.lot_type}`;
}

function parsePendingOrders(raw: unknown): PendingOrderInput[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingOrderInput[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const owner = r.owner === "praveen" || r.owner === "geetha" ? r.owner : null;
    const isin = typeof r.isin === "string" ? r.isin.trim() : "";
    const schemeName = typeof r.scheme_name === "string" ? r.scheme_name.trim() : "";
    const amount = Number(r.amount);
    const tradeDate = typeof r.trade_date === "string" ? r.trade_date.trim() : "";
    const lotType = r.lot_type === "sip" || r.lot_type === "lumpsum" ? r.lot_type : null;
    if (!owner || !isin || !schemeName || !lotType) continue;
    if (!Number.isFinite(amount) || amount <= 0 || !ISO_DATE_RE.test(tradeDate)) continue;
    out.push({
      isin,
      scheme_code: typeof r.scheme_code === "string" && r.scheme_code.trim() ? r.scheme_code.trim() : null,
      scheme_name: schemeName,
      owner,
      category: typeof r.category === "string" && r.category.trim() ? r.category.trim() : null,
      lot_type: lotType,
      amount,
      trade_date: tradeDate,
      ordered_at: typeof r.ordered_at === "string" && r.ordered_at.trim() ? r.ordered_at.trim() : null,
      remarks: typeof r.remarks === "string" && r.remarks.trim() ? r.remarks.trim() : null,
    });
  }
  return out;
}

function parseCancelledOrders(raw: unknown): CancelledOrderInput[] {
  if (!Array.isArray(raw)) return [];
  const out: CancelledOrderInput[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const owner = r.owner === "praveen" || r.owner === "geetha" ? r.owner : null;
    const isin = typeof r.isin === "string" ? r.isin.trim() : "";
    const amount = Number(r.amount);
    const tradeDate = typeof r.trade_date === "string" ? r.trade_date.trim() : "";
    const lotType = r.lot_type === "sip" || r.lot_type === "lumpsum" ? r.lot_type : "lumpsum";
    if (!owner || !isin || !Number.isFinite(amount) || amount <= 0 || !ISO_DATE_RE.test(tradeDate)) continue;
    out.push({ isin, owner, amount, trade_date: tradeDate, lot_type: lotType });
  }
  return out;
}

interface PendingPlan {
  enabled: boolean;
  clearIds: string[];
  newPending: PendingOrderInput[];
  remainingExistingAmount: number;
}

// Works out (read-only) which existing pending orders have settled or been
// cancelled, and which incoming PROCESSING orders are genuinely new. Writes
// happen later, once the import is known to proceed. If mf_pending_orders
// doesn't exist yet (migration_010 not run) the whole feature is skipped so
// regular imports keep working.
async function planPendingOrders(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
  funds: ConfirmFund[],
  incoming: PendingOrderInput[],
  cancelled: CancelledOrderInput[]
): Promise<PendingPlan> {
  const disabled: PendingPlan = { enabled: false, clearIds: [], newPending: [], remainingExistingAmount: 0 };

  const { data: existingRaw, error: existingError } = await serviceClient
    .from("mf_pending_orders")
    .select("id, owner, isin, scheme_code, amount, trade_date, lot_type")
    .eq("user_id", userId);
  if (existingError) {
    console.error("mf_pending_orders unavailable — skipping pending orders (run migration_010?):", existingError.message);
    return disabled;
  }
  const existing = (existingRaw ?? []).map((r) => ({
    id: r.id as string,
    owner: r.owner as string,
    isin: (r.isin as string | null) ?? null,
    scheme_code: (r.scheme_code as string | null) ?? null,
    amount: Number(r.amount),
    trade_date: String(r.trade_date).slice(0, 10),
    lot_type: r.lot_type as string,
  }));

  if (existing.length === 0 && incoming.length === 0) {
    return { enabled: true, clearIds: [], newPending: [], remainingExistingAmount: 0 };
  }

  // (a) Every COMPLETE BUY lot in this request — inserted or skipped as an
  // already-imported duplicate — plus every FAILED / CANCELLED order.
  const csvEvidence: SettleEvidence[] = [];
  for (const f of funds) {
    for (const lot of f.lots) {
      csvEvidence.push({
        owner: f.owner,
        scheme_code: f.scheme_code,
        isin: f.isin || null,
        amount: Number(lot.amount),
        trade_date: lot.trade_date,
        lot_type: lot.lot_type ?? null,
      });
    }
  }
  for (const c of cancelled) {
    csvEvidence.push({ owner: c.owner, scheme_code: null, isin: c.isin, amount: c.amount, trade_date: c.trade_date, lot_type: c.lot_type });
  }

  // (c) COMPLETE lots already in mf_holdings — an order that settled in an
  // earlier import must not linger as pending.
  const holdingsEvidence: SettleEvidence[] = [];
  const allDates = [...existing.map((p) => p.trade_date), ...incoming.map((p) => p.trade_date)].sort();
  if (allDates.length > 0) {
    const { data: lots, error: lotsError } = await serviceClient
      .from("mf_holdings")
      .select("owner, scheme_code, invested_amount, as_on_date, lot_type")
      .eq("user_id", userId)
      .gte("as_on_date", shiftIsoDays(allDates[0], -PENDING_MATCH_DAYS));
    if (lotsError) {
      console.error("Failed to load holdings for pending reconciliation:", lotsError.message);
    }
    for (const l of lots ?? []) {
      holdingsEvidence.push({
        owner: l.owner as Owner,
        scheme_code: (l.scheme_code as string | null) ?? null,
        isin: null,
        amount: Number(l.invested_amount),
        trade_date: String(l.as_on_date).slice(0, 10),
        lot_type: (l.lot_type as string | null) ?? null,
      });
    }
  }

  const allEvidence = [...csvEvidence, ...holdingsEvidence];
  const settled = (p: PendingRowLike) => allEvidence.some((e) => evidenceMatchesPending(e, p));

  const clearIds = existing.filter(settled).map((p) => p.id);
  const clearSet = new Set(clearIds);
  const remaining = existing.filter((p) => !clearSet.has(p.id));
  const remainingKeys = new Set(remaining.map(pendingKey));

  // (b) Incoming PROCESSING orders, minus any already settled / cancelled
  // and any already stored (same unique key).
  const seen = new Set<string>();
  const newPending = incoming.filter((p) => {
    if (settled(p)) return false;
    const key = pendingKey(p);
    if (remainingKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    enabled: true,
    clearIds,
    newPending,
    remainingExistingAmount: remaining.reduce((sum, p) => sum + p.amount, 0),
  };
}

interface SellGroup {
  owner: Owner;
  scheme_code: string;
  scheme_name: string;
  total_units: number;
}

// Same fund + same owner already present in mf_holdings, keyed by scheme_code
// when known (a manual-* placeholder code can never collide with a real one).
async function findDuplicates(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  funds: ConfirmFund[]
) {
  const schemeCodes = Array.from(
    new Set(funds.map((f) => f.scheme_code).filter((c): c is string => !!c))
  );
  if (schemeCodes.length === 0) return new Map<string, number>();

  const { data } = await supabase
    .from("mf_holdings")
    .select("owner, scheme_code")
    .eq("user_id", userId)
    .in("scheme_code", schemeCodes);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const key = `${row.owner}:${row.scheme_code}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// Applies SELL rows that had no corresponding BUY row in this CSV against
// existing mf_holdings — oldest lot first (FIFO). Uses the service client
// since this bypasses the normal per-owner RLS write path (same convention
// as the mf_cas_imports writes below).
async function applySellsToExistingHoldings(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
  sellGroups: SellGroup[]
) {
  let lots_reduced = 0;
  let funds_exited = 0;

  for (const group of sellGroups) {
    const { data: existingLots, error: lotsError } = await serviceClient
      .from("mf_holdings")
      .select("id, units, invested_amount, as_on_date")
      .eq("user_id", userId)
      .eq("owner", group.owner)
      .eq("scheme_code", group.scheme_code)
      .order("as_on_date", { ascending: true });

    if (lotsError) {
      console.error(
        `Failed to fetch existing lots for sell application (${group.owner}/${group.scheme_code}):`,
        lotsError.message
      );
      continue;
    }
    if (!existingLots || existingLots.length === 0) {
      console.warn(
        `No existing holdings found for ${group.owner}/${group.scheme_code} (${group.scheme_name}) — cannot apply sell of ${group.total_units} units`
      );
      continue;
    }

    let remaining = group.total_units;
    let deletedCount = 0;

    for (const lot of existingLots) {
      if (remaining <= 1e-6) break;
      const lotUnits = Number(lot.units);

      if (lotUnits <= remaining + 1e-9) {
        const { error: delError } = await serviceClient.from("mf_holdings").delete().eq("id", lot.id);
        if (!delError) {
          deletedCount++;
          remaining -= lotUnits;
        } else {
          console.error(`Failed to delete lot ${lot.id} during sell application:`, delError.message);
        }
      } else {
        const invested = Number(lot.invested_amount);
        const newUnits = lotUnits - remaining;
        const newInvested = (newUnits / lotUnits) * invested;
        const { error: updError } = await serviceClient
          .from("mf_holdings")
          .update({ units: newUnits, invested_amount: newInvested })
          .eq("id", lot.id);
        if (!updError) {
          lots_reduced++;
          remaining = 0;
        } else {
          console.error(`Failed to reduce lot ${lot.id} during sell application:`, updError.message);
        }
      }
    }

    if (remaining > 1e-6) {
      console.warn(
        `Sell of ${group.total_units} units for ${group.scheme_name} (${group.owner}) exceeds existing holdings (over-sell) — all ${existingLots.length} lot(s) removed`
      );
    }
    if (deletedCount === existingLots.length) {
      funds_exited++;
    }
  }

  return { lots_reduced, funds_exited };
}

export async function POST(request: Request) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { funds, duplicate_action, check_only, sells, pending_orders, cancelled_orders } = body as {
      funds?: unknown;
      duplicate_action?: unknown;
      check_only?: unknown;
      sells?: unknown;
      pending_orders?: unknown;
      cancelled_orders?: unknown;
    };

    const validPending = parsePendingOrders(pending_orders);
    const validCancelled = parseCancelledOrders(cancelled_orders);
    const hasPendingInput = validPending.length > 0 || validCancelled.length > 0;

    if (!Array.isArray(funds) || (funds.length === 0 && (check_only || !hasPendingInput))) {
      return NextResponse.json({ error: "At least one fund is required" }, { status: 400 });
    }

    const validFunds: ConfirmFund[] = [];
    for (const raw of funds as (ConfirmFund & {
      fully_exited?: unknown;
      sell_txn_count?: unknown;
      sell_units_excess?: unknown;
    })[]) {
      const schemeName = typeof raw.scheme_name === "string" ? raw.scheme_name.trim() : "";
      const category = typeof raw.category === "string" ? raw.category.trim() : "";
      const owner = raw.owner === "praveen" || raw.owner === "geetha" ? raw.owner : null;
      const fullyExited = raw.fully_exited === true;
      const lots = Array.isArray(raw.lots)
        ? raw.lots.filter((l) => l && Number(l.amount) > 0 && Number(l.units) > 0)
        : [];

      if (!schemeName || !owner || !CATEGORY_OPTIONS.includes(category)) {
        continue;
      }
      // A fully-exited fund legitimately has zero lots (nothing to import) —
      // any other fund with zero valid lots is just malformed input.
      if (!fullyExited && lots.length === 0) {
        continue;
      }

      validFunds.push({
        isin: typeof raw.isin === "string" ? raw.isin : "",
        scheme_code: typeof raw.scheme_code === "string" && raw.scheme_code.trim() ? raw.scheme_code.trim() : null,
        scheme_name: schemeName,
        owner,
        category,
        amc: typeof raw.amc === "string" && raw.amc.trim() ? raw.amc.trim() : null,
        lots,
        fully_exited: fullyExited,
        sell_txn_count: typeof raw.sell_txn_count === "number" ? raw.sell_txn_count : 0,
        sell_units_excess: typeof raw.sell_units_excess === "number" ? raw.sell_units_excess : 0,
      });
    }

    if (validFunds.length === 0 && (check_only || !hasPendingInput)) {
      return NextResponse.json({ error: "No valid funds to import" }, { status: 400 });
    }

    const duplicateCounts = await findDuplicates(supabase, user.id, validFunds);

    if (check_only) {
      const duplicates = validFunds
        .filter((f) => f.scheme_code && duplicateCounts.has(`${f.owner}:${f.scheme_code}`))
        .map((f) => ({
          scheme_name: f.scheme_name,
          owner: f.owner,
          scheme_code: f.scheme_code,
          existing_lot_count: duplicateCounts.get(`${f.owner}:${f.scheme_code}`) ?? 0,
        }));
      return NextResponse.json({ duplicates });
    }

    const action: DuplicateAction =
      duplicate_action === "add_lots" || duplicate_action === "replace" ? duplicate_action : "skip";

    // For "add_lots" duplicate funds, fetch their existing lots so we can
    // filter out any incoming lot that's already in mf_holdings — otherwise
    // a CSV date range that overlaps a prior import double-inserts those
    // lots, inflating units and invested amounts.
    const addLotsSchemeCodes = Array.from(
      new Set(
        validFunds
          .filter((f) => {
            const dupKey = f.scheme_code ? `${f.owner}:${f.scheme_code}` : null;
            return action === "add_lots" && !!dupKey && duplicateCounts.has(dupKey);
          })
          .map((f) => f.scheme_code)
          .filter((c): c is string => !!c)
      )
    );

    const existingSettlementIds = new Set<string>();
    const existingFallbackKeys = new Set<string>();
    if (addLotsSchemeCodes.length > 0) {
      const { data: existingLots } = await supabase
        .from("mf_holdings")
        .select("settlement_id, as_on_date, invested_amount, units, owner, scheme_code")
        .eq("user_id", user.id)
        .in("scheme_code", addLotsSchemeCodes);

      for (const row of existingLots ?? []) {
        const keyPrefix = `${row.owner}:${row.scheme_code}`;
        const settlementId = typeof row.settlement_id === "string" ? row.settlement_id.trim() : "";
        if (settlementId) {
          existingSettlementIds.add(`${keyPrefix}:${settlementId}`);
        } else {
          existingFallbackKeys.add(`${keyPrefix}:${row.as_on_date}|${row.invested_amount}|${row.units}`);
        }
      }
    }

    const rows: Record<string, unknown>[] = [];
    const schemeCodeCategories = new Map<string, string>();
    const replaceKeys: { owner: string; scheme_code: string }[] = [];
    let fundsSkipped = 0;
    let lotsSkippedDuplicates = 0;
    let fundsExitedViaCsv = 0;
    let sellsNettedInCsv = 0;
    const excessSellsFromCsv: SellGroup[] = [];

    for (const fund of validFunds) {
      const dupKey = fund.scheme_code ? `${fund.owner}:${fund.scheme_code}` : null;
      const isDuplicate = !!dupKey && duplicateCounts.has(dupKey);

      if (isDuplicate && action === "skip") {
        fundsSkipped++;
        continue;
      }
      if (isDuplicate && action === "replace" && fund.scheme_code) {
        replaceKeys.push({ owner: fund.owner, scheme_code: fund.scheme_code });
      }

      if (fund.sell_txn_count > 0) {
        sellsNettedInCsv += fund.sell_txn_count;
      }

      // Net position <= 0 after same-CSV buys/sells — nothing to import.
      // This CSV alone can't tell whether this fund had units before it —
      // when it's a duplicate being appended to ("add_lots"), the amount by
      // which this CSV's sells exceeded this CSV's own buys must have come
      // out of those pre-existing holdings, so queue it for the same FIFO
      // reduction as an orphan sell. "replace" duplicates already have their
      // existing lots queued for full deletion above, so there's nothing
      // left to reduce there; "skip" duplicates were already skipped.
      if (fund.fully_exited) {
        fundsExitedViaCsv++;
        if (isDuplicate && action === "add_lots" && fund.scheme_code && fund.sell_units_excess > 0) {
          excessSellsFromCsv.push({
            owner: fund.owner,
            scheme_code: fund.scheme_code,
            scheme_name: fund.scheme_name,
            total_units: fund.sell_units_excess,
          });
        }
        continue;
      }

      const finalSchemeCode =
        fund.scheme_code ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Precise peer comparison bucket, derived from mfapi.in's own category
      // string + the fund name (e.g. splits "Sectoral/Thematic" into
      // "Sectoral - MNC" vs "Sectoral - Technology") — best-effort only, a
      // manual/unmatched fund or an mfapi.in miss just leaves this null.
      let mfApiCategory: string | null = null;
      let peerGroup: string | null = null;
      if (fund.scheme_code && isRealSchemeCode(fund.scheme_code)) {
        const meta = await fetchSchemeMeta(fund.scheme_code);
        if (meta) {
          mfApiCategory = meta.mf_api_category;
          peerGroup = derivePeerGroup(meta.mf_api_category, fund.scheme_name);
        }
      }

      for (const lot of fund.lots) {
        if (isDuplicate && action === "add_lots" && fund.scheme_code) {
          const keyPrefix = `${fund.owner}:${fund.scheme_code}`;
          const settlementId = (lot.settlement_id ?? "").trim();
          if (settlementId) {
            if (existingSettlementIds.has(`${keyPrefix}:${settlementId}`)) {
              lotsSkippedDuplicates++;
              continue;
            }
          } else if (existingFallbackKeys.has(`${keyPrefix}:${lot.trade_date}|${lot.amount}|${lot.units}`)) {
            lotsSkippedDuplicates++;
            continue;
          }
        }

        rows.push({
          user_id: user.id,
          owner: fund.owner,
          scheme_code: finalSchemeCode,
          scheme_name: fund.scheme_name,
          category: fund.category,
          amc: fund.amc,
          units: lot.units,
          avg_nav: lot.nav,
          invested_amount: lot.amount,
          as_on_date: lot.trade_date,
          lot_type: lot.lot_type === "sell" ? "lumpsum" : (lot.lot_type ?? "lumpsum"),
          mf_api_category: mfApiCategory,
          peer_group: peerGroup,
          settlement_id: lot.settlement_id ?? null,
        });
      }

      if (fund.scheme_code) {
        schemeCodeCategories.set(fund.scheme_code, fund.category);
      }
    }

    // SELL rows whose fund had no BUY rows in this CSV — apply against
    // existing mf_holdings (FIFO, oldest lot first) rather than importing.
    const validSells: { owner: Owner; scheme_code: string; scheme_name: string; units: number }[] = [];
    // Every parseable SELL row, netted or not — recorded for calendar/history
    // display only (mf_sell_transactions is never read by any balance math).
    const sellsToRecord: {
      owner: Owner;
      scheme_code: string | null;
      scheme_name: string;
      trade_date: string;
      amount: number;
      units: number;
      settlement_id: string | null;
    }[] = [];
    if (Array.isArray(sells)) {
      for (const raw of sells as RawConfirmSell[]) {
        if (!raw) continue;
        const owner = raw.owner === "praveen" || raw.owner === "geetha" ? raw.owner : null;
        const schemeCode =
          typeof raw.scheme_code === "string" && raw.scheme_code.trim() ? raw.scheme_code.trim() : null;
        const schemeName = typeof raw.scheme_name === "string" ? raw.scheme_name : "";
        const tradeDate = typeof raw.trade_date === "string" ? raw.trade_date : "";
        const amount = Number(raw.amount);
        const units = Number(raw.units);
        const settlementId =
          typeof raw.settlement_id === "string" && raw.settlement_id.trim() ? raw.settlement_id.trim() : null;

        if (!owner || !Number.isFinite(units) || units <= 0) continue;

        if (tradeDate && Number.isFinite(amount)) {
          sellsToRecord.push({ owner, scheme_code: schemeCode, scheme_name: schemeName, trade_date: tradeDate, amount, units, settlement_id: settlementId });
        }

        if (raw.matched_in_csv === true) continue;
        if (!schemeCode) {
          console.warn(
            `Skipping sell of ${units} units for "${schemeName || "unknown fund"}" — no scheme_code to match against existing holdings`
          );
          continue;
        }
        validSells.push({ owner, scheme_code: schemeCode, scheme_name: schemeName, units });
      }
    }

    const sellGroupMap = new Map<string, SellGroup>();
    const addToSellGroup = (owner: Owner, scheme_code: string, scheme_name: string, units: number) => {
      const key = `${owner}:${scheme_code}`;
      const existing = sellGroupMap.get(key);
      if (existing) {
        existing.total_units += units;
      } else {
        sellGroupMap.set(key, { owner, scheme_code, scheme_name, total_units: units });
      }
    };
    for (const s of validSells) {
      addToSellGroup(s.owner, s.scheme_code, s.scheme_name, s.units);
    }
    for (const s of excessSellsFromCsv) {
      addToSellGroup(s.owner, s.scheme_code, s.scheme_name, s.total_units);
    }

    const serviceClient = createServiceClient();
    const pendingPlan = await planPendingOrders(serviceClient, user.id, validFunds, validPending, validCancelled);
    const hasPendingWork = pendingPlan.newPending.length > 0 || pendingPlan.clearIds.length > 0;

    // A fund that's fully bought-and-sold within this CSV, with no prior
    // holdings to reduce, produces neither a row to insert nor a sellGroupMap
    // entry — but its SELL rows still need to reach mf_sell_transactions for
    // calendar display, so that alone must not trip this guard. Neither do
    // pending orders to save or clear.
    if (rows.length === 0 && sellGroupMap.size === 0 && sellsToRecord.length === 0 && !hasPendingWork) {
      const reason =
        lotsSkippedDuplicates > 0
          ? "all lots were already imported"
          : "all funds were skipped as duplicates or fully exited";
      return NextResponse.json({ error: `No lots to import (${reason})` }, { status: 400 });
    }

    for (const { owner, scheme_code } of replaceKeys) {
      await supabase.from("mf_holdings").delete().eq("user_id", user.id).eq("owner", owner).eq("scheme_code", scheme_code);
    }

    // mf_cas_imports is inserted FIRST (per owner) so each holding row can
    // carry the batch's id — lets a later delete of the import remove every
    // holding it created. Writes to mf_cas_imports go through the service
    // client per the project's RLS convention for sync/import audit tables.
    const importIdMap = new Map<string, string>();
    const ownersImported = Array.from(
      new Set([...rows.map((r) => r.owner as string), ...pendingPlan.newPending.map((p) => p.owner)])
    );
    for (const owner of ownersImported) {
      const ownerLots = rows.filter((r) => r.owner === owner).length;
      const { data: importRow, error: importError } = await serviceClient
        .from("mf_cas_imports")
        .insert({
          user_id: user.id,
          owner,
          filename: "Zerodha Coin order history",
          status: "success",
          rows_imported: ownerLots,
        })
        .select()
        .single();
      if (importError) {
        console.error(`Failed to create mf_cas_imports row for owner ${owner}:`, importError.message);
        continue;
      }
      importIdMap.set(owner, importRow.id as string);
    }

    for (const row of rows) {
      row.import_id = importIdMap.get(row.owner as string) ?? null;
    }

    let inserted: { id: string }[] | null = [];
    if (rows.length > 0) {
      const { data, error } = await supabase.from("mf_holdings").insert(rows).select();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      inserted = data;

      // Ledger copy of every BUY lot just inserted, for the Reports page.
      // Uses the service client — like mf_cas_imports, this is a
      // write-only-by-import audit table, not a user-editable one.
      const buyTransactionRows = rows.map((r) => ({
        user_id: r.user_id,
        import_id: r.import_id,
        owner: r.owner,
        scheme_code: r.scheme_code,
        scheme_name: r.scheme_name,
        category: r.category,
        transaction_type: "BUY",
        lot_type: r.lot_type,
        amount: r.invested_amount,
        units: r.units,
        nav: r.avg_nav,
        trade_date: r.as_on_date,
        settlement_id: r.settlement_id,
      }));
      const { error: buyTxnError } = await serviceClient.from("mf_transactions").insert(buyTransactionRows);
      if (buyTxnError) {
        console.error("Failed to record BUY transactions in ledger:", buyTxnError.message);
      }
    }

    // Apply orphan sells (no matching BUY in this CSV) against existing
    // holdings — independent of the buy-side insert above.
    const { lots_reduced, funds_exited: fundsExitedViaDb } = await applySellsToExistingHoldings(
      serviceClient,
      user.id,
      Array.from(sellGroupMap.values())
    );

    // Persist every parsed SELL row (netted-in-CSV or applied-to-DB) purely
    // for calendar/history display — dedup by settlement_id per
    // owner+scheme_code so re-importing the same CSV doesn't duplicate rows,
    // mirroring the mf_holdings dedup above. Nothing else reads this table.
    if (sellsToRecord.length > 0) {
      const existingSellSettlementIds = new Set<string>();
      const { data: existingSells } = await serviceClient
        .from("mf_sell_transactions")
        .select("owner, scheme_code, settlement_id")
        .eq("user_id", user.id)
        .not("settlement_id", "is", null);
      for (const row of existingSells ?? []) {
        existingSellSettlementIds.add(`${row.owner}:${row.scheme_code ?? ""}:${row.settlement_id}`);
      }

      const sellRows = sellsToRecord
        .filter((s) => {
          if (!s.settlement_id) return true;
          return !existingSellSettlementIds.has(`${s.owner}:${s.scheme_code ?? ""}:${s.settlement_id}`);
        })
        .map((s) => ({
          user_id: user.id,
          owner: s.owner,
          scheme_code: s.scheme_code,
          scheme_name: s.scheme_name,
          units: s.units,
          amount: s.amount,
          trade_date: s.trade_date,
          settlement_id: s.settlement_id,
          import_id: importIdMap.get(s.owner) ?? null,
        }));

      if (sellRows.length > 0) {
        const { error: sellInsertError } = await serviceClient.from("mf_sell_transactions").insert(sellRows);
        if (sellInsertError) {
          console.error("Failed to record sell transactions for calendar display:", sellInsertError.message);
        }

        // Same deduped set, mirrored into the ledger for the Reports page.
        const sellTransactionRows = sellRows.map((s) => ({
          user_id: s.user_id,
          import_id: s.import_id,
          owner: s.owner,
          scheme_code: s.scheme_code,
          scheme_name: s.scheme_name,
          category: null,
          transaction_type: "SELL",
          lot_type: null,
          amount: s.amount,
          units: s.units,
          nav: s.units > 0 ? s.amount / s.units : null,
          trade_date: s.trade_date,
          settlement_id: s.settlement_id,
        }));
        const { error: sellTxnError } = await serviceClient.from("mf_transactions").insert(sellTransactionRows);
        if (sellTxnError) {
          console.error("Failed to record SELL transactions in ledger:", sellTxnError.message);
        }
      }
    }

    // Pending (PROCESSING) orders: clear the ones that settled or were
    // cancelled, then store the new ones under the owner's import_id so
    // deleting that import removes them too.
    let pendingCleared = 0;
    let pendingSaved = 0;
    let pendingSavedAmount = 0;
    if (pendingPlan.enabled && pendingPlan.clearIds.length > 0) {
      const { error: clearError } = await serviceClient
        .from("mf_pending_orders")
        .delete()
        .eq("user_id", user.id)
        .in("id", pendingPlan.clearIds);
      if (clearError) {
        console.error("Failed to clear settled pending orders:", clearError.message);
      } else {
        pendingCleared = pendingPlan.clearIds.length;
      }
    }
    if (pendingPlan.enabled && pendingPlan.newPending.length > 0) {
      const { data: savedRows, error: pendingError } = await serviceClient
        .from("mf_pending_orders")
        .upsert(
          pendingPlan.newPending.map((p) => ({
            user_id: user.id,
            import_id: importIdMap.get(p.owner) ?? null,
            owner: p.owner,
            isin: p.isin,
            scheme_code: p.scheme_code,
            scheme_name: p.scheme_name,
            category: p.category,
            lot_type: p.lot_type,
            amount: p.amount,
            trade_date: p.trade_date,
            ordered_at: p.ordered_at,
            remarks: p.remarks,
          })),
          { onConflict: PENDING_CONFLICT_KEY, ignoreDuplicates: true }
        )
        .select("amount");
      if (pendingError) {
        console.error("Failed to save pending orders:", pendingError.message);
      } else {
        pendingSaved = savedRows?.length ?? 0;
        pendingSavedAmount = (savedRows ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
      }
    }
    const pendingTotalAmount = pendingPlan.remainingExistingAmount + pendingSavedAmount;

    // Best-effort background follow-up — never block the response on mfapi.in.
    for (const schemeCode of Array.from(schemeCodeCategories.keys())) {
      refreshNavCache(schemeCode).catch((err) => console.error(`refreshNavCache(${schemeCode}) failed:`, err));
    }
    for (const [schemeCode, category] of Array.from(schemeCodeCategories.entries())) {
      if (isRealSchemeCode(schemeCode)) {
        syncNewFund(schemeCode, category).catch((err) =>
          console.error(`Tier3 syncNewFund failed for ${schemeCode}:`, err)
        );
      }
    }

    const import_ids: { praveen?: string; geetha?: string } = {};
    for (const [owner, id] of Array.from(importIdMap.entries())) {
      if (owner === "praveen" || owner === "geetha") import_ids[owner] = id;
    }

    return NextResponse.json({
      funds_imported: validFunds.length - fundsSkipped - fundsExitedViaCsv,
      funds_skipped: fundsSkipped,
      lots_imported: inserted?.length ?? rows.length,
      lots_skipped_duplicates: lotsSkippedDuplicates,
      import_ids,
      sells_applied: sellsNettedInCsv + validSells.length,
      funds_exited: fundsExitedViaCsv + fundsExitedViaDb,
      lots_reduced,
      pending_saved: pendingSaved,
      pending_cleared: pendingCleared,
      pending_total_amount: pendingTotalAmount,
    });
  } catch (err) {
    console.error("POST /api/mf/import/coin/confirm failed:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
