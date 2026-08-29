"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import { createClient } from "@/lib/supabase/client";
import type { EnrichedMFHolding, MFHolding, Owner } from "@/types/mf";
import { CATEGORY_OPTIONS } from "@/lib/categoryOptions";
import { ALL_CATEGORIES } from "@/lib/peers/categoryUniverse";
import AlternativesPanel, { type AlternativesData } from "@/components/AlternativesPanel";

type OwnerFilter = "family" | "praveen" | "geetha";
type Period = "6m" | "1y" | "3y" | "5y";
type GroupOwner = Owner | "mixed";
type CategorySyncStatus = "pending" | "in-progress" | "done" | "failed";

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

// Main grouped-fund row: 4 columns on mobile (<md), 9 on md+. The 5 desktop-only
// columns (Owner, Category, Current ₹, {period} Return, Peer rank) are hidden
// via `hidden md:...` on the cells themselves — they sit in DOM order between
// Fund name and Invested ₹/P&L/Actions, so hiding them still leaves the 4
// mobile columns lining up against the 4-track mobile grid.
const MAIN_GRID =
  "grid grid-cols-[minmax(0,1fr)_92px_140px_84px] md:grid-cols-[minmax(200px,2fr)_56px_96px_96px_96px_140px_76px_76px_150px]";

// Individual lot sub-row: Date | Owner | Invested ₹ | Current ₹ | P&L | Avg NAV | Units | Actions
const SUB_GRID = "grid grid-cols-[90px_56px_96px_96px_140px_84px_84px_96px]";

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

export interface HoldingGroup {
  key: string;
  scheme_code: string | null;
  scheme_name: string;
  category: string;
  amc: string | null;
  owner: GroupOwner;
  lots: HoldingWithPeer[];
  total_invested: number;
  total_units: number;
  avg_nav: number;
  current_value: number;
  pnl: number;
  pnl_pct: number;
  lot_count: number;
  earliest_date: string;
  latest_date: string;
  peer: PeerInfo | null;
}

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

function formatDateDMY(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (y && m && d) return `${d}-${m}-${y}`;
  return iso;
}

function formatNav(n: number): string {
  return n.toFixed(2);
}

function formatUnits(n: number): string {
  return parseFloat(n.toFixed(3)).toString();
}

// Manually-added funds without a real mfapi.in code get a `manual-<ts>`
// placeholder from the API (see POST /api/mf/holdings) — every new lot gets
// its own placeholder, so grouping by scheme_code would never merge them.
// Fall back to grouping by scheme name for those instead.
function hasRealSchemeCode(schemeCode: string | null | undefined): schemeCode is string {
  return !!schemeCode && !schemeCode.startsWith("manual-");
}

function groupKeyFor(h: EnrichedMFHolding): string {
  return hasRealSchemeCode(h.scheme_code)
    ? `code:${h.scheme_code}`
    : `name:${h.scheme_name.trim().toLowerCase()}`;
}

function rankBadgeTone(rank: number, peerCount: number) {
  const pct = rank / peerCount;
  if (pct <= 0.25) return "bg-green-100 text-green-700";
  if (pct <= 0.5) return "bg-blue-100 text-blue-700";
  if (pct <= 0.75) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

type SignalDot = "hold" | "watch" | "switch";

// Cheap client-side approximation of the alternatives panel's rule-based
// signal, using the fund's own 1Y rank/peer_count (already loaded) so the
// dashboard doesn't need an extra API call per row just to show a dot.
function computeSignalDot(rank: number | null, peerCount: number | null): SignalDot | null {
  if (!rank || !peerCount) return null;
  const pct = rank / peerCount;
  if (pct <= 0.25) return "hold";
  if (pct <= 0.5) return "watch";
  return "switch";
}

function SignalDot({ signal }: { signal: SignalDot }) {
  const color =
    signal === "hold" ? "bg-green-500" : signal === "watch" ? "bg-amber-500" : "bg-red-500";
  const label =
    signal === "hold" ? "Hold — strong performer" : signal === "watch" ? "Watch — moderate underperformance" : "Consider switching";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} title={label} />;
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

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path
        d="M7 4l6 6-6 6"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path
        d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path
        d="M8 5H5a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3M11 4h5v5M9 11l6.5-6.5"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

function OwnerBadge({ owner }: { owner: GroupOwner }) {
  if (owner === "mixed") {
    return (
      <span className="inline-flex h-6 items-center rounded-full bg-slate-200 px-2 text-[10px] font-semibold text-slate-700">
        P+G
      </span>
    );
  }
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
        owner === "praveen" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      {owner === "praveen" ? "P" : "G"}
    </span>
  );
}

interface EditDraft {
  owner: Owner;
  category: string;
  invested_amount: string;
  as_on_date: string;
  avg_nav: string;
  units: string;
}

interface AddLotDraft {
  owner: Owner;
  invested_amount: string;
  as_on_date: string;
  avg_nav: string;
  units: string;
  manualMode: boolean;
  navLoading: boolean;
  navError: string | null;
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
  onDismiss,
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
  onDismiss: () => void;
}) {
  const categories = Object.keys(statuses);
  const total = categories.length;
  const completed = categories.filter(
    (c) => statuses[c] === "done" || statuses[c] === "failed"
  ).length;
  const hasFailures = categories.some((c) => statuses[c] === "failed");
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">
          {tier === 2 ? "Full sync — all categories" : "Quick sync — your categories"}
        </p>
        {!syncing && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs font-medium text-slate-400 hover:text-slate-600"
          >
            Dismiss
          </button>
        )}
      </div>

      {tier === 2 && (
        <p className="mt-1 text-xs text-slate-500">
          Full sync updates AI recommendation data for all fund categories
        </p>
      )}

      {total > 0 && (
        <>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
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
                  : "All categories synced! Refreshing..."
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
        </>
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

  const [peerSyncMenuOpen, setPeerSyncMenuOpen] = useState(false);
  const [peerSyncPanelOpen, setPeerSyncPanelOpen] = useState(false);
  const [peerSyncing, setPeerSyncing] = useState(false);
  const [peerSyncDone, setPeerSyncDone] = useState(false);
  const [peerSyncTier, setPeerSyncTier] = useState<1 | 2>(1);
  const [peerSyncCurrent, setPeerSyncCurrent] = useState<string | null>(null);
  const [peerCategoryStatus, setPeerCategoryStatus] = useState<Record<string, CategorySyncStatus>>({});
  const [peerClearing, setPeerClearing] = useState(false);
  const [categoryStatsSummary, setCategoryStatsSummary] = useState<
    { category: string; avg_r3y: number | null }[] | null
  >(null);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const [selectedFund, setSelectedFund] = useState<HoldingGroup | null>(null);
  const [panelData, setPanelData] = useState<AlternativesData | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);

  // --- Edit lot ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editNavLoading, setEditNavLoading] = useState(false);
  const [savedFlashId, setSavedFlashId] = useState<string | null>(null);
  const editOriginalRef = useRef<{ date: string; avg_nav: string; units: string } | null>(null);

  // --- Add lot ---
  const [addLotGroupKey, setAddLotGroupKey] = useState<string | null>(null);
  const [addLotDraft, setAddLotDraft] = useState<AddLotDraft | null>(null);
  const [addLotSaving, setAddLotSaving] = useState(false);
  const [addLotError, setAddLotError] = useState<string | null>(null);

  // --- Delete lot ---
  const [deleteLotConfirmId, setDeleteLotConfirmId] = useState<string | null>(null);
  const [deleteLotDeleting, setDeleteLotDeleting] = useState(false);

  // --- Delete group ---
  const [deleteGroupConfirmKey, setDeleteGroupConfirmKey] = useState<string | null>(null);
  const [deleteGroupProgress, setDeleteGroupProgress] = useState<{ current: number; total: number } | null>(null);
  const [deleteGroupDeleting, setDeleteGroupDeleting] = useState(false);

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

  const groupedHoldings = useMemo<HoldingGroup[]>(() => {
    const map = new Map<string, HoldingGroup>();

    for (const h of filteredHoldings) {
      const key = groupKeyFor(h);
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          scheme_code: hasRealSchemeCode(h.scheme_code) ? h.scheme_code : null,
          scheme_name: h.scheme_name,
          category: h.category,
          amc: h.amc,
          owner: h.owner,
          lots: [],
          total_invested: 0,
          total_units: 0,
          avg_nav: 0,
          current_value: 0,
          pnl: 0,
          pnl_pct: 0,
          lot_count: 0,
          earliest_date: h.as_on_date,
          latest_date: h.as_on_date,
          peer: h.peer,
        };
        map.set(key, g);
      }
      g.lots.push(h);
      if (g.owner !== "mixed" && g.owner !== h.owner) g.owner = "mixed";
      if (h.as_on_date < g.earliest_date) g.earliest_date = h.as_on_date;
      if (h.as_on_date > g.latest_date) g.latest_date = h.as_on_date;
    }

    return Array.from(map.values())
      .map((g) => {
        const total_invested = g.lots.reduce((s, l) => s + Number(l.invested_amount), 0);
        const total_units = g.lots.reduce((s, l) => s + Number(l.units), 0);
        const current_value = g.lots.reduce((s, l) => s + Number(l.current_value), 0);
        const pnl = current_value - total_invested;
        return {
          ...g,
          total_invested,
          total_units,
          avg_nav: total_units > 0 ? total_invested / total_units : 0,
          current_value,
          pnl,
          pnl_pct: total_invested > 0 ? (pnl / total_invested) * 100 : 0,
          lot_count: g.lots.length,
        };
      })
      .sort((a, b) => b.total_invested - a.total_invested);
  }, [filteredHoldings]);

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

  // Syncs one category at the given tier, updating its status in
  // peerCategoryStatus as it goes. Returns true on success.
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
    setPeerSyncPanelOpen(true);

    for (let i = 0; i < categories.length; i++) {
      await syncOneCategory(categories[i], tier);
      // Pause between categories to be gentle on mfapi.in — skip after the last one.
      if (i < categories.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    setPeerSyncCurrent(null);
    setPeerSyncing(false);
    setPeerSyncDone(true);
    showToast(tier === 2 ? "Full sync complete!" : "Quick sync complete!");

    if (tier === 2) {
      await fetchCategoryStatsSummary();
    }

    setTimeout(() => {
      loadHoldings();
    }, 1000);
  };

  // Tier 1 "Quick sync" — only the categories the user actually holds funds
  // in, derived straight from already-loaded holdings (no extra API call).
  const handleQuickSync = async () => {
    setPeerSyncMenuOpen(false);
    setPeerSyncPanelOpen(true);
    setPeerSyncDone(false);
    setCategoryStatsSummary(null);

    const categories = Array.from(new Set(holdings.map((h) => h.category).filter(Boolean)));
    if (categories.length === 0) {
      showToast("No held categories to sync yet");
      setPeerSyncPanelOpen(false);
      return;
    }

    const initialStatus: Record<string, CategorySyncStatus> = {};
    categories.forEach((c) => {
      initialStatus[c] = "pending";
    });
    setPeerCategoryStatus(initialStatus);

    await runPeerSync(categories, 1);
  };

  // Tier 2 "Full sync" — every category in the universe, for the AI
  // recommendation engine's cross-category intelligence.
  const handleFullSync = async () => {
    setPeerSyncMenuOpen(false);
    setPeerSyncPanelOpen(true);
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

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandGroup = (key: string) => {
    setExpandedGroups((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  };

  // --- Better Alternatives panel ---

  const loadAlternatives = async (schemeCode: string) => {
    setPanelLoading(true);
    try {
      const res = await fetch(`/api/mf/alternatives/${schemeCode}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load alternatives");
      setPanelData(json.data as AlternativesData);
    } catch (err) {
      console.error("Failed to load alternatives:", err);
      setPanelData(null);
      showToast("Failed to load alternatives");
    } finally {
      setPanelLoading(false);
    }
  };

  const handleOpenAlternatives = (group: HoldingGroup) => {
    if (!group.scheme_code) {
      showToast("This fund has no scheme code to compare");
      return;
    }
    setSelectedFund(group);
    setPanelData(null);
    loadAlternatives(group.scheme_code);
  };

  const handleClosePanel = () => {
    setSelectedFund(null);
    setPanelData(null);
  };

  const handleSyncNowForPanel = async () => {
    if (!selectedFund) return;
    try {
      await fetch("/api/mf/peers/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: selectedFund.category, tier: 1 }),
      });
    } catch (err) {
      console.error("Failed to sync category for alternatives panel:", err);
    }
    if (selectedFund.scheme_code) {
      await loadAlternatives(selectedFund.scheme_code);
    }
  };

  // --- Edit lot handlers ---

  const handleStartEdit = (h: HoldingWithPeer) => {
    setEditingId(h.id);
    setEditDraft({
      owner: h.owner,
      category: h.category,
      invested_amount: String(h.invested_amount),
      as_on_date: h.as_on_date,
      avg_nav: String(h.avg_nav),
      units: String(h.units),
    });
    editOriginalRef.current = {
      date: h.as_on_date,
      avg_nav: String(h.avg_nav),
      units: String(h.units),
    };
    setEditError(null);
    setEditNavLoading(false);
  };

  const handleEditGroup = (group: HoldingGroup) => {
    expandGroup(group.key);
    const mostRecent = [...group.lots].sort((a, b) => (a.as_on_date < b.as_on_date ? 1 : -1))[0];
    if (mostRecent) handleStartEdit(mostRecent);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
    setEditError(null);
    setEditNavLoading(false);
    editOriginalRef.current = null;
  };

  // Recalculate NAV (and thus units) whenever the edited lot's date changes
  // away from its original value.
  useEffect(() => {
    if (!editingId || !editDraft) return;
    const lot = holdings.find((h) => h.id === editingId);
    if (!lot || !hasRealSchemeCode(lot.scheme_code)) return;

    const original = editOriginalRef.current;
    if (original && editDraft.as_on_date === original.date) {
      if (editDraft.avg_nav !== original.avg_nav || editDraft.units !== original.units) {
        setEditDraft((prev) =>
          prev ? { ...prev, avg_nav: original.avg_nav, units: original.units } : prev
        );
      }
      return;
    }

    let cancelled = false;
    const schemeCode = lot.scheme_code;
    const targetDate = editDraft.as_on_date;

    const run = async () => {
      setEditNavLoading(true);
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        const tryDate = shiftDate(targetDate, -attempt);
        try {
          const res = await fetch(`/api/mf/nav/${schemeCode}?date=${tryDate}`);
          if (res.ok) {
            const json = await res.json();
            const nav = Number(json?.data?.nav);
            if (Number.isFinite(nav) && nav > 0 && !cancelled) {
              setEditDraft((prev) => (prev ? { ...prev, avg_nav: String(nav) } : prev));
              setEditNavLoading(false);
              return;
            }
          }
        } catch {
          // try an earlier date
        }
      }
      if (!cancelled) setEditNavLoading(false);
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, editDraft?.as_on_date]);

  // Derive units from invested amount ÷ NAV while editing.
  useEffect(() => {
    if (!editDraft) return;
    const amt = Number(editDraft.invested_amount);
    const nav = Number(editDraft.avg_nav);
    if (Number.isFinite(amt) && amt > 0 && Number.isFinite(nav) && nav > 0) {
      const computed = (amt / nav).toFixed(4);
      setEditDraft((prev) => (prev && prev.units !== computed ? { ...prev, units: computed } : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDraft?.invested_amount, editDraft?.avg_nav]);

  const handleSaveEdit = async (h: HoldingWithPeer) => {
    if (!editDraft) return;

    const investedAmount = Number(editDraft.invested_amount);
    const avgNav = Number(editDraft.avg_nav);
    const units = Number(editDraft.units);

    if (!Number.isFinite(investedAmount) || investedAmount <= 0) {
      setEditError("Invested amount must be a positive number");
      return;
    }
    if (!editDraft.as_on_date) {
      setEditError("As on date is required");
      return;
    }
    if (editDraft.as_on_date > todayIso()) {
      setEditError("Purchase date cannot be in the future");
      return;
    }
    if (!Number.isFinite(avgNav) || avgNav <= 0) {
      setEditError("NAV must be a positive number");
      return;
    }
    if (!Number.isFinite(units) || units <= 0) {
      setEditError("Units must be a positive number");
      return;
    }
    if (!editDraft.category.trim()) {
      setEditError("Category is required");
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
          category: editDraft.category,
          invested_amount: investedAmount,
          as_on_date: editDraft.as_on_date,
          avg_nav: avgNav,
          units,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");

      const updated = json.data as MFHolding;

      setHoldings((prev) =>
        prev.map((row) => {
          if (row.id !== h.id) return row;
          const newInvested = Number(updated.invested_amount);
          const newUnits = Number(updated.units);
          const newCurrentValue = newUnits * row.current_nav;
          const newPnl = newCurrentValue - newInvested;
          const newPnlPct = newInvested > 0 ? (newPnl / newInvested) * 100 : 0;
          return {
            ...row,
            owner: updated.owner,
            category: updated.category,
            invested_amount: newInvested,
            as_on_date: updated.as_on_date,
            avg_nav: Number(updated.avg_nav),
            units: newUnits,
            current_value: newCurrentValue,
            pnl: newPnl,
            pnl_pct: newPnlPct,
          };
        })
      );

      setEditingId(null);
      setEditDraft(null);
      editOriginalRef.current = null;
      setSavedFlashId(h.id);
      setTimeout(() => setSavedFlashId(null), 1500);
    } catch (err) {
      console.error("Failed to save holding edit:", err);
      setEditError("Failed to save");
    } finally {
      setEditSaving(false);
    }
  };

  // --- Add lot handlers ---

  const handleOpenAddLot = (group: HoldingGroup) => {
    expandGroup(group.key);
    const canAutoFetch = !!group.scheme_code;
    setAddLotGroupKey(group.key);
    setAddLotDraft({
      owner: group.owner !== "mixed" ? group.owner : "praveen",
      invested_amount: "",
      as_on_date: daysAgoIso(30),
      avg_nav: "",
      units: "",
      manualMode: !canAutoFetch,
      navLoading: false,
      navError: null,
    });
    setAddLotError(null);
  };

  const handleCancelAddLot = () => {
    setAddLotGroupKey(null);
    setAddLotDraft(null);
    setAddLotError(null);
  };

  const switchAddLotToManual = () => {
    setAddLotDraft((prev) =>
      prev ? { ...prev, manualMode: true, navLoading: false, navError: null } : prev
    );
  };

  const switchAddLotToAutoFetch = () => {
    setAddLotDraft((prev) =>
      prev ? { ...prev, manualMode: false, avg_nav: "", units: "", navError: null } : prev
    );
  };

  // Auto-fetch NAV for the add-lot form whenever the fund or date changes.
  useEffect(() => {
    if (!addLotGroupKey || !addLotDraft || addLotDraft.manualMode) return;
    const group = groupedHoldings.find((g) => g.key === addLotGroupKey);
    if (!group || !group.scheme_code) return;
    if (addLotDraft.as_on_date > todayIso()) return;

    let cancelled = false;
    const schemeCode = group.scheme_code;
    const targetDate = addLotDraft.as_on_date;

    const run = async () => {
      setAddLotDraft((prev) => (prev ? { ...prev, navLoading: true, navError: null, avg_nav: "" } : prev));
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        const tryDate = shiftDate(targetDate, -attempt);
        try {
          const res = await fetch(`/api/mf/nav/${schemeCode}?date=${tryDate}`);
          if (res.ok) {
            const json = await res.json();
            const nav = Number(json?.data?.nav);
            if (Number.isFinite(nav) && nav > 0 && !cancelled) {
              setAddLotDraft((prev) =>
                prev ? { ...prev, avg_nav: String(nav), navLoading: false, navError: null } : prev
              );
              return;
            }
          }
        } catch {
          // try an earlier date
        }
      }
      if (!cancelled) {
        setAddLotDraft((prev) =>
          prev ? { ...prev, navLoading: false, navError: "NAV not found nearby — enter manually" } : prev
        );
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLotGroupKey, addLotDraft?.as_on_date, addLotDraft?.manualMode]);

  // Derive units for the add-lot form from invested amount ÷ NAV.
  useEffect(() => {
    if (!addLotDraft || addLotDraft.manualMode) return;
    const amt = Number(addLotDraft.invested_amount);
    const nav = Number(addLotDraft.avg_nav);
    if (Number.isFinite(amt) && amt > 0 && Number.isFinite(nav) && nav > 0) {
      const computed = (amt / nav).toFixed(4);
      setAddLotDraft((prev) => (prev && prev.units !== computed ? { ...prev, units: computed } : prev));
    } else {
      setAddLotDraft((prev) => (prev && prev.units !== "" ? { ...prev, units: "" } : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLotDraft?.invested_amount, addLotDraft?.avg_nav, addLotDraft?.manualMode]);

  const handleSaveAddLot = async (group: HoldingGroup) => {
    if (!addLotDraft) return;

    const invested = Number(addLotDraft.invested_amount);
    const avgNav = Number(addLotDraft.avg_nav);
    const units = Number(addLotDraft.units);

    if (!Number.isFinite(invested) || invested <= 0) {
      setAddLotError("Invested amount must be a positive number");
      return;
    }
    if (!addLotDraft.as_on_date) {
      setAddLotError("As on date is required");
      return;
    }
    if (addLotDraft.as_on_date > todayIso()) {
      setAddLotError("Purchase date cannot be in the future");
      return;
    }
    if (!Number.isFinite(avgNav) || avgNav <= 0) {
      setAddLotError("NAV must be a positive number");
      return;
    }
    if (!Number.isFinite(units) || units <= 0) {
      setAddLotError("Units must be a positive number");
      return;
    }

    setAddLotSaving(true);
    setAddLotError(null);
    try {
      const res = await fetch("/api/mf/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: addLotDraft.owner,
          scheme_code: group.scheme_code,
          scheme_name: group.scheme_name,
          category: group.category,
          amc: group.amc,
          units,
          avg_nav: avgNav,
          invested_amount: invested,
          as_on_date: addLotDraft.as_on_date,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to add lot");

      const created = json.data as MFHolding;
      const currentValue = units * avgNav;
      const newLot: HoldingWithPeer = {
        ...created,
        current_nav: avgNav,
        nav_date: created.as_on_date,
        current_value: currentValue,
        pnl: currentValue - invested,
        pnl_pct: invested > 0 ? ((currentValue - invested) / invested) * 100 : 0,
        peer: group.peer,
      };

      setHoldings((prev) => [...prev, newLot]);
      handleCancelAddLot();
      showToast("Lot added");
    } catch (err) {
      console.error("Failed to add lot:", err);
      setAddLotError("Failed to add lot");
    } finally {
      setAddLotSaving(false);
    }
  };

  // --- Delete lot handlers ---

  const handleConfirmDeleteLot = async (h: HoldingWithPeer) => {
    setDeleteLotDeleting(true);
    try {
      const res = await fetch(`/api/mf/holdings/${h.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to delete");
      }
      setHoldings((prev) => prev.filter((row) => row.id !== h.id));
      setDeleteLotConfirmId(null);
      showToast("Lot deleted");
    } catch (err) {
      console.error("Failed to delete lot:", err);
      showToast("Failed to delete lot");
    } finally {
      setDeleteLotDeleting(false);
    }
  };

  // --- Delete group handlers ---

  const handleConfirmDeleteGroup = async (group: HoldingGroup) => {
    setDeleteGroupDeleting(true);
    const ids = group.lots.map((l) => l.id);
    const deletedIds: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      setDeleteGroupProgress({ current: i + 1, total: ids.length });
      try {
        const res = await fetch(`/api/mf/holdings/${ids[i]}`, { method: "DELETE" });
        if (res.ok) deletedIds.push(ids[i]);
      } catch (err) {
        console.error(`Failed to delete lot ${ids[i]}:`, err);
      }
    }

    setHoldings((prev) => prev.filter((row) => !deletedIds.includes(row.id)));
    setDeleteGroupConfirmKey(null);
    setDeleteGroupProgress(null);
    setDeleteGroupDeleting(false);
    showToast(
      deletedIds.length === ids.length
        ? "All lots deleted"
        : `Deleted ${deletedIds.length} of ${ids.length} lots`
    );
  };

  const deleteGroupTarget = groupedHoldings.find((g) => g.key === deleteGroupConfirmKey) ?? null;

  const periodLabel = PERIODS.find((p) => p.id === period)?.label ?? "1Y";
  const returnKey = periodReturnKey(period);
  const rankKey = periodRankKey(period);

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
            <div className="flex items-center gap-2">
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
              <div className="relative">
                <button
                  onClick={() => setPeerSyncMenuOpen((prev) => !prev)}
                  disabled={peerSyncing}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {peerSyncing && (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                  )}
                  {peerSyncing ? "Syncing..." : "Sync peers"}
                </button>

                {peerSyncMenuOpen && !peerSyncing && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setPeerSyncMenuOpen(false)}
                    />
                    <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                      <button
                        type="button"
                        onClick={handleQuickSync}
                        className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <span className="text-sm font-medium text-slate-800">⚡ Quick sync</span>
                        <span className="text-xs text-slate-400">Held categories only (~30 seconds)</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleFullSync}
                        className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <span className="text-sm font-medium text-slate-800">🔄 Full sync</span>
                        <span className="text-xs text-slate-400">All categories for AI (~3 minutes)</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Last synced: {lastSynced ? new Date(lastSynced).toLocaleString("en-IN") : "—"}
            </p>
          </div>
        </div>

        {peerSyncPanelOpen && (
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
            <div className="mx-auto max-w-6xl">
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
                onDismiss={() => setPeerSyncPanelOpen(false)}
              />
            </div>
          </div>
        )}
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

            {deleteGroupTarget && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm text-red-700">
                  Delete all {deleteGroupTarget.lot_count} lots of{" "}
                  <span className="font-semibold">{deleteGroupTarget.scheme_name}</span> totalling{" "}
                  {formatInr(deleteGroupTarget.total_invested)}? This cannot be undone.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleConfirmDeleteGroup(deleteGroupTarget)}
                    disabled={deleteGroupDeleting}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deleteGroupDeleting && deleteGroupProgress
                      ? `Deleting ${deleteGroupProgress.current} of ${deleteGroupProgress.total}...`
                      : "Yes, delete all"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteGroupConfirmKey(null)}
                    disabled={deleteGroupDeleting}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <div>
                <div className={`${MAIN_GRID} items-center gap-2 border-b border-slate-200 px-4 py-2 text-xs text-slate-500`}>
                  <span className="font-medium">Fund name</span>
                  <span className="hidden font-medium md:block">Owner</span>
                  <span className="hidden font-medium md:block">Category</span>
                  <span className="font-medium">Invested ₹</span>
                  <span className="hidden font-medium md:block">Current ₹</span>
                  <span className="font-medium">P&L</span>
                  <span className="hidden font-medium md:block">{periodLabel} Return</span>
                  <span className="hidden font-medium md:block">Peer rank</span>
                  <span className="text-right font-medium">Actions</span>
                </div>

                {groupedHoldings.map((group) => {
                  const isExpanded = expandedGroups.has(group.key);
                  const returnValue = group.peer ? group.peer[returnKey] : null;
                  const rankValue = group.peer ? group.peer[rankKey] : null;
                  const peerCount = group.peer?.peer_count ?? null;
                  const signalDot = computeSignalDot(group.peer?.rank_1y ?? null, peerCount);
                  const groupPnlPct = group.pnl_pct;
                  const sortedLots = [...group.lots].sort((a, b) =>
                    a.as_on_date < b.as_on_date ? -1 : a.as_on_date > b.as_on_date ? 1 : 0
                  );

                  return (
                    <div key={group.key} className="border-b border-slate-100 last:border-0">
                      <div
                        className={`${MAIN_GRID} items-center gap-2 px-4 py-3 text-sm transition-colors hover:bg-slate-50`}
                      >
                        <div className="flex min-w-0 items-start gap-1.5" title={group.scheme_name}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.key)}
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
                          >
                            <span
                              className={`inline-block transition-transform duration-200 ${
                                isExpanded ? "rotate-90" : "rotate-0"
                              }`}
                            >
                              <ChevronIcon />
                            </span>
                          </button>

                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => handleOpenAlternatives(group)}
                              className="line-clamp-2 cursor-pointer text-left text-sm font-semibold text-slate-800 hover:text-blue-600"
                              title="View better alternatives"
                            >
                              {group.scheme_name}
                            </button>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              {group.scheme_code && (
                                <Link
                                  href={`/fund/${group.scheme_code}`}
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label="View fund details"
                                  className="shrink-0 text-slate-300 hover:text-blue-600"
                                >
                                  <ExternalLinkIcon />
                                </Link>
                              )}
                              {group.lot_count > 1 && (
                                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                                  {group.lot_count} lots
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="hidden md:flex md:items-center">
                          <OwnerBadge owner={group.owner} />
                        </div>
                        <span className="hidden truncate text-slate-600 md:block">{group.category}</span>
                        <span className="text-slate-800">{formatInr(group.total_invested)}</span>
                        <span className="hidden text-slate-800 md:block">{formatInr(group.current_value)}</span>
                        <span className={`font-medium ${group.pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {group.pnl >= 0 ? "+" : "-"}
                          {formatInr(Math.abs(group.pnl))} ({groupPnlPct >= 0 ? "+" : ""}
                          {groupPnlPct.toFixed(2)}%)
                        </span>
                        <span
                          className={`hidden font-medium md:block ${
                            returnValue === null
                              ? "text-slate-400"
                              : returnValue >= 0
                                ? "text-green-600"
                                : "text-red-600"
                          }`}
                        >
                          {formatPct(returnValue)}
                        </span>
                        <div className="hidden md:flex md:items-center md:gap-1.5">
                          {rankValue && peerCount ? (
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${rankBadgeTone(
                                rankValue,
                                peerCount
                              )}`}
                            >
                              #{rankValue}/{peerCount}
                            </span>
                          ) : (
                            <span
                              className="text-slate-300"
                              title="Click 'Sync peer data' to populate"
                            >
                              —
                            </span>
                          )}
                          {signalDot && <SignalDot signal={signalDot} />}
                        </div>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditGroup(group)}
                            aria-label="Edit most recent lot"
                            title="Edit most recent lot"
                            className="flex h-7 items-center gap-1 rounded-md px-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                          >
                            <PencilIcon />
                            <span className="hidden text-xs font-medium lg:inline">Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenAddLot(group)}
                            aria-label="Add lot"
                            title="Add lot"
                            className="flex h-7 items-center gap-1 rounded-md px-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-blue-600"
                          >
                            <PlusIcon />
                            <span className="hidden text-xs font-medium lg:inline">Add lot</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteGroupConfirmKey(group.key)}
                            aria-label="Delete all lots"
                            title="Delete all lots"
                            className="flex h-7 items-center gap-1 rounded-md px-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                          >
                            <TrashIcon />
                            <span className="hidden text-xs font-medium lg:inline">Delete</span>
                          </button>
                        </div>
                      </div>

                      <div
                        className={`overflow-hidden transition-all duration-200 ${
                          isExpanded ? "max-h-[500px]" : "max-h-0"
                        }`}
                      >
                        <div className="ml-4 border-l-2 border-slate-200 py-1 pl-4">
                            {sortedLots.map((lot) => {
                              const isEditingLot = editingId === lot.id;
                              const isSavedFlash = savedFlashId === lot.id;
                              const isDeleteConfirming = deleteLotConfirmId === lot.id;
                              const lotPnlPct =
                                lot.invested_amount > 0 ? (lot.pnl / lot.invested_amount) * 100 : 0;

                              if (isDeleteConfirming) {
                                return (
                                  <div
                                    key={lot.id}
                                    className="my-1 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2"
                                  >
                                    <p className="text-xs text-red-700">
                                      Delete lot of {formatInr(lot.invested_amount)} from{" "}
                                      {formatDateDMY(lot.as_on_date)}?
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleConfirmDeleteLot(lot)}
                                        disabled={deleteLotDeleting}
                                        className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        Confirm delete
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDeleteLotConfirmId(null)}
                                        disabled={deleteLotDeleting}
                                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                );
                              }

                              return (
                                <div key={lot.id}>
                                <div
                                  className={`${SUB_GRID} items-center gap-2 rounded py-2 pl-0 pr-2 text-xs transition-colors duration-700 ${
                                    isSavedFlash ? "bg-green-50" : ""
                                  }`}
                                >
                                  <span className="truncate text-slate-500">
                                    {isEditingLot && editDraft ? (
                                      <input
                                        type="date"
                                        value={editDraft.as_on_date}
                                        max={todayIso()}
                                        onChange={(e) =>
                                          setEditDraft({ ...editDraft, as_on_date: e.target.value })
                                        }
                                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                                      />
                                    ) : (
                                      formatDateDMY(lot.as_on_date)
                                    )}
                                  </span>
                                  <span>
                                    {isEditingLot && editDraft ? (
                                      <div className="inline-flex rounded-md border border-slate-200 p-0.5">
                                        <button
                                          type="button"
                                          onClick={() => setEditDraft({ ...editDraft, owner: "praveen" })}
                                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition ${
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
                                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition ${
                                            editDraft.owner === "geetha"
                                              ? "bg-amber-500 text-white"
                                              : "text-slate-500 hover:bg-slate-100"
                                          }`}
                                        >
                                          G
                                        </button>
                                      </div>
                                    ) : (
                                      <OwnerBadge owner={lot.owner} />
                                    )}
                                  </span>
                                  <span className="text-slate-700">
                                    {isEditingLot && editDraft ? (
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={editDraft.invested_amount}
                                        onChange={(e) =>
                                          setEditDraft({ ...editDraft, invested_amount: e.target.value })
                                        }
                                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                                      />
                                    ) : (
                                      formatInr(Number(lot.invested_amount))
                                    )}
                                  </span>
                                  <span className="text-slate-700">{formatInr(Number(lot.current_value))}</span>
                                  <span className={`font-medium ${lot.pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                                    {lot.pnl >= 0 ? "+" : "-"}
                                    {formatInr(Math.abs(lot.pnl))} ({lotPnlPct >= 0 ? "+" : ""}
                                    {lotPnlPct.toFixed(2)}%)
                                  </span>
                                  <span className="text-slate-500">
                                    {isEditingLot ? (
                                      editNavLoading ? (
                                        <span className="inline-block h-3 w-10 animate-pulse rounded bg-slate-200" />
                                      ) : (
                                        `₹${formatNav(Number(editDraft?.avg_nav ?? lot.avg_nav))}`
                                      )
                                    ) : (
                                      `₹${formatNav(Number(lot.avg_nav))}`
                                    )}
                                  </span>
                                  <span className="text-slate-500">
                                    {isEditingLot ? (
                                      editNavLoading ? (
                                        <span className="inline-block h-3 w-10 animate-pulse rounded bg-slate-200" />
                                      ) : (
                                        formatUnits(Number(editDraft?.units ?? lot.units))
                                      )
                                    ) : (
                                      formatUnits(Number(lot.units))
                                    )}
                                  </span>
                                  <span className="flex items-center justify-end gap-1">
                                    {isEditingLot ? (
                                      <div className="flex flex-col items-end gap-1">
                                        <div className="flex items-center gap-1">
                                          <button
                                            type="button"
                                            onClick={() => handleSaveEdit(lot)}
                                            disabled={editSaving || editNavLoading}
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
                                          <span className="text-[10px] font-medium text-red-600">{editError}</span>
                                        )}
                                      </div>
                                    ) : (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => handleStartEdit(lot)}
                                          aria-label="Edit lot"
                                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                                        >
                                          <PencilIcon />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setDeleteLotConfirmId(lot.id)}
                                          aria-label="Delete lot"
                                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                                        >
                                          <TrashIcon />
                                        </button>
                                      </>
                                    )}
                                  </span>
                                </div>
                                {isEditingLot && editDraft && (
                                  <div className="mb-1 flex items-center gap-2 pb-1 pl-1">
                                    <label className="text-[10px] font-medium text-slate-500">
                                      Category
                                    </label>
                                    <select
                                      value={editDraft.category}
                                      onChange={(e) =>
                                        setEditDraft({ ...editDraft, category: e.target.value })
                                      }
                                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                                    >
                                      {CATEGORY_OPTIONS.map((c) => (
                                        <option key={c} value={c}>
                                          {c}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                                </div>
                              );
                            })}

                            {addLotGroupKey === group.key && addLotDraft && (
                              <div className="my-1 rounded-lg bg-blue-50 p-3">
                                <div className="flex flex-wrap items-end gap-3">
                                  <div>
                                    <label className="mb-1 block text-[10px] font-medium text-slate-600">
                                      Owner
                                    </label>
                                    <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
                                      <button
                                        type="button"
                                        onClick={() => setAddLotDraft({ ...addLotDraft, owner: "praveen" })}
                                        className={`rounded px-2 py-1 text-xs font-semibold transition ${
                                          addLotDraft.owner === "praveen"
                                            ? "bg-blue-600 text-white"
                                            : "text-slate-500 hover:bg-slate-100"
                                        }`}
                                      >
                                        P
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setAddLotDraft({ ...addLotDraft, owner: "geetha" })}
                                        className={`rounded px-2 py-1 text-xs font-semibold transition ${
                                          addLotDraft.owner === "geetha"
                                            ? "bg-amber-500 text-white"
                                            : "text-slate-500 hover:bg-slate-100"
                                        }`}
                                      >
                                        G
                                      </button>
                                    </div>
                                  </div>

                                  <div>
                                    <label className="mb-1 block text-[10px] font-medium text-slate-600">
                                      Invested ₹
                                    </label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={addLotDraft.invested_amount}
                                      onChange={(e) =>
                                        setAddLotDraft({ ...addLotDraft, invested_amount: e.target.value })
                                      }
                                      className="w-28 rounded border border-slate-300 px-2 py-1 text-xs"
                                    />
                                  </div>

                                  <div>
                                    <label className="mb-1 block text-[10px] font-medium text-slate-600">
                                      As on date
                                    </label>
                                    <input
                                      type="date"
                                      value={addLotDraft.as_on_date}
                                      max={todayIso()}
                                      onChange={(e) =>
                                        setAddLotDraft({ ...addLotDraft, as_on_date: e.target.value })
                                      }
                                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                                    />
                                  </div>

                                  <div>
                                    <label className="mb-1 block text-[10px] font-medium text-slate-600">
                                      Avg NAV (₹)
                                    </label>
                                    {addLotDraft.navLoading ? (
                                      <div className="flex h-[30px] w-24 items-center rounded border border-slate-200 bg-slate-100 px-2">
                                        <div className="h-3 w-12 animate-pulse rounded bg-slate-300" />
                                      </div>
                                    ) : addLotDraft.manualMode ? (
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.0001"
                                        value={addLotDraft.avg_nav}
                                        onChange={(e) =>
                                          setAddLotDraft({ ...addLotDraft, avg_nav: e.target.value })
                                        }
                                        placeholder="Enter NAV"
                                        className="w-24 rounded border border-slate-300 px-2 py-1 text-xs"
                                      />
                                    ) : (
                                      <input
                                        type="text"
                                        readOnly
                                        value={addLotDraft.avg_nav ? `₹${formatNav(Number(addLotDraft.avg_nav))}` : ""}
                                        placeholder="Auto-filled"
                                        className="w-24 cursor-not-allowed rounded border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-600"
                                      />
                                    )}
                                  </div>

                                  <div>
                                    <label className="mb-1 block text-[10px] font-medium text-slate-600">
                                      Units
                                    </label>
                                    {addLotDraft.navLoading ? (
                                      <div className="flex h-[30px] w-24 items-center rounded border border-slate-200 bg-slate-100 px-2">
                                        <div className="h-3 w-12 animate-pulse rounded bg-slate-300" />
                                      </div>
                                    ) : addLotDraft.manualMode ? (
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.0001"
                                        value={addLotDraft.units}
                                        onChange={(e) => setAddLotDraft({ ...addLotDraft, units: e.target.value })}
                                        placeholder="Enter units"
                                        className="w-24 rounded border border-slate-300 px-2 py-1 text-xs"
                                      />
                                    ) : (
                                      <input
                                        type="text"
                                        readOnly
                                        value={addLotDraft.units ? formatUnits(Number(addLotDraft.units)) : ""}
                                        placeholder="Auto-calculated"
                                        className="w-24 cursor-not-allowed rounded border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-600"
                                      />
                                    )}
                                  </div>

                                  {group.scheme_code && (
                                    <button
                                      type="button"
                                      onClick={addLotDraft.manualMode ? switchAddLotToAutoFetch : switchAddLotToManual}
                                      className="text-xs font-medium text-blue-600 hover:underline"
                                    >
                                      {addLotDraft.manualMode ? "Auto-fetch" : "Enter manually"}
                                    </button>
                                  )}

                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleSaveAddLot(group)}
                                      disabled={addLotSaving || addLotDraft.navLoading}
                                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {addLotSaving ? "Saving…" : "Save"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleCancelAddLot}
                                      disabled={addLotSaving}
                                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                                {(addLotError || addLotDraft.navError) && (
                                  <p className="mt-2 text-xs text-red-600">
                                    {addLotError ?? addLotDraft.navError}
                                  </p>
                                )}
                              </div>
                            )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

      </main>

      <AlternativesPanel
        isOpen={selectedFund !== null}
        onClose={handleClosePanel}
        fund={selectedFund}
        data={panelData}
        loading={panelLoading}
        onSyncNow={handleSyncNowForPanel}
      />
    </div>
  );
}
