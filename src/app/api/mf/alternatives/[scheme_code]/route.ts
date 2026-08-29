import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncNewFund } from "@/lib/peers/tier3Sync";
import { calculateOverlap } from "@/lib/analysis/overlapCalculator";
import type { Owner } from "@/types/mf";

interface PeerDataRow {
  scheme_code: string;
  category: string | null;
  amc: string | null;
  fund_name: string | null;
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
  expense_ratio: number | null;
}

interface RankedFund {
  scheme_code: string;
  scheme_name: string;
  amc: string | null;
  category: string | null;
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
  expense_ratio: number | null;
  rank: number;
}

interface ComparisonEntry {
  scheme_code: string;
  scheme_name: string;
  amc: string | null;
  rank: number;
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
  expense_ratio: number | null;
  diff_r6m: number | null;
  diff_r1y: number | null;
  diff_r3y: number | null;
  diff_r5y: number | null;
  overlap_estimate: string;
  zerodha_coin_url: string;
}

type Signal = "hold" | "watch" | "switch";

function avg(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return Math.round((present.reduce((s, v) => s + v, 0) / present.length) * 100) / 100;
}

function diff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.round((a - b) * 100) / 100;
}

function zerodhaCoinUrl(schemeName: string): string {
  const slug = schemeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `https://coin.zerodha.com/mutual-funds/${slug}`;
}

export async function GET(
  _request: Request,
  { params }: { params: { scheme_code: string } }
) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const schemeCode = params.scheme_code;

    const { data: holdingRows, error: holdingError } = await supabase
      .from("mf_holdings")
      .select("scheme_code, scheme_name, category, amc, owner")
      .eq("scheme_code", schemeCode)
      .eq("user_id", user.id);

    if (holdingError) {
      return NextResponse.json({ error: holdingError.message }, { status: 500 });
    }
    if (!holdingRows || holdingRows.length === 0) {
      return NextResponse.json({ error: "You don't hold this fund" }, { status: 404 });
    }

    const primaryHolding = holdingRows[0];
    const category = primaryHolding.category as string;
    const owners = Array.from(new Set(holdingRows.map((h) => h.owner as Owner)));

    const { data: categoryRows } = await supabase
      .from("mf_peer_data")
      .select("scheme_code, category, amc, fund_name, r6m, r1y, r3y, r5y, expense_ratio")
      .eq("category", category);

    let peerRows: PeerDataRow[] = (categoryRows ?? []) as PeerDataRow[];
    let heldRow = peerRows.find((p) => p.scheme_code === schemeCode) ?? null;

    // Not synced yet (e.g. just added, tier3 hasn't finished) — compute and
    // cache it now so the panel isn't empty, then re-read the category set.
    if (!heldRow) {
      try {
        await syncNewFund(schemeCode, category);
        const { data: refreshed } = await supabase
          .from("mf_peer_data")
          .select("scheme_code, category, amc, fund_name, r6m, r1y, r3y, r5y, expense_ratio")
          .eq("category", category);
        peerRows = (refreshed ?? []) as PeerDataRow[];
        heldRow = peerRows.find((p) => p.scheme_code === schemeCode) ?? null;
      } catch (err) {
        console.error(`On-demand tier3 sync failed for ${schemeCode}:`, err);
      }
    }

    if (peerRows.length === 0) {
      return NextResponse.json({
        data: {
          held_fund: {
            scheme_code: schemeCode,
            scheme_name: primaryHolding.scheme_name,
            category,
            amc: primaryHolding.amc,
            r6m: null,
            r1y: null,
            r3y: null,
            r5y: null,
            peer_rank_6m: null,
            peer_rank_1y: null,
            peer_rank_3y: null,
            peer_rank_5y: null,
            peer_count: null,
            expense_ratio: null,
            owners,
          },
          category_avg: { r6m: null, r1y: null, r3y: null, r5y: null },
          funds_above: [],
          top_3: [],
          signal: "watch" as Signal,
          signal_reason: "Sync peer data to see alternatives",
          suggested_switch: null,
          no_peer_data: true,
        },
      });
    }

    // Rank the whole category set fresh by r1y (nulls last) so the numbers
    // shown here are internally consistent even if the held fund was just
    // live-computed above and shifts the ordering vs. stale stored ranks.
    const ranked: RankedFund[] = [...peerRows]
      .sort((a, b) => (b.r1y ?? -Infinity) - (a.r1y ?? -Infinity))
      .map((p, idx) => ({
        scheme_code: p.scheme_code,
        scheme_name: p.fund_name ?? p.scheme_code,
        amc: p.amc,
        category: p.category,
        r6m: p.r6m,
        r1y: p.r1y,
        r3y: p.r3y,
        r5y: p.r5y,
        expense_ratio: p.expense_ratio,
        rank: idx + 1,
      }));

    const heldRanked = ranked.find((r) => r.scheme_code === schemeCode) ?? null;
    const heldRank = heldRanked?.rank ?? null;
    const peerCount = ranked.length;
    const heldName = primaryHolding.scheme_name || heldRanked?.scheme_name || schemeCode;
    const heldAmc = primaryHolding.amc ?? heldRanked?.amc ?? null;

    const buildComparisonEntry = (fund: RankedFund): ComparisonEntry => ({
      scheme_code: fund.scheme_code,
      scheme_name: fund.scheme_name,
      amc: fund.amc,
      rank: fund.rank,
      r6m: fund.r6m,
      r1y: fund.r1y,
      r3y: fund.r3y,
      r5y: fund.r5y,
      expense_ratio: fund.expense_ratio,
      diff_r6m: diff(fund.r6m, heldRanked?.r6m ?? null),
      diff_r1y: diff(fund.r1y, heldRanked?.r1y ?? null),
      diff_r3y: diff(fund.r3y, heldRanked?.r3y ?? null),
      diff_r5y: diff(fund.r5y, heldRanked?.r5y ?? null),
      overlap_estimate: "~15-30%",
      zerodha_coin_url: zerodhaCoinUrl(fund.scheme_name),
    });

    const fundsAboveRanked = heldRank ? ranked.slice(0, heldRank - 1).slice(0, 5) : [];
    const fundsAbove: ComparisonEntry[] = [];
    for (const fund of fundsAboveRanked) {
      const entry = buildComparisonEntry(fund);
      entry.overlap_estimate = await calculateOverlap(fund.scheme_code, schemeCode, {
        categoryA: fund.category,
        amcA: fund.amc,
        categoryB: category,
        amcB: heldAmc,
      });
      fundsAbove.push(entry);
    }

    const top3Ranked = ranked.slice(0, 3);
    const top3: ComparisonEntry[] = [];
    for (const fund of top3Ranked) {
      if (fund.scheme_code === schemeCode) {
        top3.push({ ...buildComparisonEntry(fund), overlap_estimate: "~100%" });
        continue;
      }
      const entry = buildComparisonEntry(fund);
      entry.overlap_estimate = await calculateOverlap(fund.scheme_code, schemeCode, {
        categoryA: fund.category,
        amcA: fund.amc,
        categoryB: category,
        amcB: heldAmc,
      });
      top3.push(entry);
    }

    const { data: statsRow } = await supabase
      .from("mf_category_stats")
      .select("avg_r6m, avg_r1y, avg_r3y, avg_r5y")
      .eq("category", category)
      .maybeSingle();

    const category_avg = statsRow
      ? {
          r6m: statsRow.avg_r6m as number | null,
          r1y: statsRow.avg_r1y as number | null,
          r3y: statsRow.avg_r3y as number | null,
          r5y: statsRow.avg_r5y as number | null,
        }
      : {
          r6m: avg(peerRows.map((p) => p.r6m)),
          r1y: avg(peerRows.map((p) => p.r1y)),
          r3y: avg(peerRows.map((p) => p.r3y)),
          r5y: avg(peerRows.map((p) => p.r5y)),
        };

    // Rule-based hold/watch/switch signal (AI-based version lands later).
    let signal: Signal = "watch";
    let signal_reason = "Not enough peer data yet to generate a signal.";
    let suggested_switch: { scheme_code: string; scheme_name: string } | null = null;

    const heldR1y = heldRanked?.r1y ?? null;
    const diffFromAvg = diff(heldR1y, category_avg.r1y);

    if (heldRank !== null && peerCount > 0) {
      const percentile = heldRank / peerCount;

      if (percentile <= 0.25 && diffFromAvg !== null && diffFromAvg > 0) {
        signal = "hold";
        signal_reason = "Your fund is performing well. No action needed.";
      } else if (
        percentile > 0.5 &&
        diffFromAvg !== null &&
        diffFromAvg < -3
      ) {
        signal = "switch";
        signal_reason =
          "This fund is underperforming peers significantly across multiple periods. Consider switching to a better-ranked alternative.";
        const top = ranked.find((r) => r.scheme_code !== schemeCode) ?? null;
        if (top) {
          suggested_switch = { scheme_code: top.scheme_code, scheme_name: top.scheme_name };
        }
      } else {
        signal = "watch";
        signal_reason = "This fund is slightly behind peers. Monitor for another quarter.";
      }
    }

    return NextResponse.json({
      data: {
        held_fund: {
          scheme_code: schemeCode,
          scheme_name: heldName,
          category,
          amc: heldAmc,
          r6m: heldRanked?.r6m ?? null,
          r1y: heldRanked?.r1y ?? null,
          r3y: heldRanked?.r3y ?? null,
          r5y: heldRanked?.r5y ?? null,
          peer_rank_6m: heldRanked
            ? [...peerRows].sort((a, b) => (b.r6m ?? -Infinity) - (a.r6m ?? -Infinity)).findIndex((p) => p.scheme_code === schemeCode) + 1
            : null,
          peer_rank_1y: heldRank,
          peer_rank_3y: heldRanked
            ? [...peerRows].sort((a, b) => (b.r3y ?? -Infinity) - (a.r3y ?? -Infinity)).findIndex((p) => p.scheme_code === schemeCode) + 1
            : null,
          peer_rank_5y: heldRanked
            ? [...peerRows].sort((a, b) => (b.r5y ?? -Infinity) - (a.r5y ?? -Infinity)).findIndex((p) => p.scheme_code === schemeCode) + 1
            : null,
          peer_count: peerCount,
          expense_ratio: heldRanked?.expense_ratio ?? null,
          owners,
        },
        category_avg,
        funds_above: fundsAbove,
        top_3: top3,
        signal,
        signal_reason,
        suggested_switch,
        no_peer_data: false,
      },
    });
  } catch (err) {
    console.error(`GET /api/mf/alternatives/${params.scheme_code} failed:`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
