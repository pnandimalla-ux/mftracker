import type { User } from "@supabase/supabase-js";
import { createClient } from "./server";

// Next.js signals "this route needs dynamic rendering" by throwing a special
// error (digest === "DYNAMIC_SERVER_USAGE") from cookies() during its static
// render trial pass. That's not a real failure — it must propagate up so
// Next can correctly mark the route dynamic, not be swallowed as an auth error.
function isDynamicServerUsageError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    (err as { digest?: unknown }).digest === "DYNAMIC_SERVER_USAGE"
  );
}

export async function getAuthedUser(): Promise<{
  supabase: ReturnType<typeof createClient> | null;
  user: User | null;
  failed: boolean;
}> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    return { supabase, user: data.user, failed: false };
  } catch (err) {
    if (isDynamicServerUsageError(err)) throw err;
    console.error("Supabase auth check failed:", err);
    return { supabase: null, user: null, failed: true };
  }
}
