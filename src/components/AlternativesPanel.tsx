"use client";

import { useEffect } from "react";
import type { HoldingGroup } from "@/app/dashboard/DashboardClient";
import type { Owner } from "@/types/mf";

export interface ComparisonEntry {
  scheme_code: string;
  scheme_name: string;
  amc: string | null;
  rank: number;
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
  expense_ratio: number | null;
  diff_r6m: number | null;
  diff_r1y: number | null;
  diff_r3y: number | null;
  diff_r5y: number | null;
  overlap_estimate: string;
  zerodha_coin_url: string;
}

export interface AlternativesData {
  held_fund: {
    scheme_code: string;
    scheme_name: string;
    category: string;
    amc: string | null;
    r6m: number | null;
    r1y: number | null;
    r3y: number | null;
    r5y: number | null;
    peer_rank_6m: number | null;
    peer_rank_1y: number | null;
    peer_rank_3y: number | null;
    peer_rank_5y: number | null;
    peer_count: number | null;
    expense_ratio: number | null;
    owners: Owner[];
  };
  category_avg: { r6m: number | null; r1y: number | null; r3y: number | null; r5y: number | null };
  funds_above: ComparisonEntry[];
  top_3: ComparisonEntry[];
  signal: "hold" | "watch" | "switch";
  signal_reason: string;
  suggested_switch: { scheme_code: string; scheme_name: string } | null;
  no_peer_data?: boolean;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function returnTone(value: number | null, categoryAvg: number | null): string {
  if (value === null) return "text-slate-400";
  if (categoryAvg === null) return value >= 0 ? "text-green-600" : "text-red-600";
  const d = value - categoryAvg;
  if (Math.abs(d) <= 0.5) return "text-slate-600";
  return d > 0 ? "text-green-600" : "text-red-600";
}

function pillTone(value: number | null, categoryAvg: number | null): string {
  if (value === null || categoryAvg === null) return "bg-slate-100 text-slate-500";
  return value >= categoryAvg ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700";
}

function diffTone(value: number | null): string {
  if (value === null) return "text-slate-400";
  return value > 0 ? "text-green-600" : value < 0 ? "text-red-600" : "text-slate-500";
}

function diffArrow(value: number | null): string {
  if (value === null || value === 0) return "";
  return value > 0 ? " ↑" : " ↓";
}

function OwnerDot({ owner }: { owner: Owner }) {
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
        owner === "praveen" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      {owner === "praveen" ? "P" : "G"}
    </span>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

const PERIODS: { key: "r6m" | "r1y" | "r3y" | "r5y"; label: string }[] = [
  { key: "r6m", label: "6M" },
  { key: "r1y", label: "1Y" },
  { key: "r3y", label: "3Y" },
  { key: "r5y", label: "5Y" },
];

interface HeldReturns {
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
}

function ComparisonCard({
  fund,
  heldName,
  heldReturns,
}: {
  fund: ComparisonEntry;
  heldName: string;
  heldReturns: HeldReturns;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">
            #{fund.rank} {fund.scheme_name}
          </p>
          <p className="text-xs text-slate-500">{fund.amc ?? "—"}</p>
        </div>
      </div>

      <table className="mt-3 w-full text-xs">
        <thead>
          <tr className="text-slate-400">
            <th className="pb-1 text-left font-medium"></th>
            <th className="pb-1 text-right font-medium">Theirs</th>
            <th className="pb-1 text-right font-medium">Yours</th>
            <th className="pb-1 text-right font-medium">Diff</th>
          </tr>
        </thead>
        <tbody>
          {PERIODS.map((p) => {
            const theirs = fund[p.key];
            const yours = heldReturns[p.key];
            const d = fund[`diff_${p.key}` as const];
            return (
              <tr key={p.key} className="border-t border-slate-100">
                <td className="py-1 text-slate-500">{p.label}</td>
                <td className="py-1 text-right text-slate-700">{formatPct(theirs)}</td>
                <td className="py-1 text-right text-slate-700">{formatPct(yours)}</td>
                <td className={`py-1 text-right font-medium ${diffTone(d)}`}>
                  {formatPct(d)}
                  {diffArrow(d)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          Expense ratio: {fund.expense_ratio !== null ? `${fund.expense_ratio.toFixed(2)}%` : "—"} vs yours —
        </span>
        <span>Overlap with {heldName.split(" - ")[0]}: {fund.overlap_estimate}</span>
      </div>

      <a
        href={fund.zerodha_coin_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
      >
        View on Zerodha Coin ↗
      </a>
    </div>
  );
}

export default function AlternativesPanel({
  isOpen,
  onClose,
  fund,
  data,
  loading,
  onSyncNow,
}: {
  isOpen: boolean;
  onClose: () => void;
  fund: HoldingGroup | null;
  data: AlternativesData | null;
  loading: boolean;
  onSyncNow?: () => void;
}) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  const heldFund = data?.held_fund ?? null;
  const categoryAvg = data?.category_avg ?? null;

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className={`fixed right-0 top-0 z-50 flex h-screen w-full flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ease-in-out md:w-[520px] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Better alternatives"
      >
        <div className="shrink-0 border-b border-slate-200 p-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <XIcon />
          </button>

          <p className="mt-2 text-sm font-semibold text-slate-800">Better alternatives</p>

          {loading || !fund ? (
            <SkeletonBar className="mt-1 h-5 w-3/4" />
          ) : (
            <p className="mt-1 truncate text-base font-semibold text-slate-900" title={fund.scheme_name}>
              {fund.scheme_name}
            </p>
          )}

          {loading || !heldFund ? (
            <div className="mt-2 flex gap-2">
              <SkeletonBar className="h-5 w-20" />
              <SkeletonBar className="h-5 w-24" />
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                {heldFund.category}
              </span>
              {heldFund.peer_rank_1y && heldFund.peer_count ? (
                <span className="text-slate-500">
                  Your rank: #{heldFund.peer_rank_1y}/{heldFund.peer_count}
                </span>
              ) : (
                <span className="text-slate-400">Rank not available</span>
              )}
            </div>
          )}

          {loading || !heldFund ? (
            <SkeletonBar className="mt-2 h-4 w-2/3" />
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              Your 1Y: <span className={returnTone(heldFund.r1y, categoryAvg?.r1y ?? null)}>{formatPct(heldFund.r1y)}</span>{" "}
              vs Category avg: <span className="text-slate-600">{formatPct(categoryAvg?.r1y ?? null)}</span>
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading || !data ? (
            <div className="space-y-4">
              <SkeletonBar className="h-24 w-full" />
              <SkeletonBar className="h-8 w-full" />
              <SkeletonBar className="h-20 w-full" />
              <SkeletonBar className="h-20 w-full" />
              <SkeletonBar className="h-20 w-full" />
            </div>
          ) : data.no_peer_data ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
              <p className="text-sm font-medium text-slate-600">Sync peer data to see alternatives</p>
              {onSyncNow && (
                <button
                  type="button"
                  onClick={onSyncNow}
                  className="mt-3 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
                >
                  Sync now
                </button>
              )}
            </div>
          ) : heldFund ? (
            <div className="space-y-5">
              {/* Section 1 — Your fund */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-800">{heldFund.scheme_name}</p>
                <p className="text-xs text-slate-500">
                  {heldFund.amc ?? "—"} · {heldFund.category}
                </p>

                <div className="mt-3 grid grid-cols-4 gap-2">
                  {PERIODS.map((p) => (
                    <div key={p.key} className="text-center">
                      <span
                        className={`block rounded-full px-2 py-1 text-xs font-semibold ${pillTone(
                          heldFund[p.key],
                          categoryAvg?.[p.key] ?? null
                        )}`}
                      >
                        {formatPct(heldFund[p.key])}
                      </span>
                      <span className="mt-1 block text-[10px] text-slate-400">
                        {p.label}
                        {(() => {
                          const rankKey = (`peer_rank_${p.key}` as const) as keyof typeof heldFund;
                          const rank = heldFund[rankKey] as number | null;
                          return rank && heldFund.peer_count ? ` #${rank}/${heldFund.peer_count}` : "";
                        })()}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span>
                    Expense ratio: {heldFund.expense_ratio !== null ? `${heldFund.expense_ratio.toFixed(2)}%` : "—"}
                  </span>
                  <span className="flex items-center gap-1">
                    Currently held by:
                    {heldFund.owners.map((o) => (
                      <OwnerDot key={o} owner={o} />
                    ))}
                  </span>
                </div>
              </div>

              {/* Section 2 — funds ranked above */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Funds ranked above you
                </h3>
                {(!heldFund.peer_rank_1y || heldFund.peer_rank_1y === 1) ? (
                  <div className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                    🏆 You hold the top-ranked fund in this category!
                  </div>
                ) : data.funds_above.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-400">No ranked peer data available yet.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {data.funds_above.map((f) => (
                      <ComparisonCard
                        key={f.scheme_code}
                        fund={f}
                        heldName={heldFund.scheme_name}
                        heldReturns={heldFund}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Section 3 — top 3 in category */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Top 3 in category
                </h3>
                <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                        <th className="px-2 py-1.5 text-left font-medium">Rank</th>
                        <th className="px-2 py-1.5 text-left font-medium">Fund</th>
                        <th className="px-2 py-1.5 text-right font-medium">1Y</th>
                        <th className="px-2 py-1.5 text-right font-medium">3Y</th>
                        <th className="px-2 py-1.5 text-right font-medium">5Y</th>
                        <th className="px-2 py-1.5 text-right font-medium">Exp.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_3.map((f) => {
                        const isYou = f.scheme_code === heldFund.scheme_code;
                        return (
                          <tr
                            key={f.scheme_code}
                            className={`border-t border-slate-100 ${isYou ? "border-l-4 border-l-blue-600 bg-blue-50" : ""}`}
                          >
                            <td className="px-2 py-1.5 font-medium text-slate-600">#{f.rank}</td>
                            <td className="px-2 py-1.5 text-slate-700">
                              <div className="max-w-[140px] truncate" title={f.scheme_name}>
                                {f.scheme_name}
                              </div>
                              {isYou && <span className="text-[10px] font-medium text-blue-600">← You are here</span>}
                            </td>
                            <td className={`px-2 py-1.5 text-right font-medium ${returnTone(f.r1y, categoryAvg?.r1y ?? null)}`}>
                              {formatPct(f.r1y)}
                            </td>
                            <td className={`px-2 py-1.5 text-right font-medium ${returnTone(f.r3y, categoryAvg?.r3y ?? null)}`}>
                              {formatPct(f.r3y)}
                            </td>
                            <td className={`px-2 py-1.5 text-right font-medium ${returnTone(f.r5y, categoryAvg?.r5y ?? null)}`}>
                              {formatPct(f.r5y)}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-600">
                              {f.expense_ratio !== null ? `${f.expense_ratio.toFixed(2)}%` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 4 — should you switch */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Should you switch?
                </h3>
                {data.signal === "hold" && (
                  <div className="mt-2 rounded-lg border border-green-200 bg-green-50 p-3">
                    <p className="text-sm font-semibold text-green-700">Hold — strong performer</p>
                    <p className="mt-1 text-xs text-green-700">{data.signal_reason}</p>
                  </div>
                )}
                {data.signal === "watch" && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm font-semibold text-amber-700">Watch — moderate underperformance</p>
                    <p className="mt-1 text-xs text-amber-700">{data.signal_reason}</p>
                  </div>
                )}
                {data.signal === "switch" && (
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-sm font-semibold text-red-700">Consider switching</p>
                    <p className="mt-1 text-xs text-red-700">{data.signal_reason}</p>
                    {data.suggested_switch && (
                      <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5">
                        <span className="truncate text-xs font-medium text-slate-700">
                          Suggested: {data.suggested_switch.scheme_name}
                        </span>
                        <button
                          type="button"
                          disabled
                          title="Coming soon"
                          className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-400"
                        >
                          Get AI analysis →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
