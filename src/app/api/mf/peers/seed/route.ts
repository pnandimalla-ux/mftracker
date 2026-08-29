import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CATEGORY_UNIVERSE } from "@/lib/peers/categoryUniverse";

const SEED_THRESHOLD = 10;

// This route does NOT run the sync itself — syncing all ~70 funds across 7
// categories in one request takes minutes, far past a serverless timeout.
// It just checks whether seeding is needed and hands back the category list;
// the frontend calls POST /api/mf/peers/sync once per category, sequentially.
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

    const serviceClient = createServiceClient();
    const { count, error: countError } = await serviceClient
      .from("mf_peer_data")
      .select("scheme_code", { count: "exact", head: true });

    if (countError) {
      console.error("POST /api/mf/peers/seed count query failed:", countError.message);
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    if ((count ?? 0) >= SEED_THRESHOLD) {
      return NextResponse.json(
        {
          error:
            "Peer data already seeded — this route only runs when mf_peer_data has fewer than 10 rows.",
        },
        { status: 409 }
      );
    }

    const categories = Object.keys(CATEGORY_UNIVERSE);
    console.log("POST /api/mf/peers/seed — categories to sync:", categories);

    return NextResponse.json({ categories });
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
