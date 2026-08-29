import { createServiceClient } from "@/lib/supabase/service";
import {
  calculateReturns,
  ensurePeerDataSchema,
  fetchSchemeHistory,
  recalculateCategoryRanks,
} from "./peerSync";
import { sliceToFiveYears } from "./tier1Sync";

export interface Tier3Result {
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
  peer_rank_1y: number | null;
  peer_count: number | null;
}

// Tier 3 — on-demand. Runs right after a fund is added so its peer rank
// shows up immediately instead of waiting for the next weekly/monthly sync.
// Called fire-and-forget from POST /api/mf/holdings — throws on failure so
// the caller's .catch(console.error) logs it without blocking the response.
export async function syncNewFund(schemeCode: string, category: string): Promise<Tier3Result> {
  console.log("Tier3 on-demand sync for scheme:", schemeCode, "category:", category);
  await ensurePeerDataSchema();

  const supabase = createServiceClient();

  const { history, schemeName } = await fetchSchemeHistory(schemeCode);
  const sliced = sliceToFiveYears(history);
  const returns = calculateReturns(sliced);
  console.log("Tier3 calculated returns:", returns, "for scheme:", schemeCode);

  const { error } = await supabase.from("mf_peer_data").upsert(
    {
      scheme_code: schemeCode,
      category,
      r6m: returns.r6m,
      r1y: returns.r1y,
      r3y: returns.r3y,
      r5y: returns.r5y,
      tier: "tier3",
      fund_name: schemeName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "scheme_code" }
  );
  if (error) throw new Error(`Failed to upsert mf_peer_data for ${schemeCode}: ${error.message}`);

  const { errors } = await recalculateCategoryRanks(category);
  if (errors.length > 0) {
    console.error("Tier3 rank recalculation errors:", errors);
  }

  const { data: selfRow } = await supabase
    .from("mf_peer_data")
    .select("r6m, r1y, r3y, r5y, peer_rank_1y, peer_count")
    .eq("scheme_code", schemeCode)
    .maybeSingle();

  return {
    r6m: selfRow?.r6m ?? returns.r6m,
    r1y: selfRow?.r1y ?? returns.r1y,
    r3y: selfRow?.r3y ?? returns.r3y,
    r5y: selfRow?.r5y ?? returns.r5y,
    peer_rank_1y: selfRow?.peer_rank_1y ?? null,
    peer_count: selfRow?.peer_count ?? null,
  };
}
