import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncAllHoldings } from "@/lib/nav/navSync";
import { autoAddMissingPeerData } from "@/lib/peers/peerSync";

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

    // Best-effort: make sure every held fund has at least a basic entry in
    // mf_peer_data, even if a full "Sync peers" pass has never run for its
    // category. Never fails the NAV sync response if this has trouble.
    let peerDataAdded = 0;
    try {
      const { data: holdings } = await supabase
        .from("mf_holdings")
        .select("scheme_code, category")
        .eq("user_id", user.id);

      if (holdings && holdings.length > 0) {
        const autoAddResult = await autoAddMissingPeerData(
          holdings.map((h) => ({ scheme_code: h.scheme_code as string, category: h.category as string }))
        );
        peerDataAdded = autoAddResult.added;
      }
    } catch (err) {
      console.error("Failed to auto-add held funds to mf_peer_data after NAV sync:", err);
    }

    return NextResponse.json({ ...result, peerDataAdded });
  } catch (err) {
    console.error("POST /api/mf/nav/sync failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
