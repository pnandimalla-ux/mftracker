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

interface ConfirmLot {
  trade_date: string;
  amount: number;
  units: number;
  nav: number;
  lot_type?: "sip" | "lumpsum";
  settlement_id?: string;
}

interface ConfirmFund {
  isin: string;
  scheme_code: string | null;
  scheme_name: string;
  owner: "praveen" | "geetha";
  category: string;
  amc: string | null;
  lots: ConfirmLot[];
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

    const { funds, duplicate_action, check_only } = body as {
      funds?: unknown;
      duplicate_action?: unknown;
      check_only?: unknown;
    };

    if (!Array.isArray(funds) || funds.length === 0) {
      return NextResponse.json({ error: "At least one fund is required" }, { status: 400 });
    }

    const validFunds: ConfirmFund[] = [];
    for (const raw of funds as ConfirmFund[]) {
      const schemeName = typeof raw.scheme_name === "string" ? raw.scheme_name.trim() : "";
      const category = typeof raw.category === "string" ? raw.category.trim() : "";
      const owner = raw.owner === "praveen" || raw.owner === "geetha" ? raw.owner : null;
      const lots = Array.isArray(raw.lots)
        ? raw.lots.filter((l) => l && Number(l.amount) > 0 && Number(l.units) > 0)
        : [];

      if (!schemeName || !owner || !CATEGORY_OPTIONS.includes(category) || lots.length === 0) {
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
      });
    }

    if (validFunds.length === 0) {
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
          lot_type: lot.lot_type ?? "lumpsum",
          mf_api_category: mfApiCategory,
          peer_group: peerGroup,
          settlement_id: lot.settlement_id ?? null,
        });
      }

      if (fund.scheme_code) {
        schemeCodeCategories.set(fund.scheme_code, fund.category);
      }
    }

    if (rows.length === 0) {
      const reason =
        lotsSkippedDuplicates > 0
          ? "all lots were already imported"
          : "all funds were skipped as duplicates";
      return NextResponse.json({ error: `No lots to import (${reason})` }, { status: 400 });
    }

    for (const { owner, scheme_code } of replaceKeys) {
      await supabase.from("mf_holdings").delete().eq("user_id", user.id).eq("owner", owner).eq("scheme_code", scheme_code);
    }

    // mf_cas_imports is inserted FIRST (per owner) so each holding row can
    // carry the batch's id — lets a later delete of the import remove every
    // holding it created. Writes to mf_cas_imports go through the service
    // client per the project's RLS convention for sync/import audit tables.
    const serviceClient = createServiceClient();
    const importIdMap = new Map<string, string>();
    const ownersImported = Array.from(new Set(rows.map((r) => r.owner as string)));
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

    const { data: inserted, error } = await supabase.from("mf_holdings").insert(rows).select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

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
      funds_imported: validFunds.length - fundsSkipped,
      funds_skipped: fundsSkipped,
      lots_imported: inserted?.length ?? rows.length,
      lots_skipped_duplicates: lotsSkippedDuplicates,
      import_ids,
    });
  } catch (err) {
    console.error("POST /api/mf/import/coin/confirm failed:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
