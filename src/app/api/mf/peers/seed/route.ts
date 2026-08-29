import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_UNIVERSE } from "@/lib/peers/categoryUniverse";

// This route does NOT run the sync itself — syncing all ~70 funds across 7
// categories in one request takes minutes, far past a serverless timeout.
// It's just a helper that hands back the category list; the frontend calls
// POST /api/mf/peers/sync once per category, sequentially. No gate on
// existing row count — mf_peer_data may already have rows but they can be
// partial or stale, so re-syncing should always be allowed.
export async function POST() {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    console.log("POST /api/mf/peers/seed auth user id:", user?.id ?? null);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const categories = Object.keys(CATEGORY_UNIVERSE);
    console.log("POST /api/mf/peers/seed — categories to sync:", categories);

    return NextResponse.json({
      categories,
      message: "Call /api/mf/peers/sync with each category",
    });
  } catch (err) {
    console.error("POST /api/mf/peers/seed failed:", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
