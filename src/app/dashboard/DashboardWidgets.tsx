"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  formatInrFull,
  formatInrShort,
  formatPct,
  formatSignedInrShort,
  toneText,
} from "@/lib/format";
import { MIN_XIRR_HOLDING_DAYS, type DayChange, type HistoryPoint, type ReturnMetric } from "./types";

const ABSOLUTE_RETURN_TOOLTIP = "XIRR shown once avg holding ≥ 1 year";

function returnMetricLabel(m: ReturnMetric): string {
  return m.kind === "xirr" ? "XIRR" : "Return";
}

function returnMetricTooltip(m: ReturnMetric): string {
  if (m.kind === "xirr") return "Annualised return, accounting for when each lot was bought";
  const days = m.avgHoldingDays === null ? null : Math.round(m.avgHoldingDays);
  return days === null || days >= MIN_XIRR_HOLDING_DAYS
    ? ABSOLUTE_RETURN_TOOLTIP
    : `${ABSOLUTE_RETURN_TOOLTIP} (currently ${days} days)`;
}

function formatReturnMetric(m: ReturnMetric, digits = 2): string {
  if (m.pct === null) return "—";
  return m.kind === "xirr" ? `${formatPct(m.pct, digits)} p.a.` : formatPct(m.pct, digits);
}

// --- Hero card ---

export interface ConcentrationWarning {
  key: string;
  label: string;
  detail: string;
}

export function HeroCard({
  value,
  pnl,
  pnlPct,
  returnMetric,
  dayChange,
  warnings,
}: {
  value: number;
  pnl: number;
  pnlPct: number;
  returnMetric: ReturnMetric;
  dayChange: DayChange | null;
  warnings: ConcentrationWarning[];
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Current value</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900 sm:text-4xl" title={formatInrFull(value)}>
        {formatInrShort(value, 2)}
      </p>
      <p className="text-xs tabular-nums text-slate-400">{formatInrFull(value)}</p>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Total P&L</dt>
          <dd className={`font-semibold tabular-nums ${toneText(pnl)}`}>
            {formatSignedInrShort(pnl, 2)} <span className="font-medium">({formatPct(pnlPct)})</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500" title={returnMetricTooltip(returnMetric)}>
            {returnMetricLabel(returnMetric)}
          </dt>
          <dd
            className={`font-semibold tabular-nums ${toneText(returnMetric.pct, "text-slate-500")}`}
            title={returnMetricTooltip(returnMetric)}
          >
            {formatReturnMetric(returnMetric)}
          </dd>
        </div>
        {dayChange && (
          <div>
            <dt className="text-xs text-slate-500" title={`Latest NAV (${dayChange.as_of}) vs previous NAV`}>
              Day change
            </dt>
            <dd className={`font-semibold tabular-nums ${toneText(dayChange.amount)}`}>
              {formatSignedInrShort(dayChange.amount, 2)}{" "}
              <span className="font-medium">({formatPct(dayChange.pct)})</span>
            </dd>
          </div>
        )}
      </dl>
      {warnings.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {warnings.map((w) => (
            <span
              key={w.key}
              title={w.detail}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
            >
              <span aria-hidden>⚠</span>
              <span className="truncate">{w.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Compact stat card ---

export function StatCard({
  label,
  value,
  sub,
  href,
  hrefLabel,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  href?: string;
  hrefLabel?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        aria-label={hrefLabel}
        className="block min-w-0 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-blue-300 hover:bg-blue-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {body}
      </Link>
    );
  }
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">{body}</div>;
}

// --- Allocation donut + legend ---

// Categorical palette kept clear of the gain/loss green and red so a slice
// never reads as "good" or "bad".
export const CATEGORY_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#f59e0b",
  "#8b5cf6",
  "#14b8a6",
  "#ec4899",
  "#f97316",
  "#94a3b8",
];

export interface AllocationSlice {
  category: string;
  value: number;
}

export function AllocationCard({ slices }: { slices: AllocationSlice[] }) {
  const total = slices.reduce((s, c) => s + c.value, 0);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-700">Allocation by category</h3>
      <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <div className="h-44 w-44 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="category"
                innerRadius="62%"
                outerRadius="100%"
                paddingAngle={1}
                stroke="none"
                isAnimationActive={false}
              >
                {slices.map((entry, i) => (
                  <Cell key={entry.category} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as AllocationSlice | undefined;
                  if (!active || !p) return null;
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                      {p.category}: {formatInrFull(p.value)} ({total > 0 ? ((p.value / total) * 100).toFixed(1) : "0.0"}%)
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
          {slices.map((s, i) => (
            <li key={s.category} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-slate-700" title={s.category}>
                {s.category}
              </span>
              <span className="w-12 text-right tabular-nums text-slate-500">
                {total > 0 ? ((s.value / total) * 100).toFixed(1) : "0.0"}%
              </span>
              <span className="w-16 text-right font-medium tabular-nums text-slate-800">
                {formatInrShort(s.value)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// --- Portfolio value over time ---

type HistoryRange = "6m" | "1y" | "3y" | "all";

const HISTORY_RANGES: { id: HistoryRange; label: string; days: number | null }[] = [
  { id: "6m", label: "6M", days: 183 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "3y", label: "3Y", days: 3 * 365 },
  { id: "all", label: "All", days: null },
];

const VALUE_COLOR = "#6366f1";
const INVESTED_COLOR = "#94a3b8";

// Round y-axis ticks (₹5L / ₹10L / ₹15L …): picks a 1/2/2.5/5 × 10^k step
// giving roughly four intervals, and snaps the domain outward to it.
function niceTicks(min: number, max: number, targetIntervals = 4): { min: number; max: number; ticks: number[] } {
  if (!(max > min)) {
    const pad = Math.max(1000, Math.abs(max) * 0.1);
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / targetIntervals;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const lo = Math.max(0, Math.floor(min / step) * step);
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t));
  return { min: lo, max: hi, ticks };
}

function formatMonthTick(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
}

function formatDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function ValueHistoryCard({
  points,
  loading,
  error,
  onRetry,
}: {
  points: HistoryPoint[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [range, setRange] = useState<HistoryRange>("1y");
  const gradientId = useId().replace(/:/g, "");

  const visible = useMemo(() => {
    const days = HISTORY_RANGES.find((r) => r.id === range)?.days ?? null;
    if (days === null || points.length === 0) return points;
    const last = points[points.length - 1].date;
    const cutoff = new Date(new Date(`${last}T00:00:00Z`).getTime() - days * 86400000).toISOString().slice(0, 10);
    const inRange = points.filter((p) => p.date >= cutoff);
    return inRange.length >= 2 ? inRange : points.slice(-2);
  }, [points, range]);

  const yAxis = useMemo(() => {
    const values = visible.flatMap((p) => [p.value, p.invested]);
    return values.length > 0 ? niceTicks(Math.min(...values), Math.max(...values)) : null;
  }, [visible]);

  const first = visible[0];
  const last = visible[visible.length - 1];
  // Change in value over the range net of new money put in during it.
  const rangeGain = first && last ? last.value - first.value - (last.invested - first.invested) : null;

  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-700">Portfolio value over time</h3>
          {rangeGain !== null && !loading && !error && (
            <p className={`text-xs tabular-nums ${toneText(rangeGain)}`}>
              {formatInrShort(Math.abs(rangeGain), 2)} market {rangeGain >= 0 ? "gain" : "loss"} in this range
            </p>
          )}
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5" role="group" aria-label="Chart range">
          {HISTORY_RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              aria-pressed={range === r.id}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                range === r.id ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 h-52 sm:h-56">
        {loading ? (
          <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
            <p>{error}</p>
            <button type="button" onClick={onRetry} className="text-xs font-medium text-blue-600 hover:underline">
              Try again
            </button>
          </div>
        ) : visible.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">Not enough history yet</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={visible} margin={{ top: 5, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={VALUE_COLOR} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={VALUE_COLOR} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tickFormatter={formatMonthTick}
                tick={{ fontSize: 11, fill: "#64748b" }}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
              />
              <YAxis
                tickFormatter={(v: number) => formatInrShort(v, 2)}
                tick={{ fontSize: 11, fill: "#64748b" }}
                tickLine={false}
                axisLine={false}
                width={52}
                domain={yAxis ? [yAxis.min, yAxis.max] : ["auto", "auto"]}
                ticks={yAxis?.ticks}
                interval={0}
              />
              <Tooltip
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as HistoryPoint | undefined;
                  if (!active || !p) return null;
                  const gain = p.value - p.invested;
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                      <p className="font-medium text-slate-700">{formatDayLabel(p.date)}</p>
                      <p className="mt-1 tabular-nums" style={{ color: VALUE_COLOR }}>
                        Value: {formatInrFull(p.value)}
                      </p>
                      <p className="tabular-nums text-slate-500">Invested: {formatInrFull(p.invested)}</p>
                      <p className={`tabular-nums ${toneText(gain)}`}>
                        Gain: {formatSignedInrShort(gain, 2)}
                      </p>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                name="Market value"
                stroke={VALUE_COLOR}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
              />
              <Line
                type="stepAfter"
                dataKey="invested"
                name="Invested"
                stroke={INVESTED_COLOR}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ backgroundColor: VALUE_COLOR }} aria-hidden /> Market value
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: INVESTED_COLOR }} aria-hidden />
          Invested (cumulative)
        </span>
      </div>
    </div>
  );
}

// --- Top gainers / losers ---

export interface MoverRow {
  key: string;
  // Display name (plan/option suffix stripped); fullName goes in the tooltip.
  name: string;
  fullName: string;
  scheme_code: string | null;
  pnl: number;
  pnl_pct: number;
}

function MoverList({ title, rows }: { title: string; rows: MoverRow[] }) {
  return (
    <div className="min-w-0">
      <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h4>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">None</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="flex items-baseline gap-3 text-sm">
              {r.scheme_code ? (
                <Link
                  href={`/fund/${r.scheme_code}`}
                  className="min-w-0 flex-1 truncate text-slate-700 hover:text-blue-600"
                  title={r.fullName}
                >
                  {r.name}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate text-slate-700" title={r.fullName}>
                  {r.name}
                </span>
              )}
              <span className={`shrink-0 font-semibold tabular-nums ${toneText(r.pnl_pct)}`}>
                {formatPct(r.pnl_pct, 1)}
              </span>
              <span className={`w-16 shrink-0 text-right tabular-nums ${toneText(r.pnl)}`}>
                {formatSignedInrShort(r.pnl)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MoversCard({ gainers, losers }: { gainers: MoverRow[]; losers: MoverRow[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="grid gap-5 sm:grid-cols-2 sm:gap-8">
        <MoverList title="Top gainers" rows={gainers} />
        <MoverList title="Top losers" rows={losers} />
      </div>
    </div>
  );
}

// --- Praveen vs Geetha strip (Family view) ---

export interface OwnerSummary {
  id: "praveen" | "geetha";
  label: string;
  value: number;
  pnlPct: number;
  returnMetric: ReturnMetric;
}

export function OwnerCompareStrip({
  rows,
  onSelect,
}: {
  rows: OwnerSummary[];
  onSelect: (id: "praveen" | "geetha") => void;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onSelect(r.id)}
          className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          title={`Show only ${r.label}'s holdings`}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                r.id === "praveen" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {r.label[0]}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{r.label}</p>
              <p className="text-xs text-slate-500">
                {total > 0 ? `${((r.value / total) * 100).toFixed(0)}% of family` : "—"}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums text-slate-900">{formatInrShort(r.value, 2)}</p>
            <p className="text-xs tabular-nums">
              <span className={toneText(r.pnlPct)}>{formatPct(r.pnlPct, 1)}</span>
              <span className="text-slate-400" title={returnMetricTooltip(r.returnMetric)}>
                {" "}
                · {returnMetricLabel(r.returnMetric)}{" "}
              </span>
              <span className={toneText(r.returnMetric.pct, "text-slate-400")} title={returnMetricTooltip(r.returnMetric)}>
                {formatReturnMetric(r.returnMetric, 1)}
              </span>
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}

// --- "⋯" actions menu ---

export interface MenuAction {
  label: string;
  onSelect: () => void;
  tone?: "danger";
  icon?: ReactNode;
}

// Keyboard accessible: Enter/Space/ArrowDown opens and focuses the first
// item, Up/Down/Home/End move between items, Esc or Tab closes (Esc returns
// focus to the trigger), and any click outside the menu closes it.
export function ActionsMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  const focusItem = (index: number) => {
    const count = actions.length;
    itemRefs.current[(index + count) % count]?.focus();
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(current + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(actions.length - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {actions.map((a, i) => (
            <button
              key={a.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition focus:outline-none ${
                a.tone === "danger"
                  ? "text-rose-600 hover:bg-rose-50 focus:bg-rose-50"
                  : "text-slate-700 hover:bg-slate-100 focus:bg-slate-100"
              }`}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Loading skeletons ---

export function TopSectionSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
      <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5">
        <div className="h-3 w-24 rounded bg-slate-200" />
        <div className="mt-3 h-9 w-48 rounded bg-slate-200" />
        <div className="mt-4 flex gap-6">
          <div className="h-8 w-24 rounded bg-slate-200" />
          <div className="h-8 w-20 rounded bg-slate-200" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-white p-3">
            <div className="h-3 w-16 rounded bg-slate-200" />
            <div className="mt-2 h-5 w-20 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
          <div className="h-3 w-32 rounded bg-slate-200" />
          <div className="mt-4 h-48 rounded-lg bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="h-12 border-b border-slate-100 bg-slate-50" />
      <div className="divide-y divide-slate-100">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-4">
            <div className="h-4 flex-1 rounded bg-slate-200" />
            <div className="hidden h-4 w-20 rounded bg-slate-200 sm:block" />
            <div className="h-4 w-16 rounded bg-slate-200" />
            <div className="hidden h-4 w-12 rounded bg-slate-200 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
