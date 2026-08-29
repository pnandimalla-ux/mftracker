import { NextResponse } from "next/server";
import { syncAllTier2 } from "@/lib/peers/tier2Sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Tier 2 monthly cron: syncs every fund across every category (~70+ funds)
// and rolls up mf_category_stats for the AI recommendation engine. Slow and
// low-urgency, hence monthly rather than weekly.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncAllTier2();

  return NextResponse.json(result);
}
