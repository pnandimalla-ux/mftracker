import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

// The Supabase JS client talks to PostgREST, which has no "run arbitrary SQL"
// endpoint. To apply schema.sql from a script (rather than pasting it into the
// Supabase SQL Editor by hand), we call a tiny `exec_sql` Postgres function via
// `.rpc()`. That function has to exist first — create it once by running
// EXEC_SQL_BOOTSTRAP in the Supabase SQL Editor, then this script can apply
// (and re-apply) schema.sql going forward.
export const EXEC_SQL_BOOTSTRAP = `
create or replace function exec_sql(sql text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  execute sql;
end;
$$;
`.trim();

export async function runMigrations() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local before running migrations."
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const schemaPath = path.join(process.cwd(), "src/lib/supabase/schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");

  const { error } = await supabase.rpc("exec_sql", { sql });

  if (error) {
    if (error.code === "42883" || error.message.includes("exec_sql")) {
      throw new Error(
        "The `exec_sql` helper function doesn't exist in this Supabase project yet.\n" +
          "Run this once in the Supabase SQL Editor, then re-run the migration:\n\n" +
          EXEC_SQL_BOOTSTRAP
      );
    }
    throw new Error(`Migration failed: ${error.message}`);
  }

  return { success: true as const };
}
