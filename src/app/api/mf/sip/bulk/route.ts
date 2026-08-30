import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Owner, SIPFrequency } from "@/types/mf";

interface BulkSipInput {
  scheme_name: string;
  scheme_code: string | null;
  owner: Owner;
  amount: number;
  sip_date: number;
  category: string | null;
  frequency: SIPFrequency;
}

export async function POST(request: Request) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.sips) || body.sips.length === 0) {
      return NextResponse.json({ error: "sips array is required" }, { status: 400 });
    }

    const validItems: BulkSipInput[] = [];
    for (const raw of body.sips as Record<string, unknown>[]) {
      const owner = raw.owner === "praveen" || raw.owner === "geetha" ? raw.owner : null;
      const scheme_name = typeof raw.scheme_name === "string" ? raw.scheme_name.trim() : "";
      const amount = Number(raw.amount);
      const sip_date = Number(raw.sip_date);

      if (!owner || !scheme_name) continue;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (!Number.isInteger(sip_date) || sip_date < 1 || sip_date > 31) continue;

      validItems.push({
        scheme_name,
        scheme_code: typeof raw.scheme_code === "string" && raw.scheme_code.trim() ? raw.scheme_code.trim() : null,
        owner,
        amount,
        sip_date,
        category: typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : null,
        frequency: raw.frequency === "quarterly" ? "quarterly" : "monthly",
      });
    }

    if (validItems.length === 0) {
      return NextResponse.json({ error: "No valid SIPs to add" }, { status: 400 });
    }

    // De-dupe against existing schedules for this user by owner + scheme_code
    // — a manual/unmatched fund (no scheme_code) can't be deduped this way,
    // so it's always inserted.
    const schemeCodes = Array.from(
      new Set(validItems.map((i) => i.scheme_code).filter((c): c is string => !!c))
    );
    const existingKeys = new Set<string>();
    if (schemeCodes.length > 0) {
      const { data: existingRows } = await supabase
        .from("mf_sip_schedules")
        .select("owner, scheme_code")
        .eq("user_id", user.id)
        .in("scheme_code", schemeCodes);
      for (const row of existingRows ?? []) {
        existingKeys.add(`${row.owner}:${row.scheme_code}`);
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const rowsToInsert: Record<string, unknown>[] = [];
    let skipped = 0;

    for (const item of validItems) {
      const key = item.scheme_code ? `${item.owner}:${item.scheme_code}` : null;
      if (key && existingKeys.has(key)) {
        skipped++;
        continue;
      }

      rowsToInsert.push({
        user_id: user.id,
        owner: item.owner,
        scheme_code: item.scheme_code,
        scheme_name: item.scheme_name,
        category: item.category,
        amount: item.amount,
        sip_date: item.sip_date,
        frequency: item.frequency,
        start_date: today,
        is_active: true,
        notify_email: true,
        notify_sms: false,
      });

      // Avoid inserting the same owner+scheme_code twice within one batch.
      if (key) existingKeys.add(key);
    }

    if (rowsToInsert.length === 0) {
      return NextResponse.json({ created: 0, skipped });
    }

    const { data: inserted, error } = await supabase
      .from("mf_sip_schedules")
      .insert(rowsToInsert)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ created: inserted?.length ?? rowsToInsert.length, skipped });
  } catch (err) {
    console.error("POST /api/mf/sip/bulk failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
