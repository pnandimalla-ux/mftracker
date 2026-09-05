import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshNavCache } from "@/lib/mfapi";

interface ImportRow {
  scheme_name: string;
  scheme_code: string | null;
  category: string;
  units: number;
  avg_nav: number;
  invested_amount: number;
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
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { owner, filename, rows } = body as {
      owner?: unknown;
      filename?: unknown;
      rows?: unknown;
    };

    if (owner !== "praveen" && owner !== "geetha") {
      return NextResponse.json(
        { error: "owner must be 'praveen' or 'geetha'" },
        { status: 400 }
      );
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: "rows must be a non-empty array" },
        { status: 400 }
      );
    }

    const validRows: ImportRow[] = [];
    for (const raw of rows as Record<string, unknown>[]) {
      if (
        typeof raw?.scheme_name === "string" &&
        raw.scheme_name.trim() &&
        typeof raw?.category === "string" &&
        raw.category.trim() &&
        typeof raw?.units === "number" &&
        Number.isFinite(raw.units) &&
        raw.units > 0 &&
        typeof raw?.avg_nav === "number" &&
        Number.isFinite(raw.avg_nav) &&
        raw.avg_nav > 0 &&
        typeof raw?.invested_amount === "number" &&
        Number.isFinite(raw.invested_amount) &&
        raw.invested_amount > 0
      ) {
        validRows.push({
          scheme_name: raw.scheme_name.trim(),
          scheme_code:
            typeof raw.scheme_code === "string" && raw.scheme_code.trim()
              ? raw.scheme_code.trim()
              : null,
          category: raw.category.trim(),
          units: raw.units,
          avg_nav: raw.avg_nav,
          invested_amount: raw.invested_amount,
        });
      }
    }

    if (validRows.length === 0) {
      return NextResponse.json(
        { error: "No valid rows to import" },
        { status: 400 }
      );
    }

    // mf_cas_imports is inserted FIRST so each holding row can carry the
    // batch's id — lets a later delete of the import cascade-remove every
    // holding it created (mf_holdings.import_id is ON DELETE CASCADE).
    const { data: importRow, error: importInsertError } = await supabase
      .from("mf_cas_imports")
      .insert({
        user_id: user.id,
        owner,
        filename: typeof filename === "string" ? filename : null,
        status: "success",
        rows_imported: 0,
      })
      .select()
      .single();

    if (importInsertError) {
      console.error("Failed to create mf_cas_imports row:", importInsertError.message);
    }
    const importId = importRow?.id ?? null;

    const asOnDate = new Date().toISOString().slice(0, 10);
    const insertPayload = validRows.map((r, i) => ({
      user_id: user.id,
      owner,
      scheme_code: r.scheme_code ?? `cas-import-${Date.now()}-${i}`,
      scheme_name: r.scheme_name,
      category: r.category,
      units: r.units,
      avg_nav: r.avg_nav,
      invested_amount: r.invested_amount,
      as_on_date: asOnDate,
      import_id: importId,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from("mf_holdings")
      .insert(insertPayload)
      .select();

    const status: "success" | "partial" | "failed" = insertError
      ? "failed"
      : inserted && inserted.length === validRows.length
        ? "success"
        : "partial";

    if (importId) {
      await supabase
        .from("mf_cas_imports")
        .update({ status, rows_imported: inserted?.length ?? 0 })
        .eq("id", importId);
    }

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Best-effort — don't fail the request if mfapi.in is unreachable.
    await Promise.all(
      validRows
        .filter((r) => r.scheme_code)
        .map((r) => refreshNavCache(r.scheme_code as string))
    );

    return NextResponse.json({ imported: inserted?.length ?? 0 }, { status: 201 });
  } catch (err) {
    console.error("POST /api/mf/import/cas failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
