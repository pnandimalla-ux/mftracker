import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { fetchFundReturns } from "@/lib/fetchFundReturns";
import { CURATED_FUNDS } from "@/lib/curatedFunds";
import type { Owner } from "@/types/mf";

export const maxDuration = 60;

// Matches the model already verified live and working elsewhere in this
// project (src/app/api/mf/recommendations/route.ts) — gemini-2.0-flash and
// gemini-1.5-flash (the task's suggested options) are both retired; see
// that file's comments for how this was confirmed against the live API.
const GEMINI_MODEL = "gemini-3.6-flash";

const REPO_RATE_PCT = 6.25; // RBI repo rate, mid-2026

type OwnerFilter = Owner | "family";
type Horizon = "3m" | "6m" | "1yr";
type RiskLevel = "Low" | "Medium" | "High";
type Mode = "ai" | "curated";
const HORIZONS: Horizon[] = ["3m", "6m", "1yr"];

interface NiftyMarketData {
  current_price: number;
  week52_high: number;
  week52_low: number;
  range_position_pct: number;
}

interface CategoryAllocation {
  category: string;
  pct: number;
}

interface FundWithReturns {
  name: string;
  schemeCode: string;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
}

interface LumpsumRecommendation {
  asset_class: string;
  category: string;
  rationale: string;
  risk_level: RiskLevel;
  suggested_allocation_pct: number;
  // Raw from Gemini in mode=ai only — consumed by enrichWithAiFunds, not
  // sent to the client (replaced by `funds` after enrichment).
  suggested_funds?: string[];
  funds?: FundWithReturns[];
}

interface LumpsumResponse {
  market_context: string;
  recommendations: Record<Horizon, LumpsumRecommendation[]>;
}

function rangeZoneLabel(pct: number): string {
  if (pct >= 75) return "expensive zone";
  if (pct >= 50) return "moderate zone";
  if (pct >= 25) return "attractive zone";
  return "deep value zone";
}

// 5s timeout, and any failure (network, malformed response, missing fields)
// just returns null — the caller continues with market data unavailable
// rather than failing the whole request over an external, unauthenticated API.
async function fetchNiftyMarketData(): Promise<NiftyMarketData | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=1y",
      { signal: controller.signal, cache: "no-store" }
    );
    if (!res.ok) throw new Error(`Yahoo Finance responded ${res.status}`);
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const current_price = Number(meta?.regularMarketPrice);
    const week52_high = Number(meta?.fiftyTwoWeekHigh);
    const week52_low = Number(meta?.fiftyTwoWeekLow);
    if (
      !Number.isFinite(current_price) ||
      !Number.isFinite(week52_high) ||
      !Number.isFinite(week52_low) ||
      week52_high <= week52_low
    ) {
      throw new Error("Incomplete market data in Yahoo Finance response");
    }
    const range_position_pct = ((current_price - week52_low) / (week52_high - week52_low)) * 100;
    return {
      current_price,
      week52_high,
      week52_low,
      range_position_pct: Math.round(range_position_pct * 10) / 10,
    };
  } catch (err) {
    console.error("Failed to fetch Nifty market data — continuing without it:", err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchCategoryAllocations(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  owners: Owner[]
): Promise<CategoryAllocation[]> {
  const { data, error } = await supabase
    .from("mf_holdings")
    .select("category, invested_amount")
    .eq("user_id", userId)
    .in("owner", owners);

  if (error) throw new Error(error.message);

  const totals = new Map<string, number>();
  let overall = 0;
  for (const r of data ?? []) {
    const amt = Number(r.invested_amount);
    totals.set(r.category, (totals.get(r.category) ?? 0) + amt);
    overall += amt;
  }
  if (overall === 0) return [];

  return Array.from(totals.entries())
    .map(([category, amt]) => ({ category, pct: Math.round((amt / overall) * 1000) / 10 }))
    .sort((a, b) => b.pct - a.pct);
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

async function callGeminiForLumpsum(
  marketData: NiftyMarketData | null,
  categoryAllocations: CategoryAllocation[],
  mode: Mode
): Promise<LumpsumResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const genAI = new GoogleGenAI({ apiKey });

  const marketSummary = marketData
    ? `Nifty 50 is currently at ${marketData.current_price.toFixed(2)}, trading at ${marketData.range_position_pct}% of its 52-week range (52w high: ${marketData.week52_high.toFixed(2)}, 52w low: ${marketData.week52_low.toFixed(2)}) — ${rangeZoneLabel(marketData.range_position_pct)}.`
    : "Market data unavailable — base recommendations on general market conditions.";

  const allocationSummary =
    categoryAllocations.length > 0
      ? categoryAllocations.map((c) => `${c.category}: ${c.pct}%`).join(", ")
      : "no existing holdings";

  // mode=curated does a direct dictionary lookup (CURATED_FUNDS[category])
  // after Gemini responds, so `category` must be constrained to exactly
  // these keys — a freeform category string would silently match nothing.
  const categoryConstraint =
    mode === "curated"
      ? `\n\nThe "category" field in each recommendation MUST be exactly one of these values (no others): ${Object.keys(CURATED_FUNDS)
          .map((c) => `"${c}"`)
          .join(", ")}.`
      : "";

  const suggestedFundsInstruction =
    mode === "ai"
      ? `\n\nFor each recommendation, also suggest 2-3 specific well-known Indian mutual fund names within that category. Use full fund names as commonly known (e.g. "Parag Parikh Flexi Cap Fund - Direct Plan"). Return them in a "suggested_funds": string[] field on that recommendation.`
      : "";

  const systemPrompt = `You are a mutual fund and lumpsum investment advisor for an Indian retail investor. Given current market conditions and the investor's existing portfolio allocation, recommend where to deploy a fresh lumpsum investment across three horizons: 3 months, 6 months, and 1 year.

Context:
- ${marketSummary}
- RBI repo rate: ${REPO_RATE_PCT}%
- Investor's existing category allocation (% of invested amount): ${allocationSummary}

For each horizon, give 2-3 recommendations that account for what's already held (avoid recommending further concentration into an already-dominant category unless clearly justified) and reflect the interest-rate and market-valuation context above.${categoryConstraint}${suggestedFundsInstruction}

Return ONLY valid JSON, no prose, no markdown code fences, in this exact shape:
{
  "market_context": string (1-2 sentence summary of current conditions and what it means for lumpsum timing),
  "recommendations": {
    "3m": [{ "asset_class": string, "category": string, "rationale": string, "risk_level": "Low" | "Medium" | "High", "suggested_allocation_pct": number${mode === "ai" ? ', "suggested_funds": string[]' : ""} }, ...],
    "6m": [...],
    "1yr": [...]
  }
}`;

  let responseText: string;
  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: "Generate the lumpsum recommendations now.",
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    });
    responseText = response.text ?? "";
    console.log(`Gemini lumpsum call succeeded — response length: ${responseText.length} chars`);
  } catch (err) {
    console.error("Gemini lumpsum call failed:", err);
    throw new Error(`Gemini API error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!responseText.trim()) {
    throw new Error("Gemini returned no text content");
  }

  const cleaned = stripCodeFences(responseText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
    console.log("Parsed Gemini lumpsum response successfully");
  } catch (err) {
    console.error("Failed to parse Gemini lumpsum response as JSON. Raw response was:", cleaned);
    throw new Error(
      `Failed to parse Gemini response as JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const obj = parsed as Partial<LumpsumResponse> | null;
  if (!obj || typeof obj.market_context !== "string" || typeof obj.recommendations !== "object" || !obj.recommendations) {
    throw new Error("Gemini response did not match the expected shape");
  }
  const recommendations = {} as Record<Horizon, LumpsumRecommendation[]>;
  for (const h of HORIZONS) {
    const list = (obj.recommendations as Record<string, unknown>)[h];
    recommendations[h] = Array.isArray(list) ? (list as LumpsumRecommendation[]) : [];
  }

  return { market_context: obj.market_context, recommendations };
}

async function toFundWithReturns(name: string, schemeCode: string): Promise<FundWithReturns> {
  const returns = await fetchFundReturns(schemeCode);
  return {
    name,
    schemeCode,
    r1y: returns?.r1y ?? null,
    r3y: returns?.r3y ?? null,
    r5y: returns?.r5y ?? null,
  };
}

// mode=curated: look up the recommendation's category directly in
// CURATED_FUNDS (Gemini was constrained to only use these exact category
// strings) and take the top 3.
async function enrichCurated(rec: LumpsumRecommendation): Promise<LumpsumRecommendation> {
  const candidates = (CURATED_FUNDS[rec.category] ?? []).slice(0, 3);
  const funds = await Promise.all(candidates.map((f) => toFundWithReturns(f.name, f.schemeCode)));
  return {
    asset_class: rec.asset_class,
    category: rec.category,
    rationale: rec.rationale,
    risk_level: rec.risk_level,
    suggested_allocation_pct: rec.suggested_allocation_pct,
    funds,
  };
}

// A stricter search than @/lib/mfapi's searchDirectGrowthScheme, which falls
// back to the search's first raw result when no clean Direct+Growth match
// exists — fine for its original use (a human reviews the import preview
// before saving), but wrong here: it can confidently return a stale,
// dividend-only, since-renamed plan under a plausible-looking name (verified
// live: "Kotak Equity Arbitrage Fund" resolved to a discontinued dividend
// plan from 2007). This route shows the result directly as fact, so a
// non-match must come back as "not found," never a guess.
async function findCleanDirectGrowthMatch(
  name: string
): Promise<{ scheme_code: string; scheme_name: string } | null> {
  try {
    const res = await fetchWithTimeout(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const results = await res.json();
    if (!Array.isArray(results)) return null;

    const match = results.find(
      (r: { schemeName?: string }) =>
        typeof r.schemeName === "string" &&
        /direct/i.test(r.schemeName) &&
        /growth/i.test(r.schemeName) &&
        !/idcw|dividend|bonus/i.test(r.schemeName)
    );
    if (!match || typeof match.schemeCode === "undefined") return null;
    return { scheme_code: String(match.schemeCode), scheme_name: String(match.schemeName) };
  } catch (err) {
    console.error(`findCleanDirectGrowthMatch("${name}") failed:`, err);
    return null;
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

// mode=ai: Gemini suggested 2-3 fund names freeform — resolve each to a real
// scheme via mfapi.in search. A fund that can't be found or whose returns
// fetch fails still shows up with null returns rather than being dropped.
async function enrichAi(rec: LumpsumRecommendation): Promise<LumpsumRecommendation> {
  const names = Array.isArray(rec.suggested_funds) ? rec.suggested_funds.slice(0, 3) : [];
  const funds = await Promise.all(
    names.map(async (name): Promise<FundWithReturns> => {
      const match = await findCleanDirectGrowthMatch(name);
      if (!match) {
        return { name, schemeCode: "", r1y: null, r3y: null, r5y: null };
      }
      return toFundWithReturns(match.scheme_name || name, match.scheme_code);
    })
  );
  return {
    asset_class: rec.asset_class,
    category: rec.category,
    rationale: rec.rationale,
    risk_level: rec.risk_level,
    suggested_allocation_pct: rec.suggested_allocation_pct,
    funds,
  };
}

// Every fund lookup across every horizon runs in one flat Promise.all —
// never sequential — so a large recommendation set still completes well
// within maxDuration.
async function enrichRecommendations(
  recommendations: Record<Horizon, LumpsumRecommendation[]>,
  mode: Mode
): Promise<Record<Horizon, LumpsumRecommendation[]>> {
  const enrichFn = mode === "curated" ? enrichCurated : enrichAi;
  const flat = HORIZONS.flatMap((h) => recommendations[h]);
  const enrichedFlat = await Promise.all(flat.map(enrichFn));

  const result = {} as Record<Horizon, LumpsumRecommendation[]>;
  let idx = 0;
  for (const h of HORIZONS) {
    const count = recommendations[h].length;
    result[h] = enrichedFlat.slice(idx, idx + count);
    idx += count;
  }
  return result;
}

export async function GET(request: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("GET /api/mf/lumpsum-recommendations: no authenticated user");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.log(`GET /api/mf/lumpsum-recommendations: authenticated as user ${user.id}`);

    const { searchParams } = new URL(request.url);
    const ownerParam = searchParams.get("owner") as OwnerFilter | null;
    if (ownerParam !== "praveen" && ownerParam !== "geetha" && ownerParam !== "family") {
      return NextResponse.json(
        { error: "owner must be 'praveen', 'geetha', or 'family'" },
        { status: 400 }
      );
    }
    // "family" merges holdings from both owners into one blended allocation.
    const owners: Owner[] = ownerParam === "family" ? ["praveen", "geetha"] : [ownerParam];

    const modeParam = searchParams.get("mode");
    const mode: Mode = modeParam === "curated" ? "curated" : "ai";

    const [marketData, categoryAllocations] = await Promise.all([
      fetchNiftyMarketData(),
      fetchCategoryAllocations(supabase, user.id, owners),
    ]);
    console.log(
      `Data fetch complete — mode: ${mode}, market data: ${marketData ? "ok" : "unavailable"}, ${categoryAllocations.length} categor(y/ies) held`
    );

    const result = await callGeminiForLumpsum(marketData, categoryAllocations, mode);
    result.recommendations = await enrichRecommendations(result.recommendations, mode);
    console.log(`Fund enrichment complete for mode=${mode}`);

    return NextResponse.json({
      ...result,
      // Deterministic numbers for the UI banner — Gemini's own market_context
      // is a freeform narrative and shouldn't be trusted to reproduce exact
      // figures consistently.
      market_data: marketData
        ? {
            current_price: marketData.current_price,
            week52_high: marketData.week52_high,
            week52_low: marketData.week52_low,
            range_position_pct: marketData.range_position_pct,
            zone_label: rangeZoneLabel(marketData.range_position_pct),
            repo_rate_pct: REPO_RATE_PCT,
          }
        : null,
    });
  } catch (err) {
    console.error("GET /api/mf/lumpsum-recommendations failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}
