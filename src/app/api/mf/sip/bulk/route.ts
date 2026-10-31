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

interface ExistingSchedule {
  owner: string;
  scheme_code: string | null;
  scheme_name: string;
  sip_date: number;
  frequency: SIPFrequency;
}

const realCode = (code: string | null) => (code && !code.startsWith("manual-") ? code : null);
const isPeriodic = (f: SIPFrequency) => f === "weekly" || f === "bi-weekly";

// Same owner and same fund — matching real scheme codes, or the same name
// (case-insensitive). Comparing on name too means a schedule saved without a
// code (fund unresolved at import) still collides with one saved with it.
function isSameFund(a: ExistingSchedule, b: ExistingSchedule): boolean {
  if (a.owner !== b.owner) return false;
  const ac = realCode(a.scheme_code);
  const bc = realCode(b.scheme_code);
  if (ac && bc && ac === bc) return true;
  return a.scheme_name.trim().toLowerCase() === b.scheme_name.trim().toLowerCase();
}

function isDuplicateSchedule(existing: ExistingSchedule, item: ExistingSchedule): boolean {
  if (!isSameFund(existing, item)) return false;
  if (isPeriodic(existing.frequency) || isPeriodic(item.frequency)) {
    return isPeriodic(existing.frequency) && isPeriodic(item.frequency);
  }
  return dayDistance(existing.sip_date, item.sip_date) <= SIP_DAY_TOLERANCE;
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
    // several monthly SIPs on different dates (e.g. the 1st and the 16th), so
    // a monthly/quarterly item is only a duplicate when the same owner + fund
    // already has one within SIP_DAY_TOLERANCE days of its sip_date. A
    // weekly/bi-weekly schedule's sip_date is just its first lot's day, so
    // any existing weekly/bi-weekly schedule of the fund counts as the same.
    const { data: existingRows, error: existingError } = await supabase
      .from("mf_sip_schedules")
      .select("owner, scheme_code, scheme_name, sip_date, frequency")
      .eq("user_id", user.id);
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    const existing: ExistingSchedule[] = (existingRows ?? [])
      .filter((row) => Number.isFinite(Number(row.sip_date)))
      .map((row) => ({
        owner: row.owner,
        scheme_code: row.scheme_code ?? null,
        scheme_name: row.scheme_name ?? "",
        sip_date: Number(row.sip_date),
        frequency: row.frequency as SIPFrequency,
      }));

    const rowsToInsert: Record<string, unknown>[] = [];
    const skippedItems: { scheme_name: string; owner: Owner; sip_date: number }[] = [];

    for (const item of validItems) {
      if (existing.some((row) => isDuplicateSchedule(row, item))) {
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
      existing.push(item);
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
