import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNavHistories } from "@/lib/mfapi";
import { isRealSchemeCode } from "@/lib/peers/peerSync";
import {
  buildPortfolioSeries,
  buildSampleDates,
  computeDayChange,
  type HistoryLot,
} from "@/lib/analysis/portfolioHistory";

// Computed server-side because the raw NAV histories (thousands of rows per
// fund) are far too heavy to ship to the dashboard. Everything here is one
// Supabase read plus parallel mfapi.in fetches (5s timeout each) for funds
// with no cached history, so it stays inside Vercel Hobby's 10s limit.
export const dynamic = "force-dynamic";

type OwnerFilter = "family" | "praveen" | "geetha";

export async function GET(request: Request) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const ownerParam = searchParams.get("owner");
    const owner: OwnerFilter =
      ownerParam === "praveen" || ownerParam === "geetha" ? ownerParam : "family";

    let query = supabase
      .from("mf_holdings")
      .select("scheme_code, as_on_date, units, invested_amount, avg_nav")
      .eq("user_id", user.id);
    if (owner !== "family") query = query.eq("owner", owner);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const lots: HistoryLot[] = (data ?? []).map((h) => ({
      scheme_code: typeof h.scheme_code === "string" && isRealSchemeCode(h.scheme_code) ? h.scheme_code : null,
      as_on_date: String(h.as_on_date),
      units: Number(h.units),
      invested: Number(h.invested_amount),
      avg_nav: Number(h.avg_nav),
    }));

    if (lots.length === 0) {
      return NextResponse.json({ data: { points: [], day_change: null } });
    }

    const codes = Array.from(new Set(lots.map((l) => l.scheme_code).filter((c): c is string => !!c)));
    const histories = await getNavHistories(codes);

    const todayIso = new Date().toISOString().slice(0, 10);
    const firstIso = lots.reduce((min, l) => (l.as_on_date < min ? l.as_on_date : min), todayIso);
    const dates = buildSampleDates(firstIso, todayIso);

    const points = buildPortfolioSeries(lots, histories, dates);
    // Day change only over lots that have a real NAV feed; manual-code lots
    // never move, so they'd only dilute it — but if any real fund is missing
    // its history, computeDayChange returns null rather than a partial figure.
    const day_change = computeDayChange(
      lots.filter((l) => l.scheme_code),
      histories
    );

    return NextResponse.json({
      data: {
        points,
        day_change,
        missing_history: codes.filter((c) => !histories.has(c)),
      },
    });
  } catch (err) {
    console.error("GET /api/mf/portfolio/history failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
