import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshNavCache, fetchNavForDate } from "@/lib/mfapi";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(
  request: Request,
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
    const date = new URL(request.url).searchParams.get("date");

    if (date) {
      const result = await fetchNavForDate(schemeCode, date);
      if (!result) {
        return NextResponse.json(
          { error: "NAV not found for this scheme on this date" },
          { status: 404 }
        );
      }
      return NextResponse.json({ data: result });
    }

    const { data: cached } = await supabase
      .from("mf_nav_cache")
      .select("*")
      .eq("scheme_code", schemeCode)
      .maybeSingle();

    const isStale =
      !cached ||
      !cached.fetched_at ||
      Date.now() - new Date(cached.fetched_at).getTime() > ONE_DAY_MS;

    if (!isStale) {
      return NextResponse.json({ data: cached });
    }

    await refreshNavCache(schemeCode);

    const { data: refreshed } = await supabase
      .from("mf_nav_cache")
      .select("*")
      .eq("scheme_code", schemeCode)
      .maybeSingle();

    if (refreshed) {
      return NextResponse.json({ data: refreshed });
    }

    // mfapi.in fetch failed — fall back to whatever we had, even if stale.
    if (cached) {
      return NextResponse.json({ data: cached });
    }

    return NextResponse.json(
      { error: "NAV not found for this scheme" },
      { status: 404 }
    );
  } catch (err) {
    console.error(`GET /api/mf/nav/${params.scheme_code} failed:`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
