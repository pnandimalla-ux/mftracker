import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncAllHoldings } from "@/lib/nav/navSync";

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

    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/mf/nav/sync failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
