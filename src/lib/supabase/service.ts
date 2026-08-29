import { createServiceRoleClient } from "./serviceRoleClient";

// Alias for createServiceRoleClient — kept as its own module/name so code can
// `import { createServiceClient } from "@/lib/supabase/service"`. The actual
// client construction (env var checks, auth options) lives in
// serviceRoleClient.ts; this just re-exports it under the expected name to
// avoid two divergent implementations of the same thing.
export function createServiceClient() {
  return createServiceRoleClient();
}
