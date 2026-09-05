import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Deletes an import batch. mf_holdings.import_id is ON DELETE CASCADE
// (migration_006), so deleting the mf_cas_imports row automatically removes
// every mf_holdings row it created — rows with import_id = NULL (manually
// added lots) are untouched. mf_cas_imports is read-only for regular users
// per this project's RLS convention, so it's verified with the regular
// client (SELECT is allowed) but deleted with the service client.
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

    const { count: deletedHoldingsCount } = await supabase
      .from("mf_holdings")
      .select("id", { count: "exact", head: true })
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

    return NextResponse.json({ deleted_holdings: deletedHoldingsCount ?? 0 });
  } catch (err) {
    console.error(`DELETE /api/mf/import/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
