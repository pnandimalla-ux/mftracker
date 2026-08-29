import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRoleClient";
import { syncAllHoldingsForAllUsers } from "@/lib/nav/navSync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncAllHoldingsForAllUsers();
  const status = result.failed === 0 ? "success" : result.synced === 0 ? "failed" : "partial";

  const supabase = createServiceRoleClient();
  await supabase.from("mf_sync_log").insert({
    cron_name: "mf-daily",
    status,
    rows_updated: result.synced,
    error_message: result.errors.length > 0 ? result.errors.join("; ") : null,
  });

  return NextResponse.json({
    status,
    synced: result.synced,
    failed: result.failed,
    errors: result.errors,
  });
}
