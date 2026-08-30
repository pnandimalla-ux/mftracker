import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchSchemeMeta } from "@/lib/mfapi";
import { derivePeerGroup } from "@/lib/peers/peerGroup";
import { getCategoryForCode, getCategoryFunds } from "@/lib/peers/categoryUniverse";
import { fetchSchemeReturns, type PeriodReturns } from "@/lib/peers/peerSync";

interface SchemeRow {
  code: string;
  name: string | null;
  amc: string | null;
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
  rank_6m: number | null;
  rank_1y: number | null;
  rank_3y: number | null;
  rank_5y: number | null;
  peer_count: number | null;
  expense_ratio: number | null;
}

interface PeerDataRow {
  scheme_code: string;
  fund_name: string | null;
  amc: string | null;
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
  peer_rank_6m: number | null;
  peer_rank_1y: number | null;
  peer_rank_3y: number | null;
  peer_rank_5y: number | null;
  peer_count: number | null;
  expense_ratio: number | null;
}

const PERIOD_KEYS = ["r6m", "r1y", "r3y", "r5y"] as const;

function avg(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return Math.round((present.reduce((s, v) => s + v, 0) / present.length) * 100) / 100;
}

function hasAnyReturn(row: { r6m: number | null; r1y: number | null; r3y: number | null; r5y: number | null }) {
  return PERIOD_KEYS.some((k) => row[k] !== null);
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

    // Resolve category: prefer the category the USER assigned on their own
    // holding — that's the one source of truth that can't silently drift.
    // Falling back to the static universe (or worse, mf_peer_data) FIRST is
    // what caused a held Flexi Cap fund to get ranked against Small Cap
    // peers whenever its scheme_code happened to collide with a wrong entry
    // elsewhere in the universe — see categoryUniverse.ts's audit note.
    // The universe is only consulted for a fund the user doesn't hold yet
    // (e.g. browsing before adding it), and mf_peer_data.category is a last
    // resort for a fund that's neither held nor in the curated universe.
    const { data: holding } = await supabase
      .from("mf_holdings")
      .select("category, peer_group")
      .eq("scheme_code", schemeCode)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    let category = (holding?.category as string | undefined) ?? null;
    let peerGroup = (holding?.peer_group as string | undefined) ?? null;

    if (!category) {
      category = getCategoryForCode(schemeCode);
    }

    if (!category || !peerGroup) {
      const { data: peerRow } = await supabase
        .from("mf_peer_data")
        .select("category, peer_group")
        .eq("scheme_code", schemeCode)
        .maybeSingle();
      category = category ?? (peerRow?.category as string | undefined) ?? null;
      peerGroup = peerGroup ?? (peerRow?.peer_group as string | undefined) ?? null;
    }

    if (!category) {
      return NextResponse.json(
        { error: "No category found for this scheme" },
        { status: 404 }
      );
    }

    // Precise peer comparison bucket (e.g. "Sectoral - MNC") when available —
    // falls back to the broad SEBI category for a fund whose peer_group
    // hasn't been synced yet, so the panel still renders something.
    const groupKey = peerGroup ?? category;

    const { data: categoryRows } = await supabase
      .from("mf_peer_data")
      .select("*")
      .eq("peer_group", groupKey);

    const peerDataMap = new Map<string, PeerDataRow>(
      (categoryRows ?? []).map((p) => [p.scheme_code as string, p as PeerDataRow])
    );

    // The target scheme may not have been synced yet (new holding, or its
    // category was just corrected) — compute its returns live in that case,
    // and best-effort cache them so this doesn't hit mfapi.in on every load.
    const selfRow = peerDataMap.get(schemeCode) ?? null;
    let liveReturns: PeriodReturns | null = null;
    if (!selfRow) {
      try {
        const result = await fetchSchemeReturns(schemeCode);
        liveReturns = result.returns;
        try {
          const serviceClient = createServiceClient();
          const meta = await fetchSchemeMeta(schemeCode);
          const resolvedPeerGroup = meta
            ? derivePeerGroup(meta.mf_api_category, schemeCode)
            : groupKey;
          await serviceClient.from("mf_peer_data").upsert(
            {
              scheme_code: schemeCode,
              category,
              mf_api_category: meta?.mf_api_category ?? null,
              peer_group: resolvedPeerGroup,
              r6m: liveReturns.r6m,
              r1y: liveReturns.r1y,
              r3y: liveReturns.r3y,
              r5y: liveReturns.r5y,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "scheme_code" }
          );
        } catch (cacheErr) {
          console.error(`Failed to cache live-computed returns for ${schemeCode}:`, cacheErr);
        }
      } catch (err) {
        console.error(`Failed to live-compute returns for ${schemeCode}:`, err);
      }
    }

    const peerCodes = Array.from(peerDataMap.keys()).filter((code) => code !== schemeCode);
    const allCodes = Array.from(new Set([schemeCode, ...Array.from(peerDataMap.keys())]));

    const { data: navRows } = await supabase
      .from("mf_nav_cache")
      .select("scheme_code, scheme_name")
      .in("scheme_code", allCodes);

    const navNameMap = new Map(
      (navRows ?? []).map((n) => [n.scheme_code as string, n.scheme_name as string | null])
    );

    // Curated-universe funds carry their real name/AMC even if this
    // particular scheme_code hasn't been synced into mf_peer_data yet.
    const universeNameMap = new Map(getCategoryFunds(category).map((f) => [f.code, f.name]));

    const resolveName = (code: string): string | null => {
      const p = peerDataMap.get(code);
      return p?.fund_name || navNameMap.get(code) || universeNameMap.get(code) || null;
    };

    // Last resort: a handful of funds may still have no name anywhere (never
    // synced by tier1/2/3 and not in the curated universe) — fetch their
    // name from mfapi.in directly and best-effort persist it for next time.
    const missingNameCodes = allCodes.filter((code) => !resolveName(code));
    const liveNameMap = new Map<string, string>();
    if (missingNameCodes.length > 0) {
      await Promise.all(
        missingNameCodes.map(async (code) => {
          try {
            const res = await fetch(`https://api.mfapi.in/mf/${code}`, { cache: "no-store" });
            if (!res.ok) return;
            const json = await res.json();
            const name = typeof json?.meta?.scheme_name === "string" ? json.meta.scheme_name : null;
            if (!name) return;
            liveNameMap.set(code, name);
            try {
              const serviceClient = createServiceClient();
              await serviceClient.from("mf_peer_data").update({ fund_name: name }).eq("scheme_code", code);
            } catch (persistErr) {
              console.error(`Failed to persist fund_name for ${code}:`, persistErr);
            }
          } catch (err) {
            console.error(`Failed to fetch fund name for ${code}:`, err);
          }
        })
      );
    }

    const toSchemeRow = (code: string): SchemeRow => {
      const p = peerDataMap.get(code);
      return {
        code,
        name: resolveName(code) ?? liveNameMap.get(code) ?? null,
        amc: p?.amc ?? null,
        r6m: p?.r6m ?? null,
        r1y: p?.r1y ?? null,
        r3y: p?.r3y ?? null,
        r5y: p?.r5y ?? null,
        rank_6m: p?.peer_rank_6m ?? null,
        rank_1y: p?.peer_rank_1y ?? null,
        rank_3y: p?.peer_rank_3y ?? null,
        rank_5y: p?.peer_rank_5y ?? null,
        peer_count: p?.peer_count ?? null,
        expense_ratio: p?.expense_ratio ?? null,
      };
    };

    const peers = peerCodes
      .map(toSchemeRow)
      .sort((a, b) => (b.r1y ?? -Infinity) - (a.r1y ?? -Infinity));

    const category_avg = {
      r6m: avg(peers.map((p) => p.r6m)),
      r1y: avg(peers.map((p) => p.r1y)),
      r3y: avg(peers.map((p) => p.r3y)),
      r5y: avg(peers.map((p) => p.r5y)),
    };

    let scheme: SchemeRow;
    if (selfRow) {
      scheme = toSchemeRow(schemeCode);
    } else if (liveReturns) {
      const returns = liveReturns;
      const rankFor = (key: (typeof PERIOD_KEYS)[number]): number | null => {
        const selfVal = returns[key];
        if (selfVal === null) return null;
        const better = peers.filter((p) => p[key] !== null && (p[key] as number) > selfVal).length;
        return better + 1;
      };
      const peerCount = peers.filter(hasAnyReturn).length + 1;
      scheme = {
        code: schemeCode,
        name: resolveName(schemeCode) ?? liveNameMap.get(schemeCode) ?? null,
        amc: null,
        r6m: returns.r6m,
        r1y: returns.r1y,
        r3y: returns.r3y,
        r5y: returns.r5y,
        rank_6m: rankFor("r6m"),
        rank_1y: rankFor("r1y"),
        rank_3y: rankFor("r3y"),
        rank_5y: rankFor("r5y"),
        peer_count: peerCount,
        expense_ratio: null,
      };
    } else {
      // Couldn't sync stored data or compute it live (mfapi.in unreachable) —
      // still return the category context so peers/category_avg render.
      scheme = toSchemeRow(schemeCode);
    }

    return NextResponse.json({
      data: {
        category,
        peer_group: groupKey,
        scheme,
        peers,
        category_avg,
      },
    });
  } catch (err) {
    console.error(`GET /api/mf/peers/${params.scheme_code} failed:`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
