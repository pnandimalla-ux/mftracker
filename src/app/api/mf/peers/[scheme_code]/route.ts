import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCategoryForScheme, getPeersForScheme } from "@/lib/peers/categoryUniverse";

interface SchemeRow {
  code: string;
  name: string | null;
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

function avg(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return Math.round((present.reduce((s, v) => s + v, 0) / present.length) * 100) / 100;
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
    const category = getCategoryForScheme(schemeCode);

    if (!category) {
      return NextResponse.json(
        { error: "Scheme not found in any peer category universe" },
        { status: 404 }
      );
    }

    const peerCodes = getPeersForScheme(schemeCode);
    const allCodes = [schemeCode, ...peerCodes];

    const [{ data: peerRows }, { data: navRows }] = await Promise.all([
      supabase.from("mf_peer_data").select("*").in("scheme_code", allCodes),
      supabase.from("mf_nav_cache").select("scheme_code, scheme_name").in("scheme_code", allCodes),
    ]);

    const nameMap = new Map(
      (navRows ?? []).map((n) => [n.scheme_code as string, n.scheme_name as string | null])
    );
    const peerDataMap = new Map((peerRows ?? []).map((p) => [p.scheme_code as string, p]));

    const toSchemeRow = (code: string): SchemeRow => {
      const p = peerDataMap.get(code);
      return {
        code,
        name: nameMap.get(code) ?? null,
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

    const scheme = toSchemeRow(schemeCode);
    const peers = peerCodes
      .map(toSchemeRow)
      .sort((a, b) => (b.r1y ?? -Infinity) - (a.r1y ?? -Infinity));

    const category_avg = {
      r6m: avg(peers.map((p) => p.r6m)),
      r1y: avg(peers.map((p) => p.r1y)),
      r3y: avg(peers.map((p) => p.r3y)),
      r5y: avg(peers.map((p) => p.r5y)),
    };

    return NextResponse.json({
      data: {
        category,
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
