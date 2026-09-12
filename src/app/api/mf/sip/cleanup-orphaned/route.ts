import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// One-time (but safely re-runnable) sweep for SIP schedules left behind by
// import deletions that happened before the delete route cleaned these up
// (or that predate the scheme_code-vs-scheme_name matching fix). A SIP
// schedule is "orphaned" when no mf_holdings row exists for the same
// owner + fund — matched by scheme_code when the SIP has one, otherwise by
// scheme_name (a SIP with no resolved scheme_code, e.g. from manual add or
// the SIP-detect wizard, can never be matched by scheme_code).
export async function POST() {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: sips, error: sipsError } = await supabase
      .from("mf_sip_schedules")
      .select("id, owner, scheme_code, scheme_name")
      .eq("user_id", user.id);

    if (sipsError) {
      return NextResponse.json({ error: sipsError.message }, { status: 500 });
    }
    if (!sips || sips.length === 0) {
      return NextResponse.json({ deleted_count: 0, deleted: [] });
    }

    const { data: holdings, error: holdingsError } = await supabase
      .from("mf_holdings")
      .select("owner, scheme_code, scheme_name")
      .eq("user_id", user.id);

    if (holdingsError) {
      return NextResponse.json({ error: holdingsError.message }, { status: 500 });
    }

    const codeKeys = new Set((holdings ?? []).map((h) => `${h.owner}:${h.scheme_code}`));
    const nameKeys = new Set((holdings ?? []).map((h) => `${h.owner}:${h.scheme_name}`));

    const orphans = sips.filter((sip) =>
      sip.scheme_code
        ? !codeKeys.has(`${sip.owner}:${sip.scheme_code}`)
        : !nameKeys.has(`${sip.owner}:${sip.scheme_name}`)
    );

    if (orphans.length === 0) {
      return NextResponse.json({ deleted_count: 0, deleted: [] });
    }

    const { error: deleteError } = await supabase
      .from("mf_sip_schedules")
      .delete()
      .in("id", orphans.map((o) => o.id));

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({
      deleted_count: orphans.length,
      deleted: orphans.map((o) => ({ owner: o.owner, scheme_name: o.scheme_name })),
    });
  } catch (err) {
    console.error("POST /api/mf/sip/cleanup-orphaned failed:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
