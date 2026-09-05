import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isRealSchemeCode } from "@/lib/peers/peerSync";
import type { Owner } from "@/types/mf";

export const maxDuration = 60;

// The task that specified this route named "claude-opus-4-5" / "claude-sonnet-4-5"
// as the models to use — those are outdated identifiers. The current Claude
// model family is Claude 5 (opus-5 / sonnet-5); using the current Opus-tier
// model per that same "opus, else sonnet" intent.
const CLAUDE_MODEL = "claude-opus-5";

type OwnerFilter = Owner | "family";

const VALID_ACTIONS = ["HOLD", "SWITCH", "REBALANCE", "EXIT"] as const;
type Action = (typeof VALID_ACTIONS)[number];

interface TopPeer {
  scheme_code: string;
  fund_name: string;
  peer_rank_1y: number | null;
  r1y: number | null;
}

// Internal, per-fund working data — a superset of what's sent to Claude
// (earliest_date is kept back for the deterministic LTCG-date calculation
// done after Claude responds, rather than trusting the model's date math).
interface FundSummary {
  scheme_code: string;
  scheme_name: string;
  owner: Owner;
  category: string;
  invested: number;
  current_value: number;
  pnl_pct: number;
  holding_days: number;
  earliest_date: string;
  peer_rank_1y: number | null;
  peer_rank_3y: number | null;
  peer_rank_5y: number | null;
  peer_count: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
  category_avg_r1y: number | null;
  category_avg_r3y: number | null;
  top_peers_in_category: TopPeer[];
}

interface ClaudeRecommendation {
  scheme_code: string;
  owner: string;
  action: string;
  reason: string;
  suggested_fund: string | null;
  suggested_fund_code: string | null;
  ltcg_note: string | null;
}

interface StoredRecommendation {
  user_id: string;
  owner: Owner;
  scheme_code: string;
  action: Action;
  reason: string;
  suggested_fund: string | null;
  ltcg_note: string | null;
}

// scheme_name/category aren't columns on mf_ai_recommendations — they're
// looked up from mf_holdings and attached only to API responses (POST here,
// GET's own separate lookup) so the UI can render a fund name without a
// second round-trip. Never included in the insert payload.
interface RecommendationView extends StoredRecommendation {
  scheme_name: string;
  category: string;
}

function hasRealSchemeCode(code: string | null | undefined): code is string {
  return !!code && isRealSchemeCode(code);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((to - from) / (24 * 60 * 60 * 1000)));
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDMY(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

// Deterministic LTCG note — computed here rather than trusted from Claude's
// output, since exact date arithmetic ("365 days from purchase") is a poor
// fit for an LLM to get right consistently.
function computeLtcgNote(action: Action, holdingDays: number, earliestDate: string): string | null {
  if (action !== "SWITCH" && action !== "EXIT") return null;
  if (holdingDays >= 365) return null;
  const eligibleDate = addDaysIso(earliestDate, 365);
  return `⚠️ Currently under 1 year — switch after ${formatDMY(eligibleDate)} to qualify for LTCG rate (10%) instead of STCG (taxed as income).`;
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function buildFundSummaries(
  serviceClient: ServiceClient,
  userId: string,
  owner: Owner
): Promise<{ funds: FundSummary[]; categoryTotals: Record<string, number>; overallTotal: number }> {
  const { data: holdingRows, error: holdingsError } = await serviceClient
    .from("mf_holdings")
    .select("scheme_code, scheme_name, category, owner, units, invested_amount, as_on_date")
    .eq("user_id", userId)
    .eq("owner", owner);

  if (holdingsError) throw new Error(holdingsError.message);
  const rows = holdingRows ?? [];
  if (rows.length === 0) return { funds: [], categoryTotals: {}, overallTotal: 0 };

  // Grouped by scheme_code (or by lowercased name for manual-* placeholder
  // codes, which are unique per lot) — mirrors the dashboard's groupKeyFor
  // so a fund's many SIP lots collapse into one entry instead of fragmenting.
  interface Group {
    scheme_code: string;
    scheme_name: string;
    category: string;
    owner: Owner;
    invested: number;
    units: number;
    earliest_date: string;
  }
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = hasRealSchemeCode(r.scheme_code)
      ? `code:${r.scheme_code}`
      : `name:${String(r.scheme_name).trim().toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        scheme_code: r.scheme_code,
        scheme_name: r.scheme_name,
        category: r.category,
        owner: r.owner,
        invested: 0,
        units: 0,
        earliest_date: r.as_on_date,
      };
      groups.set(key, g);
    }
    g.invested += Number(r.invested_amount);
    g.units += Number(r.units);
    if (r.as_on_date < g.earliest_date) g.earliest_date = r.as_on_date;
  }

  const groupList = Array.from(groups.values());
  const schemeCodes = Array.from(new Set(groupList.map((g) => g.scheme_code).filter(hasRealSchemeCode)));
  const categories = Array.from(new Set(groupList.map((g) => g.category)));

  const [navResult, peerResult, categoryStatsResult] = await Promise.all([
    schemeCodes.length > 0
      ? serviceClient.from("mf_nav_cache").select("scheme_code, nav").in("scheme_code", schemeCodes)
      : Promise.resolve({ data: [] as { scheme_code: string; nav: number | null }[] }),
    schemeCodes.length > 0
      ? serviceClient
          .from("mf_peer_data")
          .select("scheme_code, r1y, r3y, r5y, peer_rank_1y, peer_rank_3y, peer_rank_5y, peer_count")
          .in("scheme_code", schemeCodes)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    categories.length > 0
      ? serviceClient.from("mf_category_stats").select("category, avg_r1y, avg_r3y").in("category", categories)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const navMap = new Map((navResult.data ?? []).map((n) => [n.scheme_code, Number(n.nav ?? 0)]));
  const peerMap = new Map((peerResult.data ?? []).map((p) => [p.scheme_code as string, p]));
  const categoryStatsMap = new Map((categoryStatsResult.data ?? []).map((c) => [c.category as string, c]));

  // Top 3 peers per category by peer_rank_1y, excluding funds this owner
  // already holds — enforced here (not left to the model) so a SWITCH
  // suggestion can never point at a fund already in the portfolio.
  const heldCodes = new Set(groupList.map((g) => g.scheme_code));
  const topPeersByCategory = new Map<string, TopPeer[]>();
  if (categories.length > 0) {
    const { data: categoryPeerRows } = await serviceClient
      .from("mf_peer_data")
      .select("scheme_code, category, fund_name, peer_rank_1y, r1y")
      .in("category", categories)
      .not("peer_rank_1y", "is", null)
      .order("peer_rank_1y", { ascending: true });

    for (const row of categoryPeerRows ?? []) {
      if (heldCodes.has(row.scheme_code)) continue;
      const list = topPeersByCategory.get(row.category) ?? [];
      if (list.length < 3) {
        list.push({
          scheme_code: row.scheme_code,
          fund_name: row.fund_name ?? row.scheme_code,
          peer_rank_1y: row.peer_rank_1y,
          r1y: row.r1y,
        });
        topPeersByCategory.set(row.category, list);
      }
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const categoryTotals: Record<string, number> = {};
  let overallTotal = 0;

  const funds: FundSummary[] = groupList.map((g) => {
    const nav = navMap.get(g.scheme_code) ?? 0;
    const current_value = nav > 0 ? g.units * nav : g.invested;
    const pnl_pct = g.invested > 0 ? ((current_value - g.invested) / g.invested) * 100 : 0;
    const peer = peerMap.get(g.scheme_code) as
      | {
          r1y: number | null;
          r3y: number | null;
          r5y: number | null;
          peer_rank_1y: number | null;
          peer_rank_3y: number | null;
          peer_rank_5y: number | null;
          peer_count: number | null;
        }
      | undefined;
    const catStats = categoryStatsMap.get(g.category) as
      | { avg_r1y: number | null; avg_r3y: number | null }
      | undefined;

    categoryTotals[g.category] = (categoryTotals[g.category] ?? 0) + g.invested;
    overallTotal += g.invested;

    return {
      scheme_code: g.scheme_code,
      scheme_name: g.scheme_name,
      owner: g.owner,
      category: g.category,
      invested: g.invested,
      current_value,
      pnl_pct,
      holding_days: daysBetween(g.earliest_date, today),
      earliest_date: g.earliest_date,
      peer_rank_1y: peer?.peer_rank_1y ?? null,
      peer_rank_3y: peer?.peer_rank_3y ?? null,
      peer_rank_5y: peer?.peer_rank_5y ?? null,
      peer_count: peer?.peer_count ?? null,
      r1y: peer?.r1y ?? null,
      r3y: peer?.r3y ?? null,
      r5y: peer?.r5y ?? null,
      category_avg_r1y: catStats?.avg_r1y ?? null,
      category_avg_r3y: catStats?.avg_r3y ?? null,
      top_peers_in_category: topPeersByCategory.get(g.category) ?? [],
    };
  });

  return { funds, categoryTotals, overallTotal };
}

const SYSTEM_PROMPT = `You are a mutual fund advisor for an Indian retail investor. Analyze the portfolio data and return a JSON array of recommendations. Apply Indian tax rules: holding < 365 days = STCG (taxed as income), holding >= 365 days = LTCG (10% above ₹1L exemption per year). Be conservative — do not recommend EXIT or SWITCH unless there is clear multi-period underperformance.

Rules:
- HOLD: peer rank in the top half (rank <= peer_count / 2) for 1Y, OR holding_days < 180.
- SWITCH: peer rank in the bottom half for BOTH 1Y and 3Y, AND category_avg_r1y is more than 3 percentage points higher than this fund's r1y. suggested_fund and suggested_fund_code must be chosen from that fund's own top_peers_in_category list (it already excludes funds this owner holds) — pick the top-ranked one there.
- REBALANCE: this fund's category makes up more than 35% of the owner's overall_total_invested (see portfolio_total_by_category). Name the exact percentage in the reason and suggest trimming to 25%.
- EXIT: peer rank in the last quartile (rank > peer_count * 0.75) for 1Y AND 3Y AND 5Y, AND pnl_pct < 5%. Only recommend EXIT if holding_days >= 365.
- If peer_rank_1y, peer_rank_3y, r1y, or peer_count is null, default to HOLD with reason "Insufficient peer data to evaluate."
- ltcg_note: leave null unless the rules above call for one — the caller fills it in deterministically afterward.

Return ONLY a valid JSON array, no prose, no markdown code fences, in this exact shape:
[{
  "scheme_code": string,
  "owner": string,
  "action": "HOLD" | "SWITCH" | "REBALANCE" | "EXIT",
  "reason": string (2-3 sentences, specific — mention actual numbers),
  "suggested_fund": string | null,
  "suggested_fund_code": string | null,
  "ltcg_note": string | null
}]`;

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

async function callClaude(
  funds: FundSummary[],
  categoryTotals: Record<string, number>,
  overallTotal: number
): Promise<ClaudeRecommendation[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const anthropic = new Anthropic({ apiKey });

  // earliest_date is intentionally omitted from what Claude sees — it's only
  // used server-side for the deterministic LTCG date calculation.
  const claudeFunds = funds.map((f) => ({
    scheme_code: f.scheme_code,
    scheme_name: f.scheme_name,
    owner: f.owner,
    category: f.category,
    invested: f.invested,
    current_value: f.current_value,
    pnl_pct: f.pnl_pct,
    holding_days: f.holding_days,
    peer_rank_1y: f.peer_rank_1y,
    peer_rank_3y: f.peer_rank_3y,
    peer_rank_5y: f.peer_rank_5y,
    peer_count: f.peer_count,
    r1y: f.r1y,
    r3y: f.r3y,
    r5y: f.r5y,
    category_avg_r1y: f.category_avg_r1y,
    category_avg_r3y: f.category_avg_r3y,
    top_peers_in_category: f.top_peers_in_category,
  }));

  const userPrompt = JSON.stringify(
    {
      funds: claudeFunds,
      portfolio_total_by_category: categoryTotals,
      overall_total_invested: overallTotal,
    },
    null,
    2
  );

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  const cleaned = stripCodeFences(textBlock.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Failed to parse Claude response as JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Claude response was not a JSON array");
  }

  return parsed as ClaudeRecommendation[];
}

async function generateRecommendationsForOwner(
  serviceClient: ServiceClient,
  userId: string,
  owner: Owner
): Promise<RecommendationView[]> {
  const { funds, categoryTotals, overallTotal } = await buildFundSummaries(serviceClient, userId, owner);
  if (funds.length === 0) return [];

  const claudeRecs = await callClaude(funds, categoryTotals, overallTotal);
  const fundByCode = new Map(funds.map((f) => [f.scheme_code, f]));

  const results: RecommendationView[] = [];
  for (const rec of claudeRecs) {
    const fund = fundByCode.get(rec.scheme_code);
    if (!fund) {
      console.warn(`Claude referenced unknown scheme_code "${rec.scheme_code}" for owner ${owner} — skipped`);
      continue;
    }
    if (!VALID_ACTIONS.includes(rec.action as Action)) {
      console.warn(`Claude returned invalid action "${rec.action}" for ${rec.scheme_code} — skipped`);
      continue;
    }
    const action = rec.action as Action;

    results.push({
      user_id: userId,
      owner,
      scheme_code: rec.scheme_code,
      scheme_name: fund.scheme_name,
      category: fund.category,
      action,
      reason: rec.reason,
      suggested_fund: action === "SWITCH" ? rec.suggested_fund ?? null : null,
      ltcg_note: computeLtcgNote(action, fund.holding_days, fund.earliest_date),
    });
  }

  return results;
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
    const ownerParam = (body as { owner?: unknown } | null)?.owner;
    if (ownerParam !== "praveen" && ownerParam !== "geetha" && ownerParam !== "family") {
      return NextResponse.json(
        { error: "owner must be 'praveen', 'geetha', or 'family'" },
        { status: 400 }
      );
    }

    const owners: Owner[] = ownerParam === "family" ? ["praveen", "geetha"] : [ownerParam];
    const serviceClient = createServiceClient();

    const allRecs: RecommendationView[] = [];
    for (const owner of owners) {
      const recs = await generateRecommendationsForOwner(serviceClient, user.id, owner);
      allRecs.push(...recs);
    }

    const { error: deleteError } = await serviceClient
      .from("mf_ai_recommendations")
      .delete()
      .eq("user_id", user.id)
      .in("owner", owners);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    if (allRecs.length > 0) {
      // Only the actual mf_ai_recommendations columns go into the insert —
      // scheme_name/category on RecommendationView exist for the response only.
      const insertPayload: StoredRecommendation[] = allRecs.map((r) => ({
        user_id: r.user_id,
        owner: r.owner,
        scheme_code: r.scheme_code,
        action: r.action,
        reason: r.reason,
        suggested_fund: r.suggested_fund,
        ltcg_note: r.ltcg_note,
      }));
      const { error: insertError } = await serviceClient.from("mf_ai_recommendations").insert(insertPayload);
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ recommendations: allRecs });
  } catch (err) {
    console.error("POST /api/mf/recommendations failed:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const ownerParam = searchParams.get("owner") as OwnerFilter | null;
    const owners: Owner[] =
      ownerParam === "praveen" || ownerParam === "geetha" ? [ownerParam] : ["praveen", "geetha"];

    const { data, error } = await supabase
      .from("mf_ai_recommendations")
      .select("*")
      .eq("user_id", user.id)
      .in("owner", owners)
      .order("generated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];
    const generated_at = rows.length > 0 ? rows[0].generated_at : null;

    // scheme_name/category aren't stored on mf_ai_recommendations — look
    // them up from mf_holdings (by owner + scheme_code) so the UI has a
    // fund name to render without a second client-side round trip.
    const schemeCodes = Array.from(new Set(rows.map((r) => r.scheme_code as string)));
    const nameMap = new Map<string, { scheme_name: string; category: string }>();
    if (schemeCodes.length > 0) {
      const { data: holdingRows } = await supabase
        .from("mf_holdings")
        .select("owner, scheme_code, scheme_name, category")
        .eq("user_id", user.id)
        .in("scheme_code", schemeCodes);
      for (const h of holdingRows ?? []) {
        const key = `${h.owner}:${h.scheme_code}`;
        if (!nameMap.has(key)) {
          nameMap.set(key, { scheme_name: h.scheme_name, category: h.category });
        }
      }
    }

    const enriched = rows.map((r) => {
      const info = nameMap.get(`${r.owner}:${r.scheme_code}`);
      return {
        ...r,
        scheme_name: info?.scheme_name ?? r.scheme_code,
        category: info?.category ?? "—",
      };
    });

    return NextResponse.json({ recommendations: enriched, generated_at });
  } catch (err) {
    console.error("GET /api/mf/recommendations failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
