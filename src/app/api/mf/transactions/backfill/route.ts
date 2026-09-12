import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// One-time (but safely re-runnable) backfill: mf_transactions was added
// after mf_holdings and mf_sell_transactions already had data, so it
// started out empty and the Reports page showed ₹0. This calls a Postgres
// function (migration_009) that inserts whatever's missing from each source
// table, keyed by owner + scheme_code + trade_date + amount so re-running
// this is a no-op the second time. Gated on a regular authenticated session
// (like /api/mf/peers/seed) even though the actual insert runs with the
// service client, since the underlying function operates across all rows
// with security definer, not scoped to the caller's user_id.
export async function POST() {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient.rpc("backfill_mf_transactions");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const row = Array.isArray(data) ? data[0] : data;
    const buy_inserted = Number(row?.buy_inserted ?? 0);
    const sell_inserted = Number(row?.sell_inserted ?? 0);

    return NextResponse.json({
      buy_inserted,
      sell_inserted,
      total_inserted: buy_inserted + sell_inserted,
    });
  } catch (err) {
    console.error("POST /api/mf/transactions/backfill failed:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
