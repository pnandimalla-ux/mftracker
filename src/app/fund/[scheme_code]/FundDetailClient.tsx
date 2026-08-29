"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import type { EnrichedMFHolding } from "@/types/mf";

type Period = "6m" | "1y" | "3y" | "5y";

const PERIODS: { id: Period; label: string }[] = [
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "3y", label: "3Y" },
  { id: "5y", label: "5Y" },
];

interface SchemeRow {
  code: string;
  name: string | null;
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
  rank_6m: number | null;
  rank_1y: number | null;
  rank_3y: number | null;
  rank_5y: number | null;
  peer_count: number | null;
  expense_ratio: number | null;
}

interface PeerApiData {
  category: string;
  scheme: SchemeRow;
  peers: SchemeRow[];
  category_avg: { r6m: number | null; r1y: number | null; r3y: number | null; r5y: number | null };
}

interface NavInfo {
  scheme_code: string;
  scheme_name: string | null;
  nav: number | null;
  nav_date: string | null;
  fetched_at: string | null;
}

function periodReturnKey(period: Period) {
  return ({ "6m": "r6m", "1y": "r1y", "3y": "r3y", "5y": "r5y" } as const)[period];
}

function periodRankKey(period: Period) {
  return ({ "6m": "rank_6m", "1y": "rank_1y", "3y": "rank_3y", "5y": "rank_5y" } as const)[period];
}

function formatInr(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function formatPct(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatRelativeTime(iso: string | null) {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function ReturnsBarChart({
  yourReturn,
  categoryAvg,
  topPerformer,
}: {
  yourReturn: number | null;
  categoryAvg: number | null;
  topPerformer: number | null;
}) {
  const width = 600;
  const height = 140;
  const leftPad = 90;
  const rightPad = 30;
  const chartWidth = width - leftPad - rightPad;

  const values = [yourReturn, categoryAvg, topPerformer].filter(
    (v): v is number => v !== null
  );

  if (values.length === 0) {
    return (
      <p className="text-sm text-slate-400">Not enough data to chart returns yet.</p>
    );
  }

  const domainMax = Math.max(...values, 0) * 1.15 || 1;
  const domainMin = Math.min(...values, 0) * 1.15;
  const range = domainMax - domainMin || 1;

  const scaleX = (v: number) => leftPad + ((v - domainMin) / range) * chartWidth;
  const zeroX = scaleX(0);

  const bars: { label: string; value: number | null; color: string; y: number }[] = [
    { label: "You", value: yourReturn, color: "#2563eb", y: 20 },
    { label: "Top performer", value: topPerformer, color: "#86efac", y: 80 },
  ];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Returns vs peers bar chart">
      <line x1={zeroX} y1={10} x2={zeroX} y2={height - 10} stroke="#cbd5e1" strokeWidth={1} />

      {categoryAvg !== null && (
        <g>
          <line
            x1={scaleX(categoryAvg)}
            y1={10}
            x2={scaleX(categoryAvg)}
            y2={height - 10}
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <text x={scaleX(categoryAvg)} y={height - 2} fontSize={10} fill="#64748b" textAnchor="middle">
            avg {categoryAvg.toFixed(1)}%
          </text>
        </g>
      )}

      {bars.map((bar) => {
        if (bar.value === null) return null;
        const barX = Math.min(zeroX, scaleX(bar.value));
        const barW = Math.abs(scaleX(bar.value) - zeroX);
        return (
          <g key={bar.label}>
            <text x={leftPad - 8} y={bar.y + 14} fontSize={12} fill="#334155" textAnchor="end">
              {bar.label}
            </text>
            <rect x={barX} y={bar.y} width={Math.max(barW, 1)} height={24} fill={bar.color} rx={3} />
            <text
              x={scaleX(bar.value) + (bar.value >= 0 ? 6 : -6)}
              y={bar.y + 16}
              fontSize={12}
              fontWeight={600}
              fill="#0f172a"
              textAnchor={bar.value >= 0 ? "start" : "end"}
            >
              {formatPct(bar.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function FundDetailClient({
  userEmail,
  schemeCode,
}: {
  userEmail: string;
  schemeCode: string;
}) {
  const [period, setPeriod] = useState<Period>("1y");
  const [loading, setLoading] = useState(true);
  const [navInfo, setNavInfo] = useState<NavInfo | null>(null);
  const [holdings, setHoldings] = useState<EnrichedMFHolding[]>([]);
  const [peerData, setPeerData] = useState<PeerApiData | null>(null);
  const [peerError, setPeerError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [navRes, holdingsRes, peerRes] = await Promise.all([
          fetch(`/api/mf/nav/${schemeCode}`),
          fetch("/api/mf/holdings"),
          fetch(`/api/mf/peers/${schemeCode}`),
        ]);

        if (cancelled) return;

        if (navRes.ok) {
          const navJson = await navRes.json();
          setNavInfo(navJson.data ?? null);
        }

        if (holdingsRes.ok) {
          const holdingsJson = await holdingsRes.json();
          const all: EnrichedMFHolding[] = Array.isArray(holdingsJson.data) ? holdingsJson.data : [];
          setHoldings(all.filter((h) => h.scheme_code === schemeCode));
        }

        if (peerRes.ok) {
          const peerJson = await peerRes.json();
          setPeerData(peerJson.data ?? null);
          setPeerError(null);
        } else {
          const peerJson = await peerRes.json().catch(() => ({}));
          setPeerData(null);
          setPeerError(peerJson.error ?? "Peer comparison not available for this fund");
        }
      } catch (err) {
        console.error("Failed to load fund detail:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [schemeCode]);

  const fundName = peerData?.scheme.name ?? navInfo?.scheme_name ?? holdings[0]?.scheme_name ?? schemeCode;
  const category = peerData?.category ?? holdings[0]?.category ?? null;
  const amc = holdings[0]?.amc ?? null;

  const allPeerRows = useMemo(() => {
    if (!peerData) return [];
    return [peerData.scheme, ...peerData.peers];
  }, [peerData]);

  const sortedPeerRows = useMemo(() => {
    const key = periodReturnKey(period);
    return [...allPeerRows].sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity));
  }, [allPeerRows, period]);

  const expenseQuartiles = useMemo(() => {
    const ratios = allPeerRows
      .map((r) => r.expense_ratio)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    if (ratios.length < 4) return { low: null as number | null, high: null as number | null };
    const lowCutoff = ratios[Math.floor(ratios.length * 0.25)];
    const highCutoff = ratios[Math.ceil(ratios.length * 0.75) - 1];
    return { low: lowCutoff, high: highCutoff };
  }, [allPeerRows]);

  const returnKey = periodReturnKey(period);
  const rankKey = periodRankKey(period);
  const yourReturn = peerData?.scheme[returnKey] ?? null;
  const categoryAvg = peerData?.category_avg[returnKey] ?? null;
  const topPerformer = allPeerRows.reduce<number | null>((max, r) => {
    const v = r[returnKey];
    if (v === null) return max;
    if (max === null) return v;
    return v > max ? v : max;
  }, null);
  const yourRank = peerData?.scheme[rankKey] ?? null;
  const peerCount = peerData?.scheme.peer_count ?? null;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={userEmail} />

      <main className="mx-auto max-w-6xl px-4 py-8">
        <Link href="/dashboard" className="text-xs font-medium text-blue-600 hover:underline">
          ← Back to dashboard
        </Link>

        {loading ? (
          <div className="mt-6 animate-pulse space-y-4">
            <div className="h-8 w-1/2 rounded bg-slate-200" />
            <div className="h-24 rounded-xl bg-slate-200" />
            <div className="h-48 rounded-xl bg-slate-200" />
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold text-slate-900">{fundName}</h1>
                  {category && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {category}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">{amc ?? "AMC not available"}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold text-slate-900">
                  {navInfo?.nav ? `₹${Number(navInfo.nav).toFixed(4)}` : "—"}
                </p>
                <p className="text-xs text-slate-500">NAV as of {navInfo?.nav_date ?? "—"}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Last updated: {formatRelativeTime(navInfo?.fetched_at ?? null)}
                </p>
              </div>
            </div>

            {holdings.length > 0 && (
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {holdings.map((h) => (
                  <div key={h.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-700">Your holding</p>
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                          h.owner === "praveen" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {h.owner === "praveen" ? "P" : "G"}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
                      <span className="text-slate-500">Units</span>
                      <span className="text-right text-slate-800">
                        {Number(h.units).toLocaleString("en-IN", { maximumFractionDigits: 3 })}
                      </span>
                      <span className="text-slate-500">Avg NAV</span>
                      <span className="text-right text-slate-800">₹{Number(h.avg_nav).toFixed(4)}</span>
                      <span className="text-slate-500">Invested</span>
                      <span className="text-right text-slate-800">{formatInr(Number(h.invested_amount))}</span>
                      <span className="text-slate-500">Current value</span>
                      <span className="text-right text-slate-800">{formatInr(Number(h.current_value))}</span>
                      <span className="text-slate-500">P&L</span>
                      <span className={`text-right font-medium ${h.pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {h.pnl >= 0 ? "+" : "-"}
                        {formatInr(Math.abs(h.pnl))} ({h.pnl_pct >= 0 ? "+" : ""}
                        {h.pnl_pct.toFixed(2)}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">Returns vs peers</h2>
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
                  {PERIODS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPeriod(p.id)}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                        period === p.id ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {peerError && !peerData ? (
                <p className="mt-4 text-sm text-slate-400">{peerError}</p>
              ) : (
                <>
                  <div className="mt-4">
                    <ReturnsBarChart yourReturn={yourReturn} categoryAvg={categoryAvg} topPerformer={topPerformer} />
                  </div>
                  <div className="mt-4 text-center">
                    {yourRank && peerCount ? (
                      <p className="text-2xl font-semibold text-slate-900">
                        #{yourRank} <span className="text-base font-normal text-slate-500">out of {peerCount} funds</span>
                      </p>
                    ) : (
                      <p className="text-sm text-slate-400">Peer rank not available for this period yet</p>
                    )}
                  </div>
                </>
              )}
            </div>

            {peerData && (
              <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="px-4 py-2 font-medium">Fund name</th>
                      <th className="px-4 py-2 font-medium">6M</th>
                      <th className="px-4 py-2 font-medium">1Y</th>
                      <th className="px-4 py-2 font-medium">3Y</th>
                      <th className="px-4 py-2 font-medium">5Y</th>
                      <th className="px-4 py-2 font-medium">Expense ratio</th>
                      <th className="px-4 py-2 font-medium">Rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPeerRows.map((row) => {
                      const isYou = row.code === schemeCode;
                      const rank = row[rankKey];
                      const expenseTone =
                        row.expense_ratio === null
                          ? "text-slate-400"
                          : expenseQuartiles.low !== null && row.expense_ratio <= expenseQuartiles.low
                            ? "text-green-600"
                            : expenseQuartiles.high !== null && row.expense_ratio >= expenseQuartiles.high
                              ? "text-red-600"
                              : "text-slate-700";
                      return (
                        <tr
                          key={row.code}
                          className={`border-b border-slate-100 last:border-0 ${
                            isYou ? "border-l-4 border-l-blue-600 bg-blue-50/40" : ""
                          }`}
                        >
                          <td className="px-4 py-3 text-slate-800">
                            {isYou ? (
                              <span className="font-semibold">{row.name ?? row.code}</span>
                            ) : (
                              <Link href={`/fund/${row.code}`} className="hover:text-blue-600 hover:underline">
                                {row.name ?? row.code}
                              </Link>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{formatPct(row.r6m)}</td>
                          <td className="px-4 py-3 text-slate-600">{formatPct(row.r1y)}</td>
                          <td className="px-4 py-3 text-slate-600">{formatPct(row.r3y)}</td>
                          <td className="px-4 py-3 text-slate-600">{formatPct(row.r5y)}</td>
                          <td className={`px-4 py-3 font-medium ${expenseTone}`}>
                            {row.expense_ratio !== null ? `${row.expense_ratio.toFixed(2)}%` : "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {rank && row.peer_count ? `#${rank}/${row.peer_count}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
