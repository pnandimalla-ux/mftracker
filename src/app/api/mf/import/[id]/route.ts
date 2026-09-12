import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Deletes an import batch. mf_holdings.import_id is ON DELETE CASCADE
// (migration_006), so deleting the mf_cas_imports row automatically removes
// every mf_holdings row it created — rows with import_id = NULL (manually
// added lots) are untouched. mf_cas_imports is read-only for regular users
// per this project's RLS convention, so it's verified with the regular
// client (SELECT is allowed) but deleted with the service client.
//
// A SIP schedule isn't tied to any one import_id (it's a standalone
// recurring plan, not a lot), so it never cascade-deletes on its own —
// deleting the fund's last lot has to explicitly clean up the matching
// mf_sip_schedules row too, or the calendar keeps showing a SIP for a fund
// that no longer has any holdings.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: importRow, error: fetchError } = await supabase
      .from("mf_cas_imports")
      .select("id, user_id")
      .eq("id", params.id)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!importRow || importRow.user_id !== user.id) {
      return NextResponse.json({ error: "Import not found" }, { status: 404 });
    }

    const { data: importedHoldings, count: deletedHoldingsCount } = await supabase
      .from("mf_holdings")
      .select("owner, scheme_code, scheme_name", { count: "exact" })
      .eq("user_id", user.id)
      .eq("import_id", params.id);

    const serviceClient = createServiceClient();

    const { error: deleteImportError } = await serviceClient
      .from("mf_cas_imports")
      .delete()
      .eq("id", params.id);

    if (deleteImportError) {
      return NextResponse.json({ error: deleteImportError.message }, { status: 500 });
    }

    // Only drop the SIP schedule for a fund once every lot behind it (across
    // every import, not just this one) is actually gone — a fund with lots
    // from an earlier import too should keep its SIP schedule.
    const uniquePairs = Array.from(
      new Map(
        (importedHoldings ?? []).map((h) => [`${h.owner}:${h.scheme_code}`, h])
      ).values()
    );

    let deletedSipSchedules = 0;
    for (const { owner, scheme_code, scheme_name } of uniquePairs) {
      if (!scheme_code) continue;

      const { count } = await supabase
        .from("mf_holdings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("owner", owner)
        .eq("scheme_code", scheme_code);

      if (count === 0) {
        const { count: sipDeleteCount } = await serviceClient
          .from("mf_sip_schedules")
          .delete({ count: "exact" })
          .eq("user_id", user.id)
          .eq("owner", owner)
          .eq("scheme_code", scheme_code);
        deletedSipSchedules += sipDeleteCount ?? 0;

        // A SIP created without a resolved scheme_code (manual add, or the
        // SIP-detect wizard when mfapi.in had no match) can never match the
        // .eq("scheme_code", ...) delete above — null never equals a value
        // in SQL — so it has to be matched by scheme_name instead.
        const { count: sipDeleteByNameCount } = await serviceClient
          .from("mf_sip_schedules")
          .delete({ count: "exact" })
          .eq("user_id", user.id)
          .eq("owner", owner)
          .is("scheme_code", null)
          .eq("scheme_name", scheme_name);
        deletedSipSchedules += sipDeleteByNameCount ?? 0;
      }
    }

    return NextResponse.json({
      deleted_holdings: deletedHoldingsCount ?? 0,
      deleted_sip_schedules: deletedSipSchedules,
    });
  } catch (err) {
    console.error(`DELETE /api/mf/import/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
