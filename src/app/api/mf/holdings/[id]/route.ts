import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PUT(
  request: Request,
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

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { owner, units, avg_nav, invested_amount, as_on_date } =
      body as Record<string, unknown>;

    const update: Record<string, unknown> = {};

    if (owner !== undefined) {
      if (owner !== "praveen" && owner !== "geetha") {
        return NextResponse.json(
          { error: "owner must be 'praveen' or 'geetha'" },
          { status: 400 }
        );
      }
      update.owner = owner;
    }
    if (units !== undefined) {
      if (typeof units !== "number" || !Number.isFinite(units) || units <= 0) {
        return NextResponse.json(
          { error: "units must be a positive number" },
          { status: 400 }
        );
      }
      update.units = units;
    }
    if (avg_nav !== undefined) {
      if (
        typeof avg_nav !== "number" ||
        !Number.isFinite(avg_nav) ||
        avg_nav <= 0
      ) {
        return NextResponse.json(
          { error: "avg_nav must be a positive number" },
          { status: 400 }
        );
      }
      update.avg_nav = avg_nav;
    }
    if (invested_amount !== undefined) {
      if (
        typeof invested_amount !== "number" ||
        !Number.isFinite(invested_amount) ||
        invested_amount <= 0
      ) {
        return NextResponse.json(
          { error: "invested_amount must be a positive number" },
          { status: 400 }
        );
      }
      update.invested_amount = invested_amount;
    }
    if (as_on_date !== undefined) {
      if (typeof as_on_date !== "string" || !as_on_date) {
        return NextResponse.json(
          { error: "as_on_date must be a valid date string" },
          { status: 400 }
        );
      }
      const parsedDate = new Date(as_on_date);
      if (Number.isNaN(parsedDate.getTime())) {
        return NextResponse.json(
          { error: "as_on_date must be a valid date" },
          { status: 400 }
        );
      }
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (parsedDate.getTime() > today.getTime()) {
        return NextResponse.json(
          { error: "as_on_date cannot be in the future" },
          { status: 400 }
        );
      }
      update.as_on_date = as_on_date;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("mf_holdings")
      .update(update)
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error(`PUT /api/mf/holdings/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

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

    const { error } = await supabase
      .from("mf_holdings")
      .delete()
      .eq("id", params.id)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`DELETE /api/mf/holdings/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
