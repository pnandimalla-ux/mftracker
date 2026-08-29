"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import { createClient } from "@/lib/supabase/client";
import type { EnrichedMFHolding, Owner } from "@/types/mf";

type OwnerFilter = "family" | "praveen" | "geetha";
type Period = "6m" | "1y" | "3y" | "5y";

const OWNERS: { id: OwnerFilter; label: string }[] = [
  { id: "family", label: "Family" },
  { id: "praveen", label: "Praveen" },
  { id: "geetha", label: "Geetha" },
];

const PERIODS: { id: Period; label: string }[] = [
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "3y", label: "3Y" },
  { id: "5y", label: "5Y" },
];

interface PeerInfo {
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
  r5y: number | null;
  rank_6m: number | null;
  rank_1y: number | null;
  rank_3y: number | null;
  rank_5y: number | null;
  peer_count: number | null;
  category_avg: {
    r6m: number | null;
    r1y: number | null;
    r3y: number | null;
    r5y: number | null;
  };
}

interface HoldingWithPeer extends EnrichedMFHolding {
  peer: PeerInfo | null;
}

function periodReturnKey(period: Period) {
  return (
    { "6m": "r6m", "1y": "r1y", "3y": "r3y", "5y": "r5y" } as const
  )[period];
}

function periodRankKey(period: Period) {
  return (
    { "6m": "rank_6m", "1y": "rank_1y", "3y": "rank_3y", "5y": "rank_5y" } as const
  )[period];
}

function formatInr(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function formatPct(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function rankBadgeTone(rank: number, peerCount: number) {
  const pct = rank / peerCount;
  if (pct <= 0.25) return "bg-green-100 text-green-700";
  if (pct <= 0.5) return "bg-blue-100 text-blue-700";
  if (pct <= 0.75) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M13.5 3.5l3 3L6 17H3v-3L13.5 3.5z"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path
        d="M4 10.5l3.5 3.5L16 5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface EditDraft {
  owner: Owner;
  invested_amount: string;
  as_on_date: string;
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
  const [period, setPeriod] = useState<Period>("1y");
  const [loading, setLoading] = useState(true);
  const [holdings, setHoldings] = useState<HoldingWithPeer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [syncingNav, setSyncingNav] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [peerDataEmpty, setPeerDataEmpty] = useState(false);
  const [seedingPeers, setSeedingPeers] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [savedFlashId, setSavedFlashId] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadHoldings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/mf/holdings");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load holdings");
      const base: EnrichedMFHolding[] = Array.isArray(json.data) ? json.data : [];

      const schemeCodes = Array.from(new Set(base.map((h) => h.scheme_code)));

      const peerResults = await Promise.allSettled(
        schemeCodes.map(async (code) => {
          const r = await fetch(`/api/mf/peers/${code}`);
          if (!r.ok) return [code, null] as const;
          const j = await r.json();
          return [code, j.data as { scheme: PeerInfo; category_avg: PeerInfo["category_avg"] } | undefined] as const;
        })
      );

      const peerMap = new Map<string, PeerInfo | null>();
      for (const result of peerResults) {
        if (result.status !== "fulfilled") continue;
        const [code, data] = result.value;
        if (!data) {
          peerMap.set(code, null);
          continue;
        }
        peerMap.set(code, {
          r6m: data.scheme.r6m,
          r1y: data.scheme.r1y,
          r3y: data.scheme.r3y,
          r5y: data.scheme.r5y,
          rank_6m: data.scheme.rank_6m,
          rank_1y: data.scheme.rank_1y,
          rank_3y: data.scheme.rank_3y,
          rank_5y: data.scheme.rank_5y,
          peer_count: data.scheme.peer_count,
          category_avg: data.category_avg,
        });
      }

      const merged: HoldingWithPeer[] = base.map((h) => ({
        ...h,
        peer: peerMap.get(h.scheme_code) ?? null,
      }));

      setHoldings(merged);

      const anyRankPresent = merged.some(
        (h) => h.peer && h.peer.rank_1y !== null && h.peer.peer_count
      );
      setPeerDataEmpty(!anyRankPresent);

      if (schemeCodes.length > 0) {
        const supabase = createClient();
        const { data: navRows } = await supabase
          .from("mf_nav_cache")
          .select("fetched_at")
          .in("scheme_code", schemeCodes)
          .order("fetched_at", { ascending: false })
          .limit(1);
        setLastSynced(navRows?.[0]?.fetched_at ?? null);
      }
    } catch (err) {
      console.error("Failed to load holdings:", err);
      setHoldings([]);
      setLoadError("Unable to load holdings right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHoldings();
  }, [loadHoldings]);

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

    const withR1y = filteredHoldings.filter((h) => h.peer?.r1y !== null && h.peer?.r1y !== undefined);
    const investedWithR1y = withR1y.reduce((sum, h) => sum + Number(h.invested_amount), 0);
    const avg1y =
      investedWithR1y > 0
        ? withR1y.reduce((sum, h) => sum + (h.peer!.r1y as number) * Number(h.invested_amount), 0) /
          investedWithR1y
        : null;

    const underperformingPeers = filteredHoldings.filter(
      (h) =>
        h.peer?.r1y !== null &&
        h.peer?.r1y !== undefined &&
        h.peer?.category_avg.r1y !== null &&
        h.peer?.category_avg.r1y !== undefined &&
        (h.peer.r1y as number) < (h.peer.category_avg.r1y as number)
    ).length;

    return { totalInvested, currentValue, pnl, pnlPct, underperforming, avg1y, underperformingPeers };
  }, [filteredHoldings]);

  const hasAnyHoldings = holdings.length > 0;
  const hasPeerKpiData = filteredHoldings.some((h) => h.peer?.r1y !== null && h.peer?.r1y !== undefined);

  const handleSyncNav = async () => {
    setSyncingNav(true);
    try {
      const res = await fetch("/api/mf/nav/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      showToast("NAV updated");
      await loadHoldings();
    } catch (err) {
      console.error("NAV sync failed:", err);
      showToast("NAV sync failed");
    } finally {
      setSyncingNav(false);
    }
  };

  const handleSeedPeers = async () => {
    setSeedingPeers(true);
    try {
      const res = await fetch("/api/mf/peers/seed", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Peer sync failed");
      window.location.reload();
    } catch (err) {
      console.error("Peer seed failed:", err);
      showToast("Peer data sync failed");
      setSeedingPeers(false);
    }
  };

  const handleStartEdit = (h: HoldingWithPeer) => {
    setEditingId(h.id);
    setEditDraft({
      owner: h.owner,
      invested_amount: String(h.invested_amount),
      as_on_date: h.as_on_date,
    });
    setEditError(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
    setEditError(null);
  };

  const handleSaveEdit = async (h: HoldingWithPeer) => {
    if (!editDraft) return;

    const investedAmount = Number(editDraft.invested_amount);
    if (!Number.isFinite(investedAmount) || investedAmount <= 0) {
      setEditError("Invested amount must be a positive number");
      return;
    }
    if (!editDraft.as_on_date) {
      setEditError("As on date is required");
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/mf/holdings/${h.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: editDraft.owner,
          invested_amount: investedAmount,
          as_on_date: editDraft.as_on_date,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");

      const updated = json.data as { owner: Owner; invested_amount: number; as_on_date: string };

      setHoldings((prev) =>
        prev.map((row) => {
          if (row.id !== h.id) return row;
          const newInvested = Number(updated.invested_amount);
          const newPnl = row.current_value - newInvested;
          const newPnlPct = newInvested > 0 ? (newPnl / newInvested) * 100 : 0;
          return {
            ...row,
            owner: updated.owner,
            invested_amount: newInvested,
            as_on_date: updated.as_on_date,
            pnl: newPnl,
            pnl_pct: newPnlPct,
          };
        })
      );

      setEditingId(null);
      setEditDraft(null);
      setSavedFlashId(h.id);
      setTimeout(() => setSavedFlashId(null), 1500);
    } catch (err) {
      console.error("Failed to save holding edit:", err);
      setEditError("Failed to save");
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={userEmail} />

      {toast && (
        <div className="fixed right-4 top-4 z-50 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
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

          <div className="text-right">
            <button
              onClick={handleSyncNav}
              disabled={syncingNav}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncingNav && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
              )}
              {syncingNav ? "Syncing..." : "Sync NAV"}
            </button>
            <p className="mt-1 text-xs text-slate-400">
              Last synced: {lastSynced ? new Date(lastSynced).toLocaleString("en-IN") : "—"}
            </p>
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
              <KpiCard
                label="Avg 1Y return"
                value={hasPeerKpiData ? formatPct(kpis.avg1y) : "—"}
                tone={kpis.avg1y !== null ? (kpis.avg1y >= 0 ? "positive" : "negative") : undefined}
              />
              <KpiCard
                label="Underperforming"
                value={hasAnyHoldings ? String(kpis.underperformingPeers) : "—"}
                sub={hasAnyHoldings ? "vs category avg 1Y" : undefined}
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
          <>
            <div className="mt-8 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Holdings</h2>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
                {PERIODS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPeriod(p.id)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                      period === p.id
                        ? "bg-white text-blue-600 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                    <th className="px-4 py-2 font-medium">{PERIODS.find((p) => p.id === period)?.label} Return</th>
                    <th className="px-4 py-2 font-medium">Peer rank</th>
                    <th className="px-4 py-2 font-medium">NAV date</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHoldings.map((h) => {
                    const rowPnlPct =
                      h.invested_amount > 0 ? (h.pnl / h.invested_amount) * 100 : 0;
                    const returnKey = periodReturnKey(period);
                    const rankKey = periodRankKey(period);
                    const returnValue = h.peer ? h.peer[returnKey] : null;
                    const rankValue = h.peer ? h.peer[rankKey] : null;
                    const peerCount = h.peer?.peer_count ?? null;
                    const isEditing = editingId === h.id;
                    const isSavedFlash = savedFlashId === h.id;

                    return (
                      <tr
                        key={h.id}
                        className={`group border-b border-slate-100 last:border-0 transition-colors duration-700 ${
                          isSavedFlash ? "bg-green-50" : ""
                        }`}
                      >
                        <td className="px-4 py-3 text-slate-800">
                          <Link
                            href={`/fund/${h.scheme_code}`}
                            className="hover:text-blue-600 hover:underline"
                          >
                            {h.scheme_name}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          {isEditing && editDraft ? (
                            <div className="inline-flex rounded-md border border-slate-200 p-0.5">
                              <button
                                type="button"
                                onClick={() => setEditDraft({ ...editDraft, owner: "praveen" })}
                                className={`rounded px-2 py-0.5 text-xs font-semibold transition ${
                                  editDraft.owner === "praveen"
                                    ? "bg-blue-600 text-white"
                                    : "text-slate-500 hover:bg-slate-100"
                                }`}
                              >
                                P
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditDraft({ ...editDraft, owner: "geetha" })}
                                className={`rounded px-2 py-0.5 text-xs font-semibold transition ${
                                  editDraft.owner === "geetha"
                                    ? "bg-amber-500 text-white"
                                    : "text-slate-500 hover:bg-slate-100"
                                }`}
                              >
                                G
                              </button>
                            </div>
                          ) : (
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                                h.owner === "praveen"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {h.owner === "praveen" ? "P" : "G"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{h.category}</td>
                        <td className="px-4 py-3 text-slate-800">
                          {isEditing && editDraft ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editDraft.invested_amount}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, invested_amount: e.target.value })
                              }
                              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                            />
                          ) : (
                            formatInr(Number(h.invested_amount))
                          )}
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
                        <td
                          className={`px-4 py-3 font-medium ${
                            returnValue === null
                              ? "text-slate-400"
                              : returnValue >= 0
                                ? "text-green-600"
                                : "text-red-600"
                          }`}
                        >
                          {formatPct(returnValue)}
                        </td>
                        <td className="px-4 py-3">
                          {rankValue && peerCount ? (
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${rankBadgeTone(
                                rankValue,
                                peerCount
                              )}`}
                            >
                              #{rankValue}/{peerCount}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {isEditing && editDraft ? (
                            <input
                              type="date"
                              value={editDraft.as_on_date}
                              max={new Date().toISOString().slice(0, 10)}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, as_on_date: e.target.value })
                              }
                              className="rounded border border-slate-300 px-2 py-1 text-sm"
                            />
                          ) : (
                            h.nav_date ?? "—"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(h)}
                                  disabled={editSaving}
                                  aria-label="Save"
                                  className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <CheckIcon />
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCancelEdit}
                                  disabled={editSaving}
                                  aria-label="Cancel"
                                  className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-200 text-slate-600 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <XIcon />
                                </button>
                              </div>
                              {editError && (
                                <span className="text-xs font-medium text-red-600">{editError}</span>
                              )}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStartEdit(h)}
                              aria-label="Edit"
                              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100"
                            >
                              <PencilIcon />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loading && hasAnyHoldings && peerDataEmpty && (
          <div className="mt-6 flex items-center justify-center">
            <button
              onClick={handleSeedPeers}
              disabled={seedingPeers}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {seedingPeers ? "Syncing peer data... this takes ~2 minutes" : "Sync peer data"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
