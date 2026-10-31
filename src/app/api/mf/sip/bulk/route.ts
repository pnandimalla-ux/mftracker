import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Owner, SIPFrequency } from "@/types/mf";
import { dayDistance, SIP_DAY_TOLERANCE } from "@/lib/sipDetection";

interface BulkSipInput {
  scheme_name: string;
  scheme_code: string | null;
  owner: Owner;
  amount: number;
  sip_date: number;
  category: string | null;
  frequency: SIPFrequency;
  start_date: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const maxDuration = 60;

const VALID_FREQUENCIES: SIPFrequency[] = ["weekly", "bi-weekly", "monthly", "quarterly"];

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

    const today = new Date().toISOString().slice(0, 10);

    const validItems: BulkSipInput[] = [];
    for (const raw of body.sips as Record<string, unknown>[]) {
      const owner = raw.owner === "praveen" || raw.owner === "geetha" ? raw.owner : null;
      const scheme_name = typeof raw.scheme_name === "string" ? raw.scheme_name.trim() : "";
      const amount = Number(raw.amount);
      const sip_date = Number(raw.sip_date);

      const start_date =
        typeof raw.start_date === "string" && ISO_DATE_RE.test(raw.start_date)
          ? raw.start_date
          : today;

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
        frequency: VALID_FREQUENCIES.includes(raw.frequency as SIPFrequency)
          ? (raw.frequency as SIPFrequency)
          : "monthly",
        start_date,
      });
    }

    if (validItems.length === 0) {
      return NextResponse.json({ error: "No valid SIPs to add" }, { status: 400 });
    }

    // De-dupe against existing schedules. A fund can legitimately have
    // several SIPs on different dates (e.g. the 1st and the 16th), so an item
    // is only a duplicate when the same owner + fund already has a schedule
    // within SIP_DAY_TOLERANCE days of its sip_date. Funds without a
    // scheme_code (manual / unmatched) match on scheme_name instead.
    const { data: existingRows, error: existingError } = await supabase
      .from("mf_sip_schedules")
      .select("owner, scheme_code, scheme_name, sip_date, frequency")
      .eq("user_id", user.id);
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    const fundKey = (owner: string, scheme_code: string | null, scheme_name: string) =>
      scheme_code ? `${owner}:code:${scheme_code}` : `${owner}:name:${scheme_name.trim().toLowerCase()}`;

    const existingDays = new Map<string, number[]>();
    const addExisting = (key: string, day: number) => {
      const list = existingDays.get(key) ?? [];
      list.push(day);
      existingDays.set(key, list);
    };
    for (const row of existingRows ?? []) {
      const day = Number(row.sip_date);
      if (!Number.isFinite(day)) continue;
      addExisting(fundKey(row.owner, row.scheme_code, row.scheme_name ?? ""), day);
      // Let a manual item also collide with a coded schedule of the same name.
      if (row.scheme_code && row.scheme_name) addExisting(fundKey(row.owner, null, row.scheme_name), day);
    }

    const rowsToInsert: Record<string, unknown>[] = [];
    const skippedItems: { scheme_name: string; owner: Owner; sip_date: number }[] = [];

    for (const item of validItems) {
      const key = fundKey(item.owner, item.scheme_code, item.scheme_name);
      const days = existingDays.get(key) ?? [];
      if (days.some((d) => dayDistance(d, item.sip_date) <= SIP_DAY_TOLERANCE)) {
        skippedItems.push({ scheme_name: item.scheme_name, owner: item.owner, sip_date: item.sip_date });
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
        start_date: item.start_date,
        is_active: true,
        notify_email: true,
        notify_sms: false,
      });

      // Avoid inserting near-duplicates within one batch.
      addExisting(key, item.sip_date);
      if (item.scheme_code) addExisting(fundKey(item.owner, null, item.scheme_name), item.sip_date);
    }

    const skipped = skippedItems.length;

    if (rowsToInsert.length === 0) {
      return NextResponse.json({ created: 0, skipped, skipped_items: skippedItems });
    }

    const { data: inserted, error } = await supabase
      .from("mf_sip_schedules")
      .insert(rowsToInsert)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      created: inserted?.length ?? rowsToInsert.length,
      skipped,
      skipped_items: skippedItems,
    });
  } catch (err) {
    console.error("POST /api/mf/sip/bulk failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
