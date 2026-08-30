import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
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

    const { is_active, notify_email, notify_sms } = body as Record<string, unknown>;
    const update: Record<string, unknown> = {};

    if (is_active !== undefined) {
      if (typeof is_active !== "boolean") {
        return NextResponse.json({ error: "is_active must be a boolean" }, { status: 400 });
      }
      update.is_active = is_active;
    }
    if (notify_email !== undefined) {
      if (typeof notify_email !== "boolean") {
        return NextResponse.json({ error: "notify_email must be a boolean" }, { status: 400 });
      }
      update.notify_email = notify_email;
    }
    if (notify_sms !== undefined) {
      if (typeof notify_sms !== "boolean") {
        return NextResponse.json({ error: "notify_sms must be a boolean" }, { status: 400 });
      }
      update.notify_sms = notify_sms;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("mf_sip_schedules")
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
    console.error(`PATCH /api/mf/sip/${params.id} failed:`, err);
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
      .from("mf_sip_schedules")
      .delete()
      .eq("id", params.id)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`DELETE /api/mf/sip/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
