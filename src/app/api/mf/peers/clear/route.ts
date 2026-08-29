import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Wipes mf_peer_data entirely so a fresh sync starts from a clean slate,
// instead of leaving stale/partial rows from a previous failed run.
export async function DELETE() {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    console.log("DELETE /api/mf/peers/clear auth user id:", user?.id ?? null);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();
    const { error, count } = await serviceClient
      .from("mf_peer_data")
      .delete({ count: "exact" })
      // scheme_code is the primary key (never null) — this matches every row
      // without relying on an "always true" filter PostgREST might reject.
      .not("scheme_code", "is", null);

    if (error) {
      console.error("DELETE /api/mf/peers/clear failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("Cleared mf_peer_data rows:", count ?? 0);

    return NextResponse.json({ deleted: count ?? 0 });
  } catch (err) {
    console.error("DELETE /api/mf/peers/clear failed:", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
