import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncTier1 } from "@/lib/peers/tier1Sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Tier 1 weekly cron: syncs peer data for only the categories each user
// actually holds funds in. Different users can hold different categories,
// so this runs syncTier1 once PER user rather than once globally.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: holdingRows, error } = await supabase.from("mf_holdings").select("user_id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = Array.from(new Set((holdingRows ?? []).map((r) => r.user_id as string)));

  const byUser: Record<string, { categories: string[]; funds_processed: number; duration_ms: number }> = {};
  let totalFundsProcessed = 0;

  for (const userId of userIds) {
    const result = await syncTier1(userId);
    byUser[userId] = result;
    totalFundsProcessed += result.funds_processed;
  }

  await supabase.from("mf_sync_log").insert({
    cron_name: "mf-weekly",
    status: "success",
    rows_updated: totalFundsProcessed,
    error_message: null,
  });

  return NextResponse.json({
    users_synced: userIds.length,
    total_funds_processed: totalFundsProcessed,
    byUser,
  });
}
