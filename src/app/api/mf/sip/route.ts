import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("mf_sip_schedules")
      .select("*")
      .eq("user_id", user.id)
      .order("sip_date", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error("GET /api/mf/sip failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
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

    const {
      owner,
      scheme_code,
      scheme_name,
      category,
      amount,
      sip_date,
      frequency,
      start_date,
      end_date,
    } = body as Record<string, unknown>;

    if (owner !== "praveen" && owner !== "geetha") {
      return NextResponse.json(
        { error: "owner must be 'praveen' or 'geetha'" },
        { status: 400 }
      );
    }
    if (typeof scheme_name !== "string" || !scheme_name.trim()) {
      return NextResponse.json(
        { error: "scheme_name is required" },
        { status: 400 }
      );
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "amount must be a positive number" },
        { status: 400 }
      );
    }
    if (
      typeof sip_date !== "number" ||
      !Number.isInteger(sip_date) ||
      sip_date < 1 ||
      sip_date > 31
    ) {
      return NextResponse.json(
        { error: "sip_date must be an integer between 1 and 31" },
        { status: 400 }
      );
    }
    if (
      frequency !== "weekly" &&
      frequency !== "bi-weekly" &&
      frequency !== "monthly" &&
      frequency !== "quarterly"
    ) {
      return NextResponse.json(
        { error: "frequency must be 'weekly', 'bi-weekly', 'monthly', or 'quarterly'" },
        { status: 400 }
      );
    }
    if (typeof start_date !== "string" || !start_date) {
      return NextResponse.json(
        { error: "start_date is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("mf_sip_schedules")
      .insert({
        user_id: user.id,
        owner,
        scheme_code: typeof scheme_code === "string" ? scheme_code : null,
        scheme_name: scheme_name.trim(),
        category: typeof category === "string" ? category : null,
        amount,
        sip_date,
        frequency,
        start_date,
        end_date: typeof end_date === "string" ? end_date : null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error("POST /api/mf/sip failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
