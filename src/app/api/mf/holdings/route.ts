import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshNavCache } from "@/lib/mfapi";

export async function GET() {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: holdings, error } = await supabase
      .from("mf_holdings")
      .select("*")
      .eq("user_id", user.id)
      .order("invested_amount", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const schemeCodes = Array.from(
      new Set((holdings ?? []).map((h) => h.scheme_code))
    );

    let navMap: Record<string, { nav: number; nav_date: string | null }> = {};

    if (schemeCodes.length > 0) {
      const { data: navRows } = await supabase
        .from("mf_nav_cache")
        .select("scheme_code, nav, nav_date")
        .in("scheme_code", schemeCodes);

      navMap = Object.fromEntries(
        (navRows ?? []).map((n) => [
          n.scheme_code,
          { nav: Number(n.nav ?? 0), nav_date: n.nav_date },
        ])
      );
    }

    const enriched = (holdings ?? []).map((h) => {
      const navInfo = navMap[h.scheme_code];
      const currentNav = navInfo && navInfo.nav > 0 ? navInfo.nav : Number(h.avg_nav);
      const invested = Number(h.invested_amount);
      const current_value = Number(h.units) * currentNav;
      const pnl = current_value - invested;
      const pnl_pct = invested > 0 ? (pnl / invested) * 100 : 0;

      return {
        ...h,
        current_nav: currentNav,
        nav_date: navInfo?.nav_date ?? null,
        current_value,
        pnl,
        pnl_pct,
      };
    });

    return NextResponse.json({ data: enriched });
  } catch (err) {
    console.error("GET /api/mf/holdings failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
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
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const {
      owner,
      scheme_code,
      scheme_name,
      category,
      amc,
      units,
      avg_nav,
      invested_amount,
      as_on_date,
    } = body as Record<string, unknown>;

    if (owner !== "praveen" && owner !== "geetha") {
      return NextResponse.json(
        { error: "owner must be 'praveen' or 'geetha'" },
        { status: 400 }
      );
    }
    if (typeof scheme_name !== "string" || !scheme_name.trim()) {
      return NextResponse.json(
        { error: "scheme_name is required" },
        { status: 400 }
      );
    }
    if (typeof category !== "string" || !category.trim()) {
      return NextResponse.json(
        { error: "category is required" },
        { status: 400 }
      );
    }
    if (typeof units !== "number" || !Number.isFinite(units) || units <= 0) {
      return NextResponse.json(
        { error: "units must be a positive number" },
        { status: 400 }
      );
    }
    if (
      typeof avg_nav !== "number" ||
      !Number.isFinite(avg_nav) ||
      avg_nav <= 0
    ) {
      return NextResponse.json(
        { error: "avg_nav must be a positive number" },
        { status: 400 }
      );
    }
    if (
      typeof invested_amount !== "number" ||
      !Number.isFinite(invested_amount) ||
      invested_amount <= 0
    ) {
      return NextResponse.json(
        { error: "invested_amount must be a positive number" },
        { status: 400 }
      );
    }

    let cleanAsOnDate = new Date().toISOString().slice(0, 10);
    if (as_on_date !== undefined) {
      if (typeof as_on_date !== "string" || !as_on_date) {
        return NextResponse.json(
          { error: "as_on_date must be a valid date string" },
          { status: 400 }
        );
      }
      const parsedDate = new Date(as_on_date);
      if (Number.isNaN(parsedDate.getTime())) {
        return NextResponse.json(
          { error: "as_on_date must be a valid date" },
          { status: 400 }
        );
      }
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (parsedDate.getTime() > today.getTime()) {
        return NextResponse.json(
          { error: "as_on_date cannot be in the future" },
          { status: 400 }
        );
      }
      cleanAsOnDate = as_on_date;
    }

    const cleanSchemeCode =
      typeof scheme_code === "string" && scheme_code.trim()
        ? scheme_code.trim()
        : null;

    const { data, error } = await supabase
      .from("mf_holdings")
      .insert({
        user_id: user.id,
        owner,
        scheme_code: cleanSchemeCode ?? `manual-${Date.now()}`,
        scheme_name: scheme_name.trim(),
        category,
        amc: typeof amc === "string" && amc.trim() ? amc.trim() : null,
        units,
        avg_nav,
        invested_amount,
        as_on_date: cleanAsOnDate,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (cleanSchemeCode) {
      // Best-effort — don't fail the request if mfapi.in is unreachable.
      await refreshNavCache(cleanSchemeCode);
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error("POST /api/mf/holdings failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
