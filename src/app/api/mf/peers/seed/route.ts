import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { syncAllPeerData } from "@/lib/peers/peerSync";

const SEED_THRESHOLD = 10;

export async function POST() {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceRoleClient();
    const { count, error: countError } = await serviceClient
      .from("mf_peer_data")
      .select("scheme_code", { count: "exact", head: true });

    if (countError) {
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

    const result = await syncAllPeerData();
    const status = result.failed === 0 ? "success" : result.processed === 0 ? "failed" : "partial";

    await serviceClient.from("mf_sync_log").insert({
      cron_name: "mf-peers-seed",
      status,
      rows_updated: result.processed,
      error_message: result.errors.length > 0 ? result.errors.join("; ") : null,
    });

    return NextResponse.json({
      status,
      processed: result.processed,
      failed: result.failed,
      errors: result.errors,
      byCategory: result.byCategory,
    });
  } catch (err) {
    console.error("POST /api/mf/peers/seed failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
