import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
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

interface LumpsumRecommendation {
  asset_class: string;
  category: string;
  rationale: string;
  risk_level: RiskLevel;
  suggested_allocation_pct: number;
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
  categoryAllocations: CategoryAllocation[]
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

  const systemPrompt = `You are a mutual fund and lumpsum investment advisor for an Indian retail investor. Given current market conditions and the investor's existing portfolio allocation, recommend where to deploy a fresh lumpsum investment across three horizons: 3 months, 6 months, and 1 year.

Context:
- ${marketSummary}
- RBI repo rate: ${REPO_RATE_PCT}%
- Investor's existing category allocation (% of invested amount): ${allocationSummary}

For each horizon, give 2-3 recommendations that account for what's already held (avoid recommending further concentration into an already-dominant category unless clearly justified) and reflect the interest-rate and market-valuation context above.

Return ONLY valid JSON, no prose, no markdown code fences, in this exact shape:
{
  "market_context": string (1-2 sentence summary of current conditions and what it means for lumpsum timing),
  "recommendations": {
    "3m": [{ "asset_class": string, "category": string, "rationale": string, "risk_level": "Low" | "Medium" | "High", "suggested_allocation_pct": number }, ...],
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

    const [marketData, categoryAllocations] = await Promise.all([
      fetchNiftyMarketData(),
      fetchCategoryAllocations(supabase, user.id, owners),
    ]);
    console.log(
      `Data fetch complete — market data: ${marketData ? "ok" : "unavailable"}, ${categoryAllocations.length} categor(y/ies) held`
    );

    const result = await callGeminiForLumpsum(marketData, categoryAllocations);

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
