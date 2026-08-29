import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { syncAllPeerData } from "@/lib/peers/peerSync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncAllPeerData();
  const status = result.failed === 0 ? "success" : result.processed === 0 ? "failed" : "partial";

  const supabase = createServiceRoleClient();
  await supabase.from("mf_sync_log").insert({
    cron_name: "mf-weekly-peers",
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
}
