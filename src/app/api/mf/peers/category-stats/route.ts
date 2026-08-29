import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensurePeerDataSchema } from "@/lib/peers/peerSync";

// Cross-category intelligence for the AI recommendation engine — the output
// of a tier2 sync (see src/lib/peers/tier2Sync.ts / mf_category_stats).
export async function GET() {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Guards against the table not existing yet if no tier2 sync has run.
    await ensurePeerDataSchema();

    const { data, error } = await supabase
      .from("mf_category_stats")
      .select("*")
      .order("avg_r1y", { ascending: false, nullsFirst: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    console.error("GET /api/mf/peers/category-stats failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
