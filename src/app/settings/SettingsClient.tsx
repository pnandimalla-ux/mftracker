"use client";

import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { createClient } from "@/lib/supabase/client";
import { ALL_CATEGORIES } from "@/lib/peers/categoryUniverse";
import type { MFSyncLog } from "@/types/mf";

type CategorySyncStatus = "pending" | "in-progress" | "done" | "failed";

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

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

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path d="M4 10.5l3.5 3.5L16 5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CategoryStatusIcon({ status }: { status: CategorySyncStatus }) {
  if (status === "done") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-100 text-green-600">
        <CheckIcon />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-red-600">
        <XIcon />
      </span>
    );
  }
  if (status === "in-progress") {
    return (
      <span
        className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600"
        aria-label="Syncing"
      />
    );
  }
  return <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-slate-300" aria-label="Pending" />;
}

function PeerSyncPanel({
  statuses,
  current,
  syncing,
  done,
  tier,
  clearing,
  categoryStatsSummary,
  onRetryFailed,
  onClearAndResync,
}: {
  statuses: Record<string, CategorySyncStatus>;
  current: string | null;
  syncing: boolean;
  done: boolean;
  tier: 1 | 2;
  clearing: boolean;
  categoryStatsSummary: { category: string; avg_r3y: number | null }[] | null;
  onRetryFailed: () => void;
  onClearAndResync: () => void;
}) {
  const categories = Object.keys(statuses);
  const total = categories.length;
  const completed = categories.filter((c) => statuses[c] === "done" || statuses[c] === "failed").length;
  const hasFailures = categories.some((c) => statuses[c] === "failed");
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (total === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-800">
        {tier === 2 ? "Full sync — all categories" : "Refresh peer data — your categories"}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 text-xs font-medium text-slate-500">
          {completed}/{total}
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {syncing && current
          ? `Syncing ${current}... (${completed}/${total})`
          : done
            ? hasFailures
              ? "Sync finished with some failures."
              : "All categories synced!"
            : ""}
      </p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {categories.map((category) => (
          <span key={category} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <CategoryStatusIcon status={statuses[category]} />
            {category}
          </span>
        ))}
      </div>

      {!syncing && hasFailures && (
        <button
          type="button"
          onClick={onRetryFailed}
          className="mt-3 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Retry failed
        </button>
      )}

      {!syncing && done && categoryStatsSummary && categoryStatsSummary.length > 0 && (
        <div className="mt-3 rounded-md bg-blue-50 px-3 py-2">
          <p className="text-xs font-semibold text-slate-700">Category performance (3Y CAGR):</p>
          <p className="mt-1 text-xs text-slate-600">
            {categoryStatsSummary
              .map((c) => `${c.category}: ${c.avg_r3y !== null ? `${c.avg_r3y >= 0 ? "+" : ""}${c.avg_r3y.toFixed(1)}%` : "—"}`)
              .join(" | ")}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onClearAndResync}
        disabled={syncing || clearing}
        className="mt-3 block text-xs font-medium text-red-600 transition hover:underline disabled:cursor-not-allowed disabled:opacity-60"
      >
        {clearing ? "Clearing..." : "Clear & re-sync"}
      </button>
    </div>
  );
}

export default function SettingsClient({
  userEmail,
  initialSyncLog,
  heldGroups,
}: {
  userEmail: string;
  initialSyncLog: MFSyncLog[];
  heldGroups: string[];
}) {
  const [syncLog, setSyncLog] = useState<MFSyncLog[]>(initialSyncLog);
  const [toast, setToast] = useState<string | null>(null);

  const [peerSyncing, setPeerSyncing] = useState(false);
  const [peerSyncDone, setPeerSyncDone] = useState(false);
  const [peerSyncTier, setPeerSyncTier] = useState<1 | 2>(1);
  const [peerSyncCurrent, setPeerSyncCurrent] = useState<string | null>(null);
  const [peerCategoryStatus, setPeerCategoryStatus] = useState<Record<string, CategorySyncStatus>>({});
  const [peerClearing, setPeerClearing] = useState(false);
  const [categoryStatsSummary, setCategoryStatsSummary] = useState<
    { category: string; avg_r3y: number | null }[] | null
  >(null);

  const [navSyncing, setNavSyncing] = useState(false);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const refreshSyncLog = async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("mf_sync_log")
        .select("*")
        .order("run_at", { ascending: false })
        .limit(10);
      setSyncLog((data ?? []) as MFSyncLog[]);
    } catch (err) {
      console.error("Failed to refresh sync log:", err);
    }
  };

  const syncOneCategory = async (category: string, tier: 1 | 2): Promise<boolean> => {
    setPeerSyncCurrent(category);
    setPeerCategoryStatus((prev) => ({ ...prev, [category]: "in-progress" }));
    try {
      const res = await fetch("/api/mf/peers/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, tier }),
      });
      const json = await res.json();
      if (!res.ok || !json.processed) {
        throw new Error(json.error ?? `Failed to sync ${category}`);
      }
      setPeerCategoryStatus((prev) => ({ ...prev, [category]: "done" }));
      return true;
    } catch (err) {
      console.error(`Peer sync failed for ${category}:`, err);
      setPeerCategoryStatus((prev) => ({ ...prev, [category]: "failed" }));
      return false;
    }
  };

  const fetchCategoryStatsSummary = async () => {
    try {
      const res = await fetch("/api/mf/peers/category-stats");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load category stats");
      const rows: { category: string; avg_r3y: number | null }[] = Array.isArray(json.data)
        ? json.data.map((r: { category: string; avg_r3y: number | null }) => ({
            category: r.category,
            avg_r3y: r.avg_r3y,
          }))
        : [];
      setCategoryStatsSummary(rows);
    } catch (err) {
      console.error("Failed to load category stats summary:", err);
    }
  };

  const runPeerSync = async (categories: string[], tier: 1 | 2) => {
    setPeerSyncing(true);
    setPeerSyncDone(false);
    setPeerSyncTier(tier);

    for (let i = 0; i < categories.length; i++) {
      await syncOneCategory(categories[i], tier);
      if (i < categories.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    setPeerSyncCurrent(null);
    setPeerSyncing(false);
    setPeerSyncDone(true);
    showToast(tier === 2 ? "Full sync complete!" : "Peer data refreshed!");

    if (tier === 2) {
      await fetchCategoryStatsSummary();
    }

    await refreshSyncLog();
  };

  const handleQuickSync = async () => {
    setPeerSyncDone(false);
    setCategoryStatsSummary(null);

    if (heldGroups.length === 0) {
      showToast("No held categories to sync yet");
      return;
    }

    const initialStatus: Record<string, CategorySyncStatus> = {};
    heldGroups.forEach((c) => {
      initialStatus[c] = "pending";
    });
    setPeerCategoryStatus(initialStatus);

    await runPeerSync(heldGroups, 1);
  };

  const handleFullSync = async () => {
    setPeerSyncDone(false);
    setCategoryStatsSummary(null);

    const initialStatus: Record<string, CategorySyncStatus> = {};
    ALL_CATEGORIES.forEach((c) => {
      initialStatus[c] = "pending";
    });
    setPeerCategoryStatus(initialStatus);

    await runPeerSync(ALL_CATEGORIES, 2);
  };

  const handleRetryFailed = async () => {
    const failedCategories = Object.entries(peerCategoryStatus)
      .filter(([, status]) => status === "failed")
      .map(([category]) => category);
    if (failedCategories.length === 0) return;
    await runPeerSync(failedCategories, peerSyncTier);
  };

  const handleClearAndResync = async () => {
    setPeerClearing(true);
    try {
      const res = await fetch("/api/mf/peers/clear", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to clear peer data");
      showToast(`Cleared ${json.deleted ?? 0} row(s)`);
    } catch (err) {
      console.error("Failed to clear peer data:", err);
      showToast("Failed to clear peer data");
    } finally {
      setPeerClearing(false);
    }
    if (peerSyncTier === 2) {
      await handleFullSync();
    } else {
      await handleQuickSync();
    }
  };

  const handleSyncNav = async () => {
    setNavSyncing(true);
    try {
      const res = await fetch("/api/mf/nav/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      showToast("NAV updated");
      await refreshSyncLog();
    } catch (err) {
      console.error("NAV sync failed:", err);
      showToast("NAV sync failed");
    } finally {
      setNavSyncing(false);
    }
  };

  const latestTier1Weekly = syncLog.find((l) => l.cron_name === "tier1-weekly") ?? null;
  const isStale = latestTier1Weekly
    ? Date.now() - new Date(latestTier1Weekly.run_at).getTime() > STALE_MS
    : true;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={userEmail} />

      {toast && (
        <div className="fixed right-4 top-4 z-50 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-slate-800">Settings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sync controls and sync history for NAV and peer comparison data.
          </p>
        </div>

        {/* Peer data */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-800">Peer data</h2>

          {isStale ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Stale — last sync was {formatRelativeTime(latestTier1Weekly?.run_at ?? null)}
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              Last synced {formatRelativeTime(latestTier1Weekly?.run_at ?? null)}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleQuickSync}
              disabled={peerSyncing}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {peerSyncing && peerSyncTier === 1 && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
              )}
              Refresh peer data
            </button>
            <button
              type="button"
              onClick={handleFullSync}
              disabled={peerSyncing}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {peerSyncing && peerSyncTier === 2 && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
              )}
              Full sync (all categories)
            </button>
          </div>

          <PeerSyncPanel
            statuses={peerCategoryStatus}
            current={peerSyncCurrent}
            syncing={peerSyncing}
            done={peerSyncDone}
            tier={peerSyncTier}
            clearing={peerClearing}
            categoryStatsSummary={categoryStatsSummary}
            onRetryFailed={handleRetryFailed}
            onClearAndResync={handleClearAndResync}
          />
        </div>

        {/* NAV data */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-800">NAV data</h2>
          <p className="mt-2 text-sm text-slate-500">
            Refreshes the latest NAV for every fund you hold. Runs automatically at 8 PM IST on
            weekdays.
          </p>
          <button
            type="button"
            onClick={handleSyncNav}
            disabled={navSyncing}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {navSyncing && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
            )}
            {navSyncing ? "Syncing..." : "Sync NAV now"}
          </button>
        </div>

        {/* Sync history */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-800">Recent sync history</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Rows updated</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {syncLog.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                      No sync runs yet.
                    </td>
                  </tr>
                ) : (
                  syncLog.map((log) => (
                    <tr key={log.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 text-slate-700">{log.cron_name}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            log.status === "success"
                              ? "bg-green-100 text-green-700"
                              : log.status === "partial"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                          }`}
                        >
                          {log.status ?? "unknown"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{log.rows_updated}</td>
                      <td className="px-3 py-2 text-slate-500">{formatRelativeTime(log.run_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
