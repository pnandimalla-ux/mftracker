import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Must run per-request, not be cached at build time — it reports live
// env-var presence, DB connectivity, and a real timestamp.
export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const supabase_url = Boolean(supabaseUrl);
  const supabase_anon_key = Boolean(supabaseAnonKey);
  const supabase_service_key = Boolean(supabaseServiceKey);
  const anthropic_key = Boolean(process.env.ANTHROPIC_API_KEY);

  let db_connection: string;

  if (!supabaseUrl || !supabaseServiceKey) {
    db_connection = "skipped: missing supabase env vars";
  } else {
    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error } = await supabase
        .from("mf_sip_schedules")
        .select("*", { count: "exact", head: true });

      db_connection = error ? `error: ${error.message}` : "ok";
    } catch (err) {
      db_connection = `error: ${err instanceof Error ? err.message : "unknown"}`;
    }
  }

  return NextResponse.json({
    supabase_url,
    supabase_anon_key,
    supabase_service_key,
    anthropic_key,
    db_connection,
    timestamp: new Date().toISOString(),
  });
}
