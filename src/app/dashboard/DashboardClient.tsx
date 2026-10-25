"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { createClient } from "@/lib/supabase/client";
import type { EnrichedMFHolding, MFHolding, MFSIPSchedule, Owner } from "@/types/mf";
import { CATEGORY_OPTIONS } from "@/lib/categoryOptions";
import AlternativesPanel, { type AlternativesData } from "@/components/AlternativesPanel";
import { detectCategory } from "@/lib/analysis/fundCategoriser";
import { xirr, type Cashflow } from "@/lib/analysis/xirr";
import { nextSipAcross } from "@/lib/sipSchedule";
import {
  formatInrFull,
  formatInrShort,
  formatPct,
  formatSignedInrFull,
  GAIN_BG,
  LOSS_BG,
  toneText,
} from "@/lib/format";
import {
  MIN_XIRR_HOLDING_DAYS,
  PERIODS,
  displayFundName,
  periodRankKey,
  periodReturnKey,
  shortCategory,
  type ReturnMetric,
  type DayChange,
  type GroupOwner,
  type HistoryPoint,
  type HoldingGroup,
  type HoldingWithPeer,
  type OwnerFilter,
  type Period,
  type PeerInfo,
} from "./types";
import {
  ActionsMenu,
  AllocationCard,
  ChartsSkeleton,
  HeroCard,
  MoversCard,
  OwnerCompareStrip,
  StatCard,
  TableSkeleton,
  TopSectionSkeleton,
  ValueHistoryCard,
  type AllocationSlice,
  type ConcentrationWarning,
  type MoverRow,
  type OwnerSummary,
} from "./DashboardWidgets";

// AlternativesPanel imports this type from here.
export type { HoldingGroup } from "./types";

const OWNERS: { id: OwnerFilter; label: string }[] = [
  { id: "family", label: "Family" },
  { id: "praveen", label: "Praveen" },
  { id: "geetha", label: "Geetha" },
];

// Desktop holdings row: Fund | Value | NAV | P&L | Alloc | Return & rank | ⋯
const MAIN_GRID =
  "grid gap-2 grid-cols-[minmax(0,1fr)_116px_104px_148px_56px_136px_36px] lg:gap-3 lg:grid-cols-[minmax(0,1fr)_132px_112px_172px_64px_156px_40px]";

// Individual lot sub-row: Date | Owner | Invested ₹ | Current ₹ | P&L | Avg NAV | Units | Actions
const SUB_GRID = "grid grid-cols-[90px_56px_96px_96px_140px_84px_84px_96px]";

// Concentration thresholds for the hero card warning chips.
const FUND_CONCENTRATION_PCT = 15;
const CATEGORY_CONCENTRATION_PCT = 35;
// Exempt from the single-fund check (matched on scheme name or category).
const CASH_LIKE_FUND = /arbitrage|liquid|overnight|money\s*market/i;

type SortKey = "value" | "pnl_pct" | "allocation" | "return" | "rank";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { id: SortKey; label: string; defaultDir: SortDir }[] = [
  { id: "value", label: "Value", defaultDir: "desc" },
  { id: "pnl_pct", label: "P&L %", defaultDir: "desc" },
  { id: "allocation", label: "Allocation", defaultDir: "desc" },
  { id: "return", label: "Return", defaultDir: "desc" },
  { id: "rank", label: "Peer rank", defaultDir: "asc" },
];

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// A hung request (no response, no error — just silence) never resolves or
// rejects on its own, so without a timeout an `await fetch(...)` can block
// the calling async function forever, which in turn leaves `loading` stuck
// at true — the dashboard's "stuck in skeleton state" bug.
async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Portfolio XIRR from the lots on screen: each lot's invested amount is an
// outflow on its purchase date, and the combined current value is one inflow
// today. Lots left after a partial sell carry their remaining cost basis, so
// this is the XIRR of what's currently held. Returned as a percentage.
function portfolioXirrPct(lots: EnrichedMFHolding[]): number | null {
  if (lots.length === 0) return null;
  const flows: Cashflow[] = lots.map((l) => ({
    date: new Date(`${l.as_on_date}T00:00:00Z`),
    amount: -Number(l.invested_amount),
  }));
  const currentValue = lots.reduce((s, l) => s + Number(l.current_value), 0);
  flows.push({ date: new Date(`${todayIso()}T00:00:00Z`), amount: currentValue });
  const rate = xirr(flows);
  return rate === null ? null : rate * 100;
}

// Money-weighted average holding period: Σ invested × days held / Σ invested.
function avgHoldingDays(lots: EnrichedMFHolding[]): number | null {
  const today = new Date(`${todayIso()}T00:00:00Z`).getTime();
  let weighted = 0;
  let invested = 0;
  for (const l of lots) {
    const amount = Number(l.invested_amount);
    if (!(amount > 0)) continue;
    const days = Math.max(0, (today - new Date(`${l.as_on_date}T00:00:00Z`).getTime()) / 86400000);
    weighted += amount * days;
    invested += amount;
  }
  return invested > 0 ? weighted / invested : null;
}

// XIRR once the average lot has been held a year; absolute return before
// that (see ReturnMetric).
function portfolioReturnMetric(lots: EnrichedMFHolding[]): ReturnMetric {
  const avgDays = avgHoldingDays(lots);
  if (avgDays !== null && avgDays >= MIN_XIRR_HOLDING_DAYS) {
    return { kind: "xirr", pct: portfolioXirrPct(lots), avgHoldingDays: avgDays };
  }
  const invested = lots.reduce((s, l) => s + Number(l.invested_amount), 0);
  const value = lots.reduce((s, l) => s + Number(l.current_value), 0);
  return {
    kind: "absolute",
    pct: invested > 0 ? ((value - invested) / invested) * 100 : null,
    avgHoldingDays: avgDays,
  };
}

// How many funds trail their category average for `period` — falls back to
// 1Y when no fund has peer data for the chosen period yet.
function countBelowCategoryAvg(
  groups: HoldingGroup[],
  period: Period
): { below: number; compared: number; total: number; periodUsed: Period } {
  const countFor = (p: Period) => {
    const key = periodReturnKey(p);
    let below = 0;
    let compared = 0;
    for (const g of groups) {
      const own = g.peer?.[key];
      const avg = g.peer?.category_avg[key];
      if (own === null || own === undefined || avg === null || avg === undefined) continue;
      compared++;
      if (own < avg) below++;
    }
    return { below, compared };
  };
  let periodUsed = period;
  let result = countFor(period);
  if (result.compared === 0 && period !== "1y") {
    periodUsed = "1y";
    result = countFor("1y");
  }
  return { ...result, total: groups.length, periodUsed };
}

function formatDateDMY(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (y && m && d) return `${d}-${m}-${y}`;
  return iso;
}

const PEER_SYNC_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function formatAgo(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatNav(n: number): string {
  return n.toFixed(2);
}

// Scheme NAV for the holdings table: Indian grouping, 4 decimals below ₹10
// where the extra precision still moves the value.
function formatSchemeNav(n: number): string {
  const digits = n < 10 ? 4 : 2;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatNavDate(iso: string, withYear = true): string {
  return parseIsoDate(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

// A NAV this many days older than the newest one on the page is flagged
// (usually a fund whose sync failed).
const STALE_NAV_DAYS = 3;

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

// Below this many funds a rank says nothing (#1/1, #2/2) — shown neutral.
const MIN_PEERS_TO_RANK = 3;

// The single colour scale for peer rank (the pill is the only rank marker;
// the separate signal dot used different thresholds and was removed):
// top 25% emerald, top 50% blue, top 75% amber, bottom quartile rose.
function rankBadgeTone(rank: number, peerCount: number) {
  if (peerCount < MIN_PEERS_TO_RANK) return "bg-slate-100 text-slate-500";
  const pct = rank / peerCount;
  if (pct <= 0.25) return "bg-emerald-100 text-emerald-700";
  if (pct <= 0.5) return "bg-blue-100 text-blue-700";
  if (pct <= 0.75) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function sortValue(
  g: HoldingGroup,
  key: SortKey,
  returnKey: ReturnType<typeof periodReturnKey>,
  rankKey: ReturnType<typeof periodRankKey>
): number | null {
  switch (key) {
    case "value":
    case "allocation":
      return g.current_value;
    case "pnl_pct":
      return g.nav_missing ? null : g.pnl_pct;
    case "return":
      return g.peer?.[returnKey] ?? null;
    case "rank": {
      const rank = g.peer?.[rankKey];
      const count = g.peer?.peer_count;
      return rank && count ? rank / count : null;
    }
  }
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
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
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden>
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
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden>
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
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden>
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
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden>
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden>
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
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden>
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

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} aria-hidden>
      <path
        d="M16 10a6 6 0 01-10.3 4.2M4 10a6 6 0 0110.3-4.2M14.5 2.5v3.5H11M5.5 17.5V14H9"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth={1.6} />
      <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

function NavMissingBadge() {
  return (
    <span
      className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
      title="No NAV found for this fund's scheme code — value shown at cost and excluded from P&L % comparisons. Try Sync NAV."
    >
      NAV missing
    </span>
  );
}

function CategoryTag({ category }: { category: string }) {
  return (
    <span
      className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
      title={category}
    >
      {shortCategory(category)}
    </span>
  );
}

function OwnerBadge({ owner, size = "md" }: { owner: GroupOwner; size?: "sm" | "md" }) {
  const dims = size === "sm" ? "h-5 min-w-5 text-[10px]" : "h-6 min-w-6 text-xs";
  if (owner === "mixed") {
    return (
      <span
        className={`inline-flex ${dims} items-center rounded-full bg-slate-200 px-1.5 font-semibold text-slate-700`}
        title="Held by Praveen and Geetha"
      >
        P+G
      </span>
    );
  }
  return (
    <span
      className={`inline-flex ${dims} items-center justify-center rounded-full font-semibold ${
        owner === "praveen" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
      }`}
      title={owner === "praveen" ? "Praveen" : "Geetha"}
    >
      {owner === "praveen" ? "P" : "G"}
    </span>
  );
}

// Thin horizontal bar, length proportional to |P&L %| relative to the
// largest move in the table.
function PnlBar({ pct, maxAbs }: { pct: number; maxAbs: number }) {
  const width = maxAbs > 0 ? Math.min(100, (Math.abs(pct) / maxAbs) * 100) : 0;
  return (
    <div className="mt-1 h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-slate-100" aria-hidden>
      <div className={`h-full rounded-full ${pct >= 0 ? GAIN_BG : LOSS_BG}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function ReturnRank({
  group,
  returnKey,
  rankKey,
}: {
  group: HoldingGroup;
  returnKey: ReturnType<typeof periodReturnKey>;
  rankKey: ReturnType<typeof periodRankKey>;
}) {
  const returnValue = group.peer ? group.peer[returnKey] : null;
  const rankValue = group.peer ? group.peer[rankKey] : null;
  const peerCount = group.peer?.peer_count ?? null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`text-sm font-medium tabular-nums ${toneText(returnValue)}`}>{formatPct(returnValue)}</span>
      {rankValue && peerCount ? (
        <span
          className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${rankBadgeTone(
            rankValue,
            peerCount
          )}`}
          title={
            peerCount < MIN_PEERS_TO_RANK
              ? "Too few peers to rank"
              : `Rank ${rankValue} of ${peerCount} in its peer group`
          }
        >
          #{rankValue}/{peerCount}
        </span>
      ) : (
        <span className="text-xs text-slate-300" title="No peer rank yet — sync peer data in Settings">
          —
        </span>
      )}
    </div>
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

interface CategorySection {
  category: string;
  rows: HoldingGroup[];
  value: number;
  invested: number;
}

export default function DashboardClient({
  userEmail,
}: {
  userEmail: string;
}) {
  const router = useRouter();
  const [owner, setOwner] = useState<OwnerFilter>("family");
  const [period, setPeriod] = useState<Period>("1y");
  const [loading, setLoading] = useState(true);
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const [holdings, setHoldings] = useState<HoldingWithPeer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [peersLoading, setPeersLoading] = useState(false);

  const [syncingNav, setSyncingNav] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [peersLastSynced, setPeersLastSynced] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [history, setHistory] = useState<{ points: HistoryPoint[]; day_change: DayChange | null } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequestRef = useRef(0);

  const [sips, setSips] = useState<MFSIPSchedule[] | null>(null);

  // --- Holdings table controls ---
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [groupByCategory, setGroupByCategory] = useState(false);

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

    let base: EnrichedMFHolding[];
    try {
      const res = await fetchWithTimeout("/api/mf/holdings");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load holdings");
      base = Array.isArray(json.data) ? json.data : [];
    } catch (err) {
      console.error("Failed to load holdings:", err);
      setHoldings([]);
      setLoadError("Unable to load holdings right now.");
      setLoading(false);
      return;
    }

    // Holdings are the must-have — show them immediately and unblock the
    // skeleton. Peer comparison (period return, peer rank) is nice-to-have and
    // fetched below in the background; it renders "—" until it arrives, and
    // a failure there must never wipe out the holdings already on screen.
    setHoldings(base.map((h) => ({ ...h, peer: null })));
    setLoading(false);

    const schemeCodes = Array.from(new Set(base.map((h) => h.scheme_code)));
    if (schemeCodes.length === 0) return;

    const supabase = createClient();
    (async () => {
      try {
        const { data: navRows } = await supabase
          .from("mf_nav_cache")
          .select("fetched_at")
          .in("scheme_code", schemeCodes)
          .order("fetched_at", { ascending: false })
          .limit(1);
        setLastSynced(navRows?.[0]?.fetched_at ?? null);
      } catch (err) {
        console.error("Failed to load last-synced timestamp:", err);
      }
    })();

    (async () => {
      try {
        const { data: syncRows } = await supabase
          .from("mf_sync_log")
          .select("run_at")
          .eq("cron_name", "tier1-weekly")
          .order("run_at", { ascending: false })
          .limit(1);
        setPeersLastSynced(syncRows?.[0]?.run_at ?? null);
      } catch (err) {
        console.error("Failed to load peer sync timestamp:", err);
      }
    })();

    setPeersLoading(true);
    try {
      const peerResults = await Promise.allSettled(
        schemeCodes.map(async (code) => {
          const r = await fetchWithTimeout(`/api/mf/peers/${code}`);
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

      setHoldings((prev) => prev.map((h) => ({ ...h, peer: peerMap.get(h.scheme_code) ?? null })));
    } catch (err) {
      // Non-fatal — holdings are already showing; peer columns just stay "—".
      console.error("Failed to load peer comparison data:", err);
    } finally {
      setPeersLoading(false);
    }
  }, []);

  // Safety net: if loadHoldings somehow never settles (a hang the fetch
  // timeouts above don't catch), force the skeleton to clear after 15s
  // rather than leave the dashboard stuck indefinitely.
  useEffect(() => {
    let settled = false;
    const safetyTimer = setTimeout(() => {
      if (!settled) {
        setLoading(false);
        setLoadError("Loading timed out. Check your connection and try again.");
      }
    }, 15000);

    loadHoldings().finally(() => {
      settled = true;
      clearTimeout(safetyTimer);
    });

    return () => {
      settled = true;
      clearTimeout(safetyTimer);
    };
  }, [loadHoldings]);

  // Value-over-time series is computed server-side (NAV histories are too
  // heavy to ship here). Its own loading state, so a slow mfapi.in never
  // holds up the rest of the page. Stale responses (owner switched mid-flight)
  // are dropped.
  const loadHistory = useCallback(async (forOwner: OwnerFilter) => {
    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetchWithTimeout(`/api/mf/portfolio/history?owner=${forOwner}`, 12000);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load history");
      if (requestId !== historyRequestRef.current) return;
      setHistory({
        points: Array.isArray(json.data?.points) ? json.data.points : [],
        day_change: json.data?.day_change ?? null,
      });
    } catch (err) {
      console.error("Failed to load portfolio history:", err);
      if (requestId !== historyRequestRef.current) return;
      setHistory(null);
      setHistoryError("Couldn't load value history.");
    } finally {
      if (requestId === historyRequestRef.current) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory(owner);
  }, [owner, loadHistory]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithTimeout("/api/mf/sip");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load SIPs");
        setSips(Array.isArray(json.data) ? json.data : []);
      } catch (err) {
        console.error("Failed to load SIP schedules:", err);
        setSips([]);
      }
    })();
  }, []);

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
          nav_missing: false,
          current_nav: null,
          nav_date: null,
        };
        map.set(key, g);
      }
      g.lots.push(h);
      if (h.nav_missing) g.nav_missing = true;
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
        // Every lot of a scheme shares one NAV; take the freshest lot's.
        const navLot = g.nav_missing
          ? null
          : g.lots.reduce((best, l) => ((l.nav_date ?? "") > (best.nav_date ?? "") ? l : best), g.lots[0]);
        return {
          ...g,
          current_nav: navLot ? Number(navLot.current_nav) : null,
          nav_date: navLot ? navLot.nav_date : null,
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
    const returnMetric = portfolioReturnMetric(filteredHoldings);

    return { totalInvested, currentValue, pnl, pnlPct, returnMetric };
  }, [filteredHoldings]);

  // Counted per fund (groupedHoldings), not per lot — a fund bought via 12
  // SIP lots is still one underperformer. Follows the selected return period
  // when peer data for it exists, otherwise falls back to 1Y.
  const belowCategory = useMemo(
    () => countBelowCategoryAvg(groupedHoldings, period),
    [groupedHoldings, period]
  );

  const ownerSummaries = useMemo<OwnerSummary[]>(() => {
    return (["praveen", "geetha"] as const)
      .map((id) => {
        const lots = holdings.filter((h) => h.owner === id);
        const invested = lots.reduce((s, l) => s + Number(l.invested_amount), 0);
        const value = lots.reduce((s, l) => s + Number(l.current_value), 0);
        return {
          id,
          label: id === "praveen" ? "Praveen" : "Geetha",
          value,
          pnlPct: invested > 0 ? ((value - invested) / invested) * 100 : 0,
          returnMetric: portfolioReturnMetric(lots),
          lotCount: lots.length,
        };
      })
      .filter((s) => s.lotCount > 0);
  }, [holdings]);

  const nextSip = useMemo(() => {
    if (!sips) return null;
    const relevant = owner === "family" ? sips : sips.filter((s) => s.owner === owner);
    return nextSipAcross(relevant);
  }, [sips, owner]);

  // Portfolio Overview widgets derive from groupedHoldings (one entry per
  // fund, already summed across lots) rather than filteredHoldings (one
  // entry per individual lot) — otherwise a fund with many SIP lots would
  // show up as many separate slices/rows instead of one.
  const categoryAllocation = useMemo<AllocationSlice[]>(() => {
    const byCategory = new Map<string, number>();
    for (const g of groupedHoldings) {
      byCategory.set(g.category, (byCategory.get(g.category) ?? 0) + g.current_value);
    }
    const sorted = Array.from(byCategory.entries())
      .map(([category, value]) => ({ category, value }))
      .sort((a, b) => b.value - a.value);

    if (sorted.length <= 8) return sorted;

    const top = sorted.slice(0, 7);
    const othersTotal = sorted.slice(7).reduce((sum, c) => sum + c.value, 0);
    return [...top, { category: "Others", value: othersTotal }];
  }, [groupedHoldings]);

  const concentrationWarnings = useMemo<ConcentrationWarning[]>(() => {
    const total = kpis.currentValue;
    if (total <= 0) return [];
    const warnings: ConcentrationWarning[] = [];
    for (const g of groupedHoldings) {
      // Cash-like funds are often a deliberate large parking spot — not a
      // single-fund risk. They still count toward the category check below.
      if (CASH_LIKE_FUND.test(g.scheme_name) || CASH_LIKE_FUND.test(g.category)) continue;
      const pct = (g.current_value / total) * 100;
      if (pct > FUND_CONCENTRATION_PCT) {
        warnings.push({
          key: `fund:${g.key}`,
          label: `${displayFundName(g.scheme_name)} is ${pct.toFixed(0)}% of portfolio`,
          detail: `${g.scheme_name} is ${pct.toFixed(1)}% of this portfolio (above the ${FUND_CONCENTRATION_PCT}% single-fund guideline).`,
        });
      }
    }
    const byCategory = new Map<string, number>();
    for (const g of groupedHoldings) {
      byCategory.set(g.category, (byCategory.get(g.category) ?? 0) + g.current_value);
    }
    for (const [category, value] of Array.from(byCategory.entries())) {
      const pct = (value / total) * 100;
      if (pct > CATEGORY_CONCENTRATION_PCT) {
        warnings.push({
          key: `cat:${category}`,
          label: `${shortCategory(category)} is ${pct.toFixed(0)}% of portfolio`,
          detail: `${category} funds are ${pct.toFixed(1)}% of this portfolio (above the ${CATEGORY_CONCENTRATION_PCT}% single-category guideline).`,
        });
      }
    }
    return warnings;
  }, [groupedHoldings, kpis.currentValue]);

  // Funds without a NAV have a meaningless ~0% P&L — leave them out.
  const movers = useMemo(() => {
    const rows: MoverRow[] = groupedHoldings
      .filter((g) => !g.nav_missing && g.total_invested > 0)
      .map((g) => ({
        key: g.key,
        name: displayFundName(g.scheme_name),
        fullName: g.scheme_name,
        scheme_code: g.scheme_code,
        pnl: g.pnl,
        pnl_pct: g.pnl_pct,
      }));
    const gainers = rows
      .filter((r) => r.pnl_pct > 0)
      .sort((a, b) => b.pnl_pct - a.pnl_pct)
      .slice(0, 3);
    const losers = rows
      .filter((r) => r.pnl_pct < 0)
      .sort((a, b) => a.pnl_pct - b.pnl_pct)
      .slice(0, 3);
    return { gainers, losers };
  }, [groupedHoldings]);

  const hasAnyHoldings = holdings.length > 0;
  const portfolioValue = kpis.currentValue;
  const returnKey = periodReturnKey(period);
  const rankKey = periodRankKey(period);
  const periodLabel = PERIODS.find((p) => p.id === period)?.label ?? "1Y";

  const maxAbsPnlPct = useMemo(
    () =>
      groupedHoldings.reduce((m, g) => (g.nav_missing ? m : Math.max(m, Math.abs(g.pnl_pct))), 0),
    [groupedHoldings]
  );

  const newestNavDate = useMemo(
    () =>
      groupedHoldings.reduce<string | null>(
        (max, g) => (g.nav_date && (max === null || g.nav_date > max) ? g.nav_date : max),
        null
      ),
    [groupedHoldings]
  );

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q ? groupedHoldings.filter((g) => g.scheme_name.toLowerCase().includes(q)) : groupedHoldings;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sortKey, returnKey, rankKey);
      const bv = sortValue(b, sortKey, returnKey, rankKey);
      // Missing values always sink to the bottom, whatever the direction.
      if (av === null && bv === null) return b.current_value - a.current_value;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av === bv) return b.current_value - a.current_value;
      return (av - bv) * dir;
    });
  }, [groupedHoldings, search, sortKey, sortDir, returnKey, rankKey]);

  const categorySections = useMemo<CategorySection[]>(() => {
    if (!groupByCategory) return [];
    const map = new Map<string, CategorySection>();
    for (const g of tableRows) {
      const s = map.get(g.category) ?? { category: g.category, rows: [], value: 0, invested: 0 };
      s.rows.push(g);
      s.value += g.current_value;
      s.invested += g.total_invested;
      map.set(g.category, s);
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [groupByCategory, tableRows]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(SORT_OPTIONS.find((o) => o.id === key)?.defaultDir ?? "desc");
    }
  };

  const handleSyncNav = async () => {
    setSyncingNav(true);
    try {
      const res = await fetch("/api/mf/nav/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      const resolvedCount = Array.isArray(json.resolved) ? json.resolved.length : 0;
      showToast(
        resolvedCount > 0
          ? `NAV updated · matched ${resolvedCount} fund${resolvedCount === 1 ? "" : "s"} to a scheme code`
          : "NAV updated"
      );
      await loadHoldings();
      loadHistory(owner);
    } catch (err) {
      console.error("NAV sync failed:", err);
      showToast("NAV sync failed");
    } finally {
      setSyncingNav(false);
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
      loadHistory(owner);
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
      loadHistory(owner);
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
      loadHistory(owner);
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
    loadHistory(owner);
  };

  const deleteGroupTarget = groupedHoldings.find((g) => g.key === deleteGroupConfirmKey) ?? null;

  const isPeerSyncStale =
    !peersLastSynced || Date.now() - new Date(peersLastSynced).getTime() > PEER_SYNC_STALE_MS;

  const groupActions = (group: HoldingGroup) => [
    { label: "Edit", icon: <PencilIcon />, onSelect: () => handleEditGroup(group) },
    { label: "Add lot", icon: <PlusIcon />, onSelect: () => handleOpenAddLot(group) },
    ...(group.scheme_code
      ? [
          {
            label: "Fund details",
            icon: <ExternalLinkIcon />,
            onSelect: () => router.push(`/fund/${group.scheme_code}`),
          },
        ]
      : []),
    {
      label: "Delete",
      icon: <TrashIcon />,
      tone: "danger" as const,
      onSelect: () => {
        setDeleteGroupConfirmKey(group.key);
        window.scrollTo({ top: document.getElementById("holdings")?.offsetTop ?? 0, behavior: "smooth" });
      },
    },
  ];

  // --- Lot sub-rows + add-lot form, shared by the desktop table and mobile cards ---

  const renderLotsPanel = (group: HoldingGroup) => {
    const sortedLots = [...group.lots].sort((a, b) =>
      a.as_on_date < b.as_on_date ? -1 : a.as_on_date > b.as_on_date ? 1 : 0
    );
    return (
      <div className="overflow-x-auto">
        <div className="ml-4 min-w-max border-l-2 border-slate-200 py-1 pl-4">
          {sortedLots.map((lot) => {
            const isEditingLot = editingId === lot.id;
            const isSavedFlash = savedFlashId === lot.id;
            const isDeleteConfirming = deleteLotConfirmId === lot.id;
            const lotPnlPct = lot.invested_amount > 0 ? (lot.pnl / lot.invested_amount) * 100 : 0;

            if (isDeleteConfirming) {
              return (
                <div
                  key={lot.id}
                  className="my-1 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 px-3 py-2"
                >
                  <p className="text-xs text-rose-700">
                    Delete lot of {formatInrFull(lot.invested_amount)} from {formatDateDMY(lot.as_on_date)}?
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleConfirmDeleteLot(lot)}
                      disabled={deleteLotDeleting}
                      className="rounded-md bg-rose-600 px-2 py-1 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
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
                    isSavedFlash ? "bg-emerald-50" : ""
                  }`}
                >
                  <span className="truncate text-slate-500">
                    {isEditingLot && editDraft ? (
                      <input
                        type="date"
                        value={editDraft.as_on_date}
                        max={todayIso()}
                        onChange={(e) => setEditDraft({ ...editDraft, as_on_date: e.target.value })}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                        aria-label="Purchase date"
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
                            editDraft.owner === "praveen" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100"
                          }`}
                        >
                          P
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditDraft({ ...editDraft, owner: "geetha" })}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition ${
                            editDraft.owner === "geetha" ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-100"
                          }`}
                        >
                          G
                        </button>
                      </div>
                    ) : (
                      <OwnerBadge owner={lot.owner} />
                    )}
                  </span>
                  <span className="tabular-nums text-slate-700">
                    {isEditingLot && editDraft ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editDraft.invested_amount}
                        onChange={(e) => setEditDraft({ ...editDraft, invested_amount: e.target.value })}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                        aria-label="Invested amount"
                      />
                    ) : (
                      formatInrFull(Number(lot.invested_amount))
                    )}
                  </span>
                  <span className="tabular-nums text-slate-700">{formatInrFull(Number(lot.current_value))}</span>
                  {lot.nav_missing ? (
                    <span className="text-slate-400" title="No NAV — valued at cost">
                      —
                    </span>
                  ) : (
                    <span className={`font-medium tabular-nums ${toneText(lot.pnl)}`}>
                      {formatSignedInrFull(lot.pnl)} ({formatPct(lotPnlPct)})
                    </span>
                  )}
                  <span className="tabular-nums text-slate-500">
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
                  <span className="tabular-nums text-slate-500">
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
                        {editError && <span className="text-[10px] font-medium text-rose-600">{editError}</span>}
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
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <TrashIcon />
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {isEditingLot && editDraft && (
                  <div className="mb-1 flex flex-col gap-1 pb-1 pl-1">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-medium text-slate-500">Category</label>
                      <select
                        value={editDraft.category}
                        onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    {editDraft.category !== lot.category && (
                      <p className="pl-1 text-[10px] text-blue-600">
                        Detected: {detectCategory(lot.scheme_name).category}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {addLotGroupKey === group.key && addLotDraft && (
            <div className="my-1 max-w-3xl rounded-lg bg-blue-50 p-3">
              {(() => {
                const detected = detectCategory(group.scheme_name);
                const mismatch = detected.confidence !== "low" && detected.category !== group.category;
                if (!mismatch) return null;
                return (
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2 rounded-md bg-amber-50 px-2 py-1.5">
                    <p className="text-xs text-amber-700">
                      ⚠️ Category mismatch detected. This fund appears to be {detected.category} based on its
                      name. Edit the fund to correct it.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleEditGroup(group)}
                      className="shrink-0 text-xs font-semibold text-blue-600 hover:underline"
                    >
                      Fix category
                    </button>
                  </div>
                );
              })()}
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-slate-600">Category</label>
                  <div className="flex h-[30px] items-center rounded border border-slate-200 bg-white px-2 text-xs text-slate-600">
                    {group.category}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-medium text-slate-600">Owner</label>
                  <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
                    <button
                      type="button"
                      onClick={() => setAddLotDraft({ ...addLotDraft, owner: "praveen" })}
                      className={`rounded px-2 py-1 text-xs font-semibold transition ${
                        addLotDraft.owner === "praveen" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100"
                      }`}
                    >
                      P
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddLotDraft({ ...addLotDraft, owner: "geetha" })}
                      className={`rounded px-2 py-1 text-xs font-semibold transition ${
                        addLotDraft.owner === "geetha" ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-100"
                      }`}
                    >
                      G
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-medium text-slate-600">Invested ₹</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={addLotDraft.invested_amount}
                    onChange={(e) => setAddLotDraft({ ...addLotDraft, invested_amount: e.target.value })}
                    className="w-28 rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-medium text-slate-600">As on date</label>
                  <input
                    type="date"
                    value={addLotDraft.as_on_date}
                    max={todayIso()}
                    onChange={(e) => setAddLotDraft({ ...addLotDraft, as_on_date: e.target.value })}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-medium text-slate-600">Avg NAV (₹)</label>
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
                      onChange={(e) => setAddLotDraft({ ...addLotDraft, avg_nav: e.target.value })}
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
                  <label className="mb-1 block text-[10px] font-medium text-slate-600">Units</label>
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
                <p className="mt-2 text-xs text-rose-600">{addLotError ?? addLotDraft.navError}</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- Fund name block (name button, details link, tags) ---

  const renderFundIdentity = (group: HoldingGroup) => (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start gap-1">
        <button
          type="button"
          onClick={() => handleOpenAlternatives(group)}
          className="min-w-0 text-left text-sm font-semibold leading-snug text-slate-800 hover:text-blue-600 lg:line-clamp-2"
          title={`${group.scheme_name} — view better alternatives`}
        >
          {displayFundName(group.scheme_name)}
        </button>
        {group.scheme_code && (
          <Link
            href={`/fund/${group.scheme_code}`}
            aria-label={`${group.scheme_name} details`}
            className="mt-0.5 shrink-0 text-slate-300 hover:text-blue-600"
          >
            <ExternalLinkIcon />
          </Link>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <CategoryTag category={group.category} />
        {group.lot_count > 1 && (
          <span className="shrink-0 text-[10px] font-medium text-slate-500">{group.lot_count} lots</span>
        )}
        {owner === "family" && <OwnerBadge owner={group.owner} size="sm" />}
        {group.nav_missing && <NavMissingBadge />}
      </div>
    </div>
  );

  const renderExpandButton = (group: HoldingGroup, isExpanded: boolean) => (
    <button
      type="button"
      onClick={() => toggleGroup(group.key)}
      aria-label={isExpanded ? `Hide lots of ${group.scheme_name}` : `Show lots of ${group.scheme_name}`}
      aria-expanded={isExpanded}
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
    >
      <span className={`inline-block transition-transform duration-200 ${isExpanded ? "rotate-90" : "rotate-0"}`}>
        <ChevronIcon />
      </span>
    </button>
  );

  const allocationPct = (g: HoldingGroup) => (portfolioValue > 0 ? (g.current_value / portfolioValue) * 100 : 0);

  const isNavStale = (g: HoldingGroup) =>
    g.nav_date !== null &&
    newestNavDate !== null &&
    (parseIsoDate(newestNavDate).getTime() - parseIsoDate(g.nav_date).getTime()) / 86400000 > STALE_NAV_DAYS;

  const navTooltip = (g: HoldingGroup) =>
    `${g.nav_date ? `NAV as of ${formatNavDate(g.nav_date)}` : "NAV date unknown"} · ${formatUnits(g.total_units)} units`;

  const renderStaleNavDate = (g: HoldingGroup) =>
    isNavStale(g) && g.nav_date ? (
      <span className="ml-1 text-[10px] font-medium text-amber-600">{formatNavDate(g.nav_date, false)}</span>
    ) : null;

  const renderDesktopRow = (group: HoldingGroup) => {
    const isExpanded = expandedGroups.has(group.key);
    return (
      <div key={group.key} className="border-b border-slate-100 last:border-0">
        <div className={`${MAIN_GRID} items-center px-4 py-3 transition-colors hover:bg-slate-50/70`}>
          <div className="flex min-w-0 items-start gap-1.5">
            {renderExpandButton(group, isExpanded)}
            {renderFundIdentity(group)}
          </div>
          <div className="text-right">
            <p className="text-sm font-medium tabular-nums text-slate-900">{formatInrFull(group.current_value)}</p>
            <p className="text-xs tabular-nums text-slate-400">Inv {formatInrFull(group.total_invested)}</p>
          </div>
          {group.current_nav === null ? (
            <p className="text-right text-sm text-slate-400" title="No NAV — valued at cost">
              —
            </p>
          ) : (
            <div className="text-right" title={navTooltip(group)}>
              <p className="whitespace-nowrap text-sm tabular-nums text-slate-900">
                {formatSchemeNav(group.current_nav)}
                {renderStaleNavDate(group)}
              </p>
              <p className="text-xs tabular-nums text-slate-400">Avg {formatSchemeNav(group.avg_nav)}</p>
            </div>
          )}
          <div>
            {group.nav_missing ? (
              <p className="text-sm text-slate-400" title="No NAV — valued at cost">
                —
              </p>
            ) : (
              <>
                <p className={`text-sm font-medium tabular-nums ${toneText(group.pnl)}`}>
                  {formatSignedInrFull(group.pnl)}{" "}
                  <span className="text-xs">({formatPct(group.pnl_pct)})</span>
                </p>
                <PnlBar pct={group.pnl_pct} maxAbs={maxAbsPnlPct} />
              </>
            )}
          </div>
          <p className="text-right text-sm tabular-nums text-slate-600">{allocationPct(group).toFixed(1)}%</p>
          <ReturnRank group={group} returnKey={returnKey} rankKey={rankKey} />
          <div className="flex justify-end">
            <ActionsMenu label={`Actions for ${group.scheme_name}`} actions={groupActions(group)} />
          </div>
        </div>
        {isExpanded && renderLotsPanel(group)}
      </div>
    );
  };

  const renderMobileCard = (group: HoldingGroup) => {
    const isExpanded = expandedGroups.has(group.key);
    return (
      <div key={group.key} className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">{renderFundIdentity(group)}</div>
          <ActionsMenu label={`Actions for ${group.scheme_name}`} actions={groupActions(group)} />
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="min-w-0">
            <dt className="text-slate-500">Value</dt>
            <dd className="truncate text-sm font-medium tabular-nums text-slate-900">
              {formatInrShort(group.current_value, 2)}
            </dd>
            <dd className="truncate tabular-nums text-slate-400">Inv {formatInrShort(group.total_invested, 2)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500">P&L</dt>
            {group.nav_missing ? (
              <dd className="text-sm text-slate-400">—</dd>
            ) : (
              <>
                <dd className={`truncate text-sm font-medium tabular-nums ${toneText(group.pnl)}`}>
                  {formatPct(group.pnl_pct, 1)}
                </dd>
                <dd className={`truncate tabular-nums ${toneText(group.pnl)}`}>
                  {group.pnl >= 0 ? "+" : "-"}
                  {formatInrShort(Math.abs(group.pnl))}
                </dd>
              </>
            )}
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500">{periodLabel} return</dt>
            <dd className="mt-0.5">
              <ReturnRank group={group} returnKey={returnKey} rankKey={rankKey} />
            </dd>
          </div>
        </dl>
        {group.current_nav !== null && (
          <p className="mt-1.5 text-xs tabular-nums text-slate-500" title={navTooltip(group)}>
            NAV {formatSchemeNav(group.current_nav)}
            {renderStaleNavDate(group)} · Avg {formatSchemeNav(group.avg_nav)}
          </p>
        )}
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          aria-expanded={isExpanded}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-blue-600"
        >
          <span className={`inline-block transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}>
            <ChevronIcon />
          </span>
          {isExpanded ? "Hide lots" : `Show ${group.lot_count} lot${group.lot_count === 1 ? "" : "s"}`}
          <span className="text-slate-400">· {allocationPct(group).toFixed(1)}% of portfolio</span>
        </button>
        {isExpanded && <div className="-mx-3 mt-2">{renderLotsPanel(group)}</div>}
      </div>
    );
  };

  const renderRow = (group: HoldingGroup) => (isDesktop ? renderDesktopRow(group) : renderMobileCard(group));

  const renderSectionHeader = (s: CategorySection) => {
    const pnl = s.value - s.invested;
    const pnlPct = s.invested > 0 ? (pnl / s.invested) * 100 : 0;
    const share = portfolioValue > 0 ? (s.value / portfolioValue) * 100 : 0;
    return (
      <div
        className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 bg-slate-50 px-4 py-2 text-xs ${
          isDesktop ? "border-b border-slate-100" : "rounded-lg"
        }`}
      >
        <span className="font-semibold text-slate-700">
          {s.category} <span className="font-normal text-slate-400">· {s.rows.length}</span>
        </span>
        <span className="tabular-nums text-slate-600">
          {formatInrFull(s.value)} · <span className={toneText(pnl)}>{formatPct(pnlPct)}</span> ·{" "}
          {share.toFixed(1)}%
        </span>
      </div>
    );
  };

  const renderSortButton = (id: SortKey, label: string) => {
    const active = sortKey === id;
    return (
      <button
        type="button"
        onClick={() => handleSort(id)}
        aria-label={`Sort by ${label}${active ? (sortDir === "asc" ? ", ascending" : ", descending") : ""}`}
        className={`inline-flex items-center gap-1 font-medium transition hover:text-slate-800 ${
          active ? "text-slate-800" : ""
        }`}
      >
        {label}
        <span aria-hidden className={`text-[10px] ${active ? "text-blue-600" : "text-slate-300"}`}>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={userEmail} />

      {toast && (
        <div
          role="status"
          className="fixed right-4 top-4 z-50 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}

      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1" role="group" aria-label="Owner">
            {OWNERS.map((o) => (
              <button
                key={o.id}
                onClick={() => setOwner(o.id)}
                aria-pressed={owner === o.id}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  owner === o.id ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="flex min-w-0 items-center gap-2.5">
            <p className="truncate text-xs text-slate-400">
              <span title={lastSynced ? `NAV last synced ${new Date(lastSynced).toLocaleString("en-IN")}` : undefined}>
                Updated {formatAgo(lastSynced)}
              </span>
              {" · "}
              <Link
                href="/settings"
                className={isPeerSyncStale ? "text-amber-600 hover:underline" : "hover:text-slate-600 hover:underline"}
                title={isPeerSyncStale ? "Peer data is over a week old — sync it in Settings" : "Peer data sync settings"}
              >
                Peers {formatAgo(peersLastSynced)}
              </Link>
            </p>
            <button
              onClick={handleSyncNav}
              disabled={syncingNav}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshIcon spinning={syncingNav} />
              {syncingNav ? "Syncing…" : "Sync NAV"}
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        {loadError && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-rose-50 px-3 py-2">
            <p className="text-sm text-rose-600">{loadError}</p>
            <button
              type="button"
              onClick={() => loadHoldings()}
              className="shrink-0 text-sm font-medium text-blue-600 underline hover:text-blue-700"
            >
              Try again
            </button>
          </div>
        )}

        {loading && (
          <>
            <TopSectionSkeleton />
            <ChartsSkeleton />
            <TableSkeleton />
          </>
        )}

        {!loading && !hasAnyHoldings && !loadError && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="text-sm font-medium text-slate-700">No holdings yet — import your CAMS CAS statement</p>
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
            <section aria-label="Summary" className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
              <HeroCard
                value={kpis.currentValue}
                pnl={kpis.pnl}
                pnlPct={kpis.pnlPct}
                returnMetric={kpis.returnMetric}
                dayChange={history?.day_change ?? null}
                warnings={concentrationWarnings}
              />
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Invested" value={formatInrShort(kpis.totalInvested, 2)} sub={formatInrFull(kpis.totalInvested)} />
                <StatCard
                  label="Funds held"
                  value={groupedHoldings.length}
                  sub={`${filteredHoldings.length} lot${filteredHoldings.length === 1 ? "" : "s"}`}
                />
                <StatCard
                  label="Below category avg"
                  value={
                    belowCategory.compared > 0 ? (
                      <>
                        {belowCategory.below}
                        <span className="text-sm font-normal text-slate-400"> of {belowCategory.compared}</span>
                      </>
                    ) : peersLoading ? (
                      <span className="inline-block h-5 w-12 animate-pulse rounded bg-slate-200 align-middle" />
                    ) : (
                      "—"
                    )
                  }
                  sub={
                    belowCategory.compared > 0
                      ? `funds · ${PERIODS.find((p) => p.id === belowCategory.periodUsed)?.label ?? "1Y"} return`
                      : peersLoading
                        ? "loading peer data"
                        : "no peer data yet"
                  }
                />
                <StatCard
                  label="Next SIP"
                  href="/sip"
                  hrefLabel="Open SIP calendar"
                  value={
                    sips === null ? (
                      <span className="inline-block h-5 w-16 animate-pulse rounded bg-slate-200 align-middle" />
                    ) : nextSip ? (
                      nextSip.date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                    ) : (
                      "None"
                    )
                  }
                  sub={
                    nextSip
                      ? `${formatInrShort(nextSip.amount, 2)}${nextSip.count > 1 ? ` · ${nextSip.count} SIPs` : ""}`
                      : sips === null
                        ? undefined
                        : "Set up SIPs →"
                  }
                />
              </div>
            </section>

            {owner === "family" && ownerSummaries.length > 1 && (
              <OwnerCompareStrip rows={ownerSummaries} onSelect={(id) => setOwner(id)} />
            )}

            <section aria-label="Charts" className="grid gap-4 lg:grid-cols-2">
              <AllocationCard slices={categoryAllocation} />
              <ValueHistoryCard
                points={history?.points ?? []}
                loading={historyLoading}
                error={historyError}
                onRetry={() => loadHistory(owner)}
              />
            </section>

            <MoversCard gainers={movers.gainers} losers={movers.losers} />

            <section id="holdings" aria-label="Holdings" className="scroll-mt-4 pt-2">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <h2 className="text-base font-semibold text-slate-800">Holdings</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="relative min-w-0 flex-1 md:w-56 md:flex-none">
                    <span className="sr-only">Search funds</span>
                    <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-slate-400">
                      <SearchIcon />
                    </span>
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search funds"
                      className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-sm placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500">Return period</span>
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5" role="group" aria-label="Return period">
                      {PERIODS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPeriod(p.id)}
                          aria-pressed={period === p.id}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                            period === p.id ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={groupByCategory}
                      onChange={(e) => setGroupByCategory(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    Group by category
                  </label>
                  {!isDesktop && (
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                      Sort
                      <select
                        value={`${sortKey}:${sortDir}`}
                        onChange={(e) => {
                          const [k, d] = e.target.value.split(":") as [SortKey, SortDir];
                          setSortKey(k);
                          setSortDir(d);
                        }}
                        className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs"
                      >
                        {SORT_OPTIONS.filter((o) => o.id !== "allocation").map((o) => (
                          <Fragment key={o.id}>
                            <option value={`${o.id}:${o.defaultDir}`}>
                              {o.label} {o.defaultDir === "desc" ? "↓" : "↑"}
                            </option>
                            <option value={`${o.id}:${o.defaultDir === "desc" ? "asc" : "desc"}`}>
                              {o.label} {o.defaultDir === "desc" ? "↑" : "↓"}
                            </option>
                          </Fragment>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </div>

              {deleteGroupTarget && (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3" role="alert">
                  <p className="text-sm text-rose-700">
                    Delete all {deleteGroupTarget.lot_count} lots of{" "}
                    <span className="font-semibold" title={deleteGroupTarget.scheme_name}>
                      {displayFundName(deleteGroupTarget.scheme_name)}
                    </span>{" "}
                    totalling{" "}
                    {formatInrFull(deleteGroupTarget.total_invested)}? This cannot be undone.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleConfirmDeleteGroup(deleteGroupTarget)}
                      disabled={deleteGroupDeleting}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
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

              {tableRows.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                  No funds match “{search}”.
                </p>
              ) : isDesktop ? (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-white">
                  <div
                    className={`${MAIN_GRID} items-center rounded-t-2xl border-b border-slate-200 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-500`}
                  >
                    <span className="pl-6 font-medium">Fund</span>
                    <span className="text-right">{renderSortButton("value", "Value")}</span>
                    <span className="text-right font-medium">NAV</span>
                    <span>{renderSortButton("pnl_pct", "P&L")}</span>
                    <span className="text-right">{renderSortButton("allocation", "Alloc")}</span>
                    <span className="flex items-center gap-2">
                      {renderSortButton("return", `${periodLabel} return`)}
                      {renderSortButton("rank", "Rank")}
                    </span>
                    <span className="sr-only">Actions</span>
                  </div>
                  {groupByCategory
                    ? categorySections.map((s) => (
                        <div key={s.category}>
                          {renderSectionHeader(s)}
                          {s.rows.map(renderRow)}
                        </div>
                      ))
                    : tableRows.map(renderRow)}
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {groupByCategory
                    ? categorySections.map((s) => (
                        <div key={s.category} className="space-y-2">
                          {renderSectionHeader(s)}
                          {s.rows.map(renderRow)}
                        </div>
                      ))
                    : tableRows.map(renderRow)}
                </div>
              )}
            </section>
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
