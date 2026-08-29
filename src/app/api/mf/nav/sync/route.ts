import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncAllHoldings } from "@/lib/nav/navSync";
import { syncTier1 } from "@/lib/peers/tier1Sync";

export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await syncAllHoldings(user.id);

    // Best-effort: keep this user's held-category peer data fresh too.
    // Never fails the NAV sync response if tier1 has trouble.
    let peerCategories: string[] = [];
    let peerFundsProcessed = 0;
    try {
      const tier1Result = await syncTier1(user.id);
      peerCategories = tier1Result.categories;
      peerFundsProcessed = tier1Result.funds_processed;
    } catch (err) {
      console.error("Failed to run tier1 peer sync after NAV sync:", err);
    }

    return NextResponse.json({ ...result, peerCategories, peerFundsProcessed });
  } catch (err) {
    console.error("POST /api/mf/nav/sync failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
