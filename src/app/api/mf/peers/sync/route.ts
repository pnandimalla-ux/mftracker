import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { calculateReturns, type NavHistoryEntry } from "@/lib/peers/peerSync";
import { syncTier1Category } from "@/lib/peers/tier1Sync";
import { syncTier2Category } from "@/lib/peers/tier2Sync";
import { CATEGORY_UNIVERSE } from "@/lib/peers/categoryUniverse";

// A single category's tier1 sync is ~10-12 funds; tier2 is the same funds
// plus category-stats rollup. Either fits well inside this budget — the
// frontend still loops one category per request so progress is visible.
export const maxDuration = 60;

async function runTestMode(category: string) {
  const schemeCode = CATEGORY_UNIVERSE[category][0].code;
  console.log("Test mode — fetching scheme:", schemeCode);

  let mfapiResponseStatus: "SUCCESS" | "error" = "error";
  let navHistoryLength = 0;
  let latestNav: string | null = null;
  let latestDate: string | null = null;
  let history: NavHistoryEntry[] = [];

  try {
    const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}`, { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.data)) {
        history = json.data;
        navHistoryLength = history.length;
        latestNav = history[0]?.nav ?? null;
        latestDate = history[0]?.date ?? null;
        // mfapi.in's real API has no top-level `status` field on this
        // endpoint — treat a well-formed data array as success, but honor
        // an explicit status field from any mirror that does send one.
        mfapiResponseStatus =
          typeof json?.status === "string" && json.status !== "SUCCESS" ? "error" : "SUCCESS";
      }
    }
  } catch (err) {
    console.error("Test mode fetch failed:", schemeCode, err);
  }

  const calculatedReturns = calculateReturns(history);

  let upsertResult = "success";
  if (mfapiResponseStatus === "SUCCESS") {
    try {
      const serviceClient = createServiceClient();
      const { error } = await serviceClient.from("mf_peer_data").upsert(
        {
          scheme_code: schemeCode,
          category,
          r6m: calculatedReturns.r6m,
          r1y: calculatedReturns.r1y,
          r3y: calculatedReturns.r3y,
          r5y: calculatedReturns.r5y,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "scheme_code" }
      );
      if (error) upsertResult = error.message;
    } catch (err) {
      upsertResult = err instanceof Error ? err.message : String(err);
    }
  } else {
    upsertResult = "skipped — mfapi.in fetch failed";
  }

  return {
    scheme_code: schemeCode,
    mfapi_response_status: mfapiResponseStatus,
    nav_history_length: navHistoryLength,
    latest_nav: latestNav,
    latest_date: latestDate,
    calculated_returns: calculatedReturns,
    upsert_result: upsertResult,
  };
}

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
    const test = body?.test === true;
    const tier = body?.tier === 2 ? 2 : 1;

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

    if (test) {
      const debugInfo = await runTestMode(category);
      return NextResponse.json(debugInfo);
    }

    const result = tier === 2 ? await syncTier2Category(category) : await syncTier1Category(category);
    const status = result.failed === 0 ? "success" : result.processed === 0 ? "failed" : "partial";

    try {
      const serviceClient = createServiceClient();
      await serviceClient.from("mf_sync_log").insert({
        cron_name: `mf-peers-sync:tier${tier}:${category}`,
        status,
        rows_updated: result.processed,
        error_message: result.errors.length > 0 ? result.errors.join("; ") : null,
      });
    } catch (logErr) {
      // Never fail the request just because the audit log write failed.
      console.error("Failed to write mf_sync_log entry:", logErr);
    }

    return NextResponse.json({ category, tier, status, ...result });
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
