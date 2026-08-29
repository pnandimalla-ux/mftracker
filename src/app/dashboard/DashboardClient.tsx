"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import type { EnrichedMFHolding } from "@/types/mf";

type OwnerFilter = "family" | "praveen" | "geetha";

const OWNERS: { id: OwnerFilter; label: string }[] = [
  { id: "family", label: "Family" },
  { id: "praveen", label: "Praveen" },
  { id: "geetha", label: "Geetha" },
];

function formatInr(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative";
}) {
  const valueTone =
    tone === "positive"
      ? "text-green-600"
      : tone === "negative"
        ? "text-red-600"
        : "text-slate-900";
  const subTone =
    tone === "positive"
      ? "text-green-600"
      : tone === "negative"
        ? "text-red-600"
        : "text-slate-500";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${valueTone}`}>{value}</p>
      {sub && <p className={`mt-0.5 text-xs font-medium ${subTone}`}>{sub}</p>}
    </div>
  );
}

export default function DashboardClient({
  userEmail,
}: {
  userEmail: string;
}) {
  const [owner, setOwner] = useState<OwnerFilter>("family");
  const [loading, setLoading] = useState(true);
  const [holdings, setHoldings] = useState<EnrichedMFHolding[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch("/api/mf/holdings");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load holdings");
        if (!cancelled) {
          setHoldings(Array.isArray(json.data) ? json.data : []);
        }
      } catch (err) {
        console.error("Failed to load holdings:", err);
        if (!cancelled) {
          setHoldings([]);
          setLoadError("Unable to load holdings right now.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredHoldings = useMemo(() => {
    const list =
      owner === "family" ? holdings : holdings.filter((h) => h.owner === owner);
    return [...list].sort((a, b) => b.invested_amount - a.invested_amount);
  }, [holdings, owner]);

  const kpis = useMemo(() => {
    const totalInvested = filteredHoldings.reduce(
      (sum, h) => sum + Number(h.invested_amount),
      0
    );
    const currentValue = filteredHoldings.reduce(
      (sum, h) => sum + Number(h.current_value),
      0
    );
    const pnl = currentValue - totalInvested;
    const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;
    const underperforming = filteredHoldings.filter((h) => h.pnl < 0).length;

    return { totalInvested, currentValue, pnl, pnlPct, underperforming };
  }, [filteredHoldings]);

  const hasAnyHoldings = holdings.length > 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={userEmail} />

      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
            {OWNERS.map((o) => (
              <button
                key={o.id}
                onClick={() => setOwner(o.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  owner === o.id
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {loadError && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {loadError}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="h-3 w-20 rounded bg-slate-200" />
                <div className="mt-3 h-6 w-16 rounded bg-slate-200" />
              </div>
            ))
          ) : (
            <>
              <KpiCard label="Total invested" value={formatInr(kpis.totalInvested)} />
              <KpiCard label="Current value" value={formatInr(kpis.currentValue)} />
              <KpiCard
                label="Total P&L"
                value={`${kpis.pnl >= 0 ? "+" : "-"}${formatInr(Math.abs(kpis.pnl))}`}
                sub={`${kpis.pnl >= 0 ? "+" : ""}${kpis.pnlPct.toFixed(2)}%`}
                tone={kpis.pnl >= 0 ? "positive" : "negative"}
              />
              <KpiCard label="Avg 1Y return" value="—" />
              <KpiCard
                label="Underperforming"
                value={hasAnyHoldings ? String(kpis.underperforming) : "—"}
              />
            </>
          )}
        </div>

        {loading && (
          <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-3">
                  <div className="h-4 w-1/3 rounded bg-slate-200" />
                  <div className="h-4 w-6 rounded-full bg-slate-200" />
                  <div className="h-4 w-20 rounded bg-slate-200" />
                  <div className="h-4 w-20 rounded bg-slate-200" />
                  <div className="h-4 w-20 rounded bg-slate-200" />
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && !hasAnyHoldings && (
          <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="text-sm font-medium text-slate-700">
              No holdings yet — import your CAMS CAS statement
            </p>
            <Link
              href="/import"
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              Import holdings
            </Link>
          </div>
        )}

        {!loading && hasAnyHoldings && (
          <div className="mt-8 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium">Fund name</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Invested ₹</th>
                  <th className="px-4 py-2 font-medium">Current ₹</th>
                  <th className="px-4 py-2 font-medium">P&L</th>
                  <th className="px-4 py-2 font-medium">Units</th>
                  <th className="px-4 py-2 font-medium">NAV date</th>
                </tr>
              </thead>
              <tbody>
                {filteredHoldings.map((h) => {
                  const rowPnlPct =
                    h.invested_amount > 0 ? (h.pnl / h.invested_amount) * 100 : 0;
                  return (
                    <tr key={h.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 text-slate-800">{h.scheme_name}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                            h.owner === "praveen"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {h.owner === "praveen" ? "P" : "G"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{h.category}</td>
                      <td className="px-4 py-3 text-slate-800">
                        {formatInr(Number(h.invested_amount))}
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        {formatInr(Number(h.current_value))}
                      </td>
                      <td
                        className={`px-4 py-3 font-medium ${
                          h.pnl >= 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {h.pnl >= 0 ? "+" : "-"}
                        {formatInr(Math.abs(h.pnl))} (
                        {rowPnlPct >= 0 ? "+" : ""}
                        {rowPnlPct.toFixed(2)}%)
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {Number(h.units).toLocaleString("en-IN", {
                          maximumFractionDigits: 3,
                        })}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {h.nav_date ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
