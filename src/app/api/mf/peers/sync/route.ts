import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncPeerData, syncAllPeerData } from "@/lib/peers/peerSync";
import { CATEGORY_UNIVERSE } from "@/lib/peers/categoryUniverse";

export async function POST(request: Request) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const category = typeof body?.category === "string" ? body.category : undefined;

    if (category) {
      if (!CATEGORY_UNIVERSE[category]) {
        return NextResponse.json(
          { error: `Unknown category: ${category}` },
          { status: 400 }
        );
      }
      const result = await syncPeerData(category);
      return NextResponse.json(result);
    }

    const result = await syncAllPeerData();
    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/mf/peers/sync failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
