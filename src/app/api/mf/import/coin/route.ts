import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseCoinCsv } from "@/lib/parsers/coinCsvParser";

export const maxDuration = 60;

// Preview-only — parses the uploaded Zerodha Coin order-history CSV and
// resolves an mfapi.in scheme code for each fund, but does NOT write to
// mf_holdings. Owner is auto-detected per row from client_id, so a single
// CSV covering both accounts splits into funds tagged with the right owner
// automatically — the user reviews/edits in the UI, then POSTs the
// confirmed selection to /api/mf/import/coin/confirm.
export async function POST(request: Request) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "Only .csv files are supported" }, { status: 400 });
    }

    const csvText = await file.text();
    if (!csvText.trim()) {
      return NextResponse.json({ error: "The uploaded file is empty" }, { status: 422 });
    }

    const result = await parseCoinCsv(csvText);

    if (result.funds.length === 0 && result.excluded_etfs.length === 0 && result.sell_transactions.length === 0) {
      return NextResponse.json(
        {
          error:
            "No completed orders were found in this file. Make sure you exported Order History from coin.zerodha.com.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/mf/import/coin failed:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
