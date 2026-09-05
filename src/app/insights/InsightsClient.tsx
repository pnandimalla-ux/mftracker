"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import type { AIAction, Owner } from "@/types/mf";

type OwnerFilter = "family" | Owner;

const OWNERS: { id: OwnerFilter; label: string }[] = [
  { id: "family", label: "Family" },
  { id: "praveen", label: "Praveen" },
  { id: "geetha", label: "Geetha" },
];

interface RecommendationCard {
  id?: string;
  owner: Owner;
  scheme_code: string;
  scheme_name: string;
  category: string;
  action: AIAction;
  reason: string;
  suggested_fund: string | null;
  ltcg_note: string | null;
}

const ACTION_ORDER: Record<AIAction, number> = {
  EXIT: 0,
  SWITCH: 1,
  REBALANCE: 2,
  HOLD: 3,
};

const ACTION_STYLES: Record<AIAction, string> = {
  HOLD: "bg-green-100 text-green-700",
  SWITCH: "bg-amber-100 text-amber-700",
  REBALANCE: "bg-blue-100 text-blue-700",
  EXIT: "bg-red-100 text-red-700",
};

function OwnerBadge({ owner }: { owner: Owner }) {
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
        owner === "praveen" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      {owner === "praveen" ? "P" : "G"}
    </span>
  );
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function InsightsClient({ userEmail }: { userEmail: string }) {
  const [owner, setOwner] = useState<OwnerFilter>("family");
  const [recommendations, setRecommendations] = useState<RecommendationCard[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSaved = useCallback(async (forOwner: OwnerFilter) => {
    setLoadingSaved(true);
    try {
      const res = await fetch(`/api/mf/recommendations?owner=${forOwner}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load recommendations");
      setRecommendations(Array.isArray(json.recommendations) ? json.recommendations : []);
      setGeneratedAt(json.generated_at ?? null);
    } catch (err) {
      console.error("Failed to load recommendations:", err);
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  useEffect(() => {
    loadSaved(owner);
  }, [owner, loadSaved]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/mf/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? json.detail ?? "Failed to generate recommendations");

      // Re-fetch the saved rows rather than trusting the POST response
      // directly — it gives us DB-assigned ids and the real generated_at
      // timestamp instead of approximating them client-side.
      await loadSaved(owner);
    } catch (err) {
      console.error("Failed to generate recommendations:", err);
      setError(err instanceof Error ? err.message : "Failed to generate recommendations. Please try again.");
      setTimeout(() => setError(null), 5000);
    } finally {
      setGenerating(false);
    }
  };

  const sorted = [...recommendations].sort((a, b) => ACTION_ORDER[a.action] - ACTION_ORDER[b.action]);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={userEmail} />

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">AI Insights</h1>
            <p className="mt-1 text-sm text-slate-500">
              Claude-generated hold / switch / rebalance / exit recommendations for your portfolio.
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
            {OWNERS.map((o) => (
              <button
                key={o.id}
                onClick={() => setOwner(o.id)}
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
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generating && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              {generating ? "Analysing portfolio…" : "Generate Recommendations"}
            </button>
            <p className="text-xs text-slate-400">
              {generating ? "This can take 10–15 seconds" : `Last generated: ${formatRelativeTime(generatedAt)}`}
            </p>
          </div>

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
        </div>

        {loadingSaved ? (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-white p-4">
                <div className="h-4 w-2/3 rounded bg-slate-200" />
                <div className="mt-3 h-3 w-1/3 rounded bg-slate-200" />
                <div className="mt-4 h-16 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="text-sm font-medium text-slate-700">
              No recommendations yet. Click Generate to analyse your portfolio.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((rec) => (
              <div
                key={rec.id ?? `${rec.owner}:${rec.scheme_code}`}
                className="flex flex-col rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <OwnerBadge owner={rec.owner} />
                    <p className="text-sm font-semibold text-slate-800">{rec.scheme_name}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${ACTION_STYLES[rec.action]}`}>
                    {rec.action}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{rec.category}</p>

                <p className="mt-3 text-sm text-slate-600">{rec.reason}</p>

                {rec.action === "SWITCH" && rec.suggested_fund && (
                  <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2">
                    <p className="text-xs font-medium text-blue-800">Suggested: {rec.suggested_fund}</p>
                  </div>
                )}

                {rec.ltcg_note && (
                  <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2">
                    <p className="text-xs text-amber-800">{rec.ltcg_note}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
