import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Deletes an import batch and every mf_holdings row it created. mf_holdings
// deletes go through the caller's own (RLS-scoped) client; mf_cas_imports —
// read-only for regular users per this project's RLS convention — is
// verified with the regular client (SELECT is allowed) but deleted with the
// service client.
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

    const serviceClient = createServiceClient();

    const { data: deletedHoldings, error: deleteHoldingsError } = await supabase
      .from("mf_holdings")
      .delete()
      .eq("user_id", user.id)
      .eq("import_id", params.id)
      .select("id");

    if (deleteHoldingsError) {
      return NextResponse.json({ error: deleteHoldingsError.message }, { status: 500 });
    }

    const { error: deleteImportError } = await serviceClient
      .from("mf_cas_imports")
      .delete()
      .eq("id", params.id);

    if (deleteImportError) {
      return NextResponse.json({ error: deleteImportError.message }, { status: 500 });
    }

    return NextResponse.json({ deleted_holdings: deletedHoldings?.length ?? 0 });
  } catch (err) {
    console.error(`DELETE /api/mf/import/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
