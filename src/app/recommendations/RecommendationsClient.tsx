"use client";

import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import type { Owner } from "@/types/mf";

type OwnerFilter = "family" | Owner;
type Horizon = "3m" | "6m" | "1yr";
type RiskLevel = "Low" | "Medium" | "High";

const OWNERS: { id: OwnerFilter; label: string }[] = [
  { id: "family", label: "Family" },
  { id: "praveen", label: "Praveen" },
  { id: "geetha", label: "Geetha" },
];

const HORIZON_LABELS: Record<Horizon, string> = {
  "3m": "3 Months",
  "6m": "6 Months",
  "1yr": "1 Year",
};

const RISK_STYLES: Record<RiskLevel, string> = {
  Low: "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  High: "bg-red-100 text-red-700",
};

interface LumpsumRecommendation {
  asset_class: string;
  category: string;
  rationale: string;
  risk_level: RiskLevel;
  suggested_allocation_pct: number;
}

interface MarketData {
  current_price: number;
  week52_high: number;
  week52_low: number;
  range_position_pct: number;
  zone_label: string;
  repo_rate_pct: number;
}

interface LumpsumResult {
  market_context: string;
  market_data: MarketData | null;
  recommendations: Record<Horizon, LumpsumRecommendation[]>;
}

function formatIndexLevel(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export default function RecommendationsClient({ userEmail }: { userEmail: string }) {
  const [owner, setOwner] = useState<OwnerFilter>("family");
  const [result, setResult] = useState<LumpsumResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGetRecommendations = async () => {
    setLoading(true);
    setError(null);

    // Nifty fetch + Gemini call can both take a while — mirrors the timeout
    // pattern used on the Insights page's "Generate Recommendations" call.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      const res = await fetch(`/api/mf/lumpsum-recommendations?owner=${owner}`, {
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("Lumpsum recommendations failed:", json.error, json.stack);
        throw new Error(json.error ?? "Failed to fetch recommendations");
      }
      setResult(json as LumpsumResult);
    } catch (err) {
      console.error("Failed to fetch lumpsum recommendations:", err);
      const message =
        err instanceof DOMException && err.name === "AbortError"
          ? "Request timed out after 90 seconds. Please try again."
          : err instanceof Error
            ? err.message
            : "Failed to fetch recommendations. Please try again.";
      setError(message);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const handleOwnerChange = (next: OwnerFilter) => {
    setOwner(next);
    setResult(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={userEmail} />

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Lumpsum Recommendations</h1>
            <p className="mt-1 text-sm text-slate-500">
              AI-generated, market-aware suggestions for deploying a fresh lumpsum investment.
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
            {OWNERS.map((o) => (
              <button
                key={o.id}
                onClick={() => handleOwnerChange(o.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  owner === o.id ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={handleGetRecommendations}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              {loading ? "Fetching…" : "Get Recommendations"}
            </button>
            {loading && (
              <p className="text-xs text-slate-400">
                Fetching market data &amp; generating recommendations...
              </p>
            )}
          </div>

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
        </div>

        {result && (
          <>
            <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm font-medium text-blue-900">
                {result.market_data
                  ? `Nifty at ${formatIndexLevel(result.market_data.current_price)} — trading in ${result.market_data.zone_label} (${result.market_data.range_position_pct}% of 52w range). Repo rate: ${result.market_data.repo_rate_pct}%.`
                  : "Market data unavailable — recommendations are based on general market conditions."}
              </p>
              <p className="mt-1 text-xs text-blue-700">{result.market_context}</p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              {(["3m", "6m", "1yr"] as Horizon[]).map((horizon) => (
                <div key={horizon} className="rounded-xl border border-slate-200 bg-white p-4">
                  <h2 className="mb-3 text-sm font-semibold text-slate-800">{HORIZON_LABELS[horizon]}</h2>
                  <div className="space-y-3">
                    {(result.recommendations[horizon] ?? []).length === 0 ? (
                      <p className="text-xs text-slate-400">No recommendations for this horizon.</p>
                    ) : (
                      result.recommendations[horizon].map((rec, i) => (
                        <div key={i} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-800">
                              {rec.asset_class} <span className="font-normal text-slate-500">· {rec.category}</span>
                            </p>
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${RISK_STYLES[rec.risk_level]}`}
                            >
                              {rec.risk_level}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-slate-600">{rec.rationale}</p>
                          <span className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                            Suggested: {rec.suggested_allocation_pct}%
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!result && !loading && !error && (
          <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="text-sm font-medium text-slate-700">
              Click &quot;Get Recommendations&quot; to see market-aware lumpsum suggestions.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
