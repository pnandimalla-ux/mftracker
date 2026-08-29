import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncPeerData } from "@/lib/peers/peerSync";
import { CATEGORY_UNIVERSE } from "@/lib/peers/categoryUniverse";

// Syncing all ~70 funds across 7 categories in one request can take minutes —
// well past a typical serverless timeout. Each call here only processes ONE
// category (~10-12 funds), so the frontend loops over categories sequentially
// instead of asking the server to do it all in a single request.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    console.log("POST /api/mf/peers/sync body:", body);

    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    console.log("POST /api/mf/peers/sync auth user id:", user?.id ?? null);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const category = typeof body?.category === "string" ? body.category : undefined;

    if (!category) {
      return NextResponse.json(
        { error: "category is required — call this once per category" },
        { status: 400 }
      );
    }
    if (!CATEGORY_UNIVERSE[category]) {
      return NextResponse.json(
        { error: `Unknown category: ${category}` },
        { status: 400 }
      );
    }

    const result = await syncPeerData(category);
    const status = result.failed === 0 ? "success" : result.processed === 0 ? "failed" : "partial";

    try {
      const serviceClient = createServiceClient();
      await serviceClient.from("mf_sync_log").insert({
        cron_name: `mf-peers-sync:${category}`,
        status,
        rows_updated: result.processed,
        error_message: result.errors.length > 0 ? result.errors.join("; ") : null,
      });
    } catch (logErr) {
      // Never fail the request just because the audit log write failed.
      console.error("Failed to write mf_sync_log entry:", logErr);
    }

    return NextResponse.json({ category, status, ...result });
  } catch (err) {
    console.error("POST /api/mf/peers/sync failed:", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
