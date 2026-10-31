"use client";

import { useMemo, useState, type FormEvent } from "react";
import AppHeader from "@/components/AppHeader";
import type { MFSIPSchedule, Owner, SIPFrequency } from "@/types/mf";
import { detectCategory } from "@/lib/analysis/fundCategoriser";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CATEGORY_OPTIONS = [
  "Large Cap",
  "Mid Cap",
  "Small Cap",
  "Flexi Cap",
  "ELSS",
  "Debt",
  "Hybrid",
  "Index",
];

type OwnerFilter = "all" | Owner;

interface Occurrence {
  sip: MFSIPSchedule;
  isWeekend: boolean;
}

export interface LumpsumEntry {
  trade_date: string;
  amount: number;
  scheme_name: string;
  owner: Owner;
}

// An executed SIP instalment — one mf_holdings lot with lot_type = 'sip'.
export interface SipLotEntry {
  trade_date: string;
  amount: number;
  units: number;
  scheme_code: string | null;
  scheme_name: string;
  owner: Owner;
}

// A Coin order that hasn't settled yet (mf_pending_orders) — no units yet.
export interface PendingOrderEntry {
  trade_date: string;
  amount: number;
  scheme_code: string | null;
  scheme_name: string;
  owner: Owner;
  lot_type: "sip" | "lumpsum";
  ordered_at: string | null;
  remarks: string | null;
}

export interface SellEntry {
  trade_date: string;
  amount: number;
  units: number;
  scheme_name: string;
  owner: Owner;
}

// Compact Indian-format money: "₹2.77L" above 1 lakh, "₹42k" below. Shared by
// the SELL and lumpsum (BUY) calendar chips so the two read consistently.
function formatMoneyAbbrev(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100000) return `₹${(abs / 100000).toFixed(2)}L`;
  return `₹${Math.round(abs / 1000)}k`;
}

// Groups lumpsum holdings into the days of the viewed month — parsed from
// local Y/M/D components (not `new Date(iso)`, which parses a date-only
// string as UTC midnight and shifts the day under IST).
function computeLumpsumsByDay(
  lumpsums: LumpsumEntry[],
  year: number,
  month: number
): Map<number, LumpsumEntry[]> {
  const map = new Map<number, LumpsumEntry[]>();
  for (const l of lumpsums) {
    const [ly, lm, ld] = l.trade_date.split("-").map(Number);
    if (ly !== year || lm - 1 !== month) continue;
    const existing = map.get(ld) ?? [];
    existing.push(l);
    map.set(ld, existing);
  }
  return map;
}

// Same grouping as computeLumpsumsByDay, for SELL transactions.
function computeSellsByDay(sells: SellEntry[], year: number, month: number): Map<number, SellEntry[]> {
  const map = new Map<number, SellEntry[]>();
  for (const s of sells) {
    const [sy, sm, sd] = s.trade_date.split("-").map(Number);
    if (sy !== year || sm - 1 !== month) continue;
    const existing = map.get(sd) ?? [];
    existing.push(s);
    map.set(sd, existing);
  }
  return map;
}

interface GroupedLumpsum {
  key: string;
  scheme_name: string;
  owner: Owner;
  amount: number;
  trade_date: string;
  category: string;
}

// Collapses individual lumpsum lots into one row per fund + owner — total
// invested is the sum of every lot, last purchase date is the most recent.
function groupLumpsums(lumpsums: LumpsumEntry[]): GroupedLumpsum[] {
  const map = new Map<string, GroupedLumpsum>();
  for (const l of lumpsums) {
    const key = `${l.scheme_name}::${l.owner}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        scheme_name: l.scheme_name,
        owner: l.owner,
        amount: l.amount,
        trade_date: l.trade_date,
        category: detectCategory(l.scheme_name).category,
      });
    } else {
      existing.amount += l.amount;
      if (l.trade_date > existing.trade_date) existing.trade_date = l.trade_date;
    }
  }
  return Array.from(map.values());
}

interface SchemeSearchResult {
  schemeCode: number;
  schemeName: string;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function ordinal(n: number) {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

function computeOccurrences(
  sips: MFSIPSchedule[],
  year: number,
  month: number
): Map<number, Occurrence[]> {
  const map = new Map<number, Occurrence[]>();
  const dim = daysInMonth(year, month);

  for (const sip of sips) {
    if (!sip.is_active) continue;

    const start = new Date(sip.start_date);
    const startMonthIndex = start.getFullYear() * 12 + start.getMonth();
    const thisMonthIndex = year * 12 + month;

    if (thisMonthIndex < startMonthIndex) continue;

    if (sip.end_date) {
      const end = new Date(sip.end_date);
      const endMonthIndex = end.getFullYear() * 12 + end.getMonth();
      if (thisMonthIndex > endMonthIndex) continue;
    }

    if (sip.frequency === "quarterly") {
      const diff = thisMonthIndex - startMonthIndex;
      if (diff % 3 !== 0) continue;
    }

    if (sip.frequency === "weekly" || sip.frequency === "bi-weekly") {
      // Parsed from local Y/M/D components (not `new Date(sip.start_date)`,
      // which parses a date-only string as UTC midnight) so this stays in
      // the same local-time frame as monthStart/monthEnd below — mixing the
      // two silently drops the month's last occurrence in UTC+ timezones.
      const [startY, startM, startD] = sip.start_date.split("-").map(Number);
      let current = new Date(startY, startM - 1, startD);
      const monthEnd = new Date(year, month + 1, 0);
      const monthStart = new Date(year, month, 1);
      const stepDays = sip.frequency === "bi-weekly" ? 14 : 7;
      while (current <= monthEnd) {
        if (current >= monthStart && current.getFullYear() === year && current.getMonth() === month) {
          const day = current.getDate();
          const dow = current.getDay();
          const isWeekend = dow === 0 || dow === 6;
          const existing = map.get(day) ?? [];
          existing.push({ sip, isWeekend });
          map.set(day, existing);
        }
        current = new Date(current.getTime() + stepDays * 24 * 60 * 60 * 1000);
      }
      continue;
    }

    const day = Math.min(sip.sip_date, dim);
    const dow = new Date(year, month, day).getDay();
    const isWeekend = dow === 0 || dow === 6;

    const existing = map.get(day) ?? [];
    existing.push({ sip, isWeekend });
    map.set(day, existing);
  }

  return map;
}

// --- Executed vs pending SIP instalments ---

// A SIP can execute a few days off its scheduled date (holidays/weekends).
const SIP_MATCH_TOLERANCE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function localDateFromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isoFromLocal(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatShortDate(d: Date): string {
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

function formatDayMonth(d: Date): string {
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
}

function formatUnits(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function realSchemeCode(code: string | null | undefined): string | null {
  return code && !code.startsWith("manual-") ? code : null;
}

// Same fund + owner: scheme_code when both sides have a real one, else a
// case-insensitive scheme_name match.
function lotMatchesSip(
  lot: { owner: Owner; scheme_code: string | null; scheme_name: string },
  sip: MFSIPSchedule
): boolean {
  if (lot.owner !== sip.owner) return false;
  const lotCode = realSchemeCode(lot.scheme_code);
  const sipCode = realSchemeCode(sip.scheme_code);
  if (lotCode && sipCode) return lotCode === sipCode;
  return lot.scheme_name.trim().toLowerCase() === sip.scheme_name.trim().toLowerCase();
}

type SipChipStatus = "executed" | "processing" | "missed" | "upcoming";

// A pending order this many days old is probably stuck.
const PENDING_STALE_DAYS = 7;

interface SipChip {
  key: string;
  status: SipChipStatus;
  sip: MFSIPSchedule;
  scheduled: Date;
  isWeekend: boolean;
  lot: SipLotEntry | null;
  pending: PendingOrderEntry | null;
  // Pending order older than PENDING_STALE_DAYS.
  stale: boolean;
  // Set when the matched lot / pending order is in a different month from
  // the scheduled occurrence (e.g. 31 Oct for a 1 Nov SIP).
  shift: "early" | "late" | null;
  // Which side of a cross-month match this chip represents: the scheduled
  // day in the occurrence's month, or the execution day in the lot's month.
  shownOn: "scheduled" | "lot";
}

interface UnscheduledPending {
  order: PendingOrderEntry;
  stale: boolean;
}

interface SipCalendarView {
  // Schedule-linked chips, keyed by the day they're shown on: the actual
  // execution / order day for executed or processing instalments, the
  // scheduled day otherwise.
  chipsByDay: Map<number, SipChip[]>;
  // Executed SIP lots in the month that matched no schedule.
  unscheduledByDay: Map<number, SipLotEntry[]>;
  // Pending orders in the month that matched no schedule (incl. lumpsums).
  unscheduledPendingByDay: Map<number, UnscheduledPending[]>;
  executedTotal: number;
  executedCount: number;
  processingTotal: number;
  processingCount: number;
}

type Occ = { key: string; sip: MFSIPSchedule; date: Date; isWeekend: boolean };

// Pairs occurrences with items (each side at most once) within ±3 days,
// greedily by smallest distance. Occurrences already in `taken` are skipped.
function greedyMatch<T extends { owner: Owner; scheme_code: string | null; scheme_name: string }>(
  occurrences: Occ[],
  items: { item: T; date: Date }[],
  taken: Set<number>
): Map<number, number> {
  const pairs: { occIdx: number; itemIdx: number; dist: number }[] = [];
  occurrences.forEach((occ, occIdx) => {
    if (taken.has(occIdx)) return;
    items.forEach(({ item, date }, itemIdx) => {
      const dist = Math.round(Math.abs(date.getTime() - occ.date.getTime()) / DAY_MS);
      if (dist <= SIP_MATCH_TOLERANCE_DAYS && lotMatchesSip(item, occ.sip)) {
        pairs.push({ occIdx, itemIdx, dist });
      }
    });
  });
  pairs.sort((a, b) => a.dist - b.dist);

  const occToItem = new Map<number, number>();
  const usedItems = new Set<number>();
  for (const p of pairs) {
    if (occToItem.has(p.occIdx) || usedItems.has(p.itemIdx)) continue;
    occToItem.set(p.occIdx, p.itemIdx);
    usedItems.add(p.itemIdx);
  }
  return occToItem;
}

// Projects every schedule for the viewed month (plus the neighbouring months,
// so an instalment executed on the 31st can match a scheduled 1st) and pairs
// each occurrence with an executed SIP lot of the same fund within ±3 days;
// occurrences still unmatched then pair with a pending (processing) SIP
// order. Priority: executed lot > pending order > nothing.
function computeSipCalendarView(
  sips: MFSIPSchedule[],
  sipLots: SipLotEntry[],
  pendingOrders: PendingOrderEntry[],
  year: number,
  month: number,
  today: Date
): SipCalendarView {
  const occurrences: Occ[] = [];
  for (const offset of [-1, 0, 1]) {
    const d = new Date(year, month + offset, 1);
    computeOccurrences(sips, d.getFullYear(), d.getMonth()).forEach((list, day) => {
      for (const o of list) {
        const date = new Date(d.getFullYear(), d.getMonth(), day);
        occurrences.push({ key: `${o.sip.id}-${isoFromLocal(date)}`, sip: o.sip, date, isWeekend: o.isWeekend });
      }
    });
  }

  const windowStart = new Date(year, month - 1, 1).getTime();
  const windowEnd = new Date(year, month + 2, 0).getTime();
  const inWindow = ({ date }: { date: Date }) => date.getTime() >= windowStart && date.getTime() <= windowEnd;

  const lots = sipLots.map((item) => ({ item, date: localDateFromIso(item.trade_date) })).filter(inWindow);
  const pendings = pendingOrders.map((item) => ({ item, date: localDateFromIso(item.trade_date) })).filter(inWindow);
  const pendingSips = pendings.filter(({ item }) => item.lot_type === "sip");

  const occToLot = greedyMatch(occurrences, lots, new Set());
  const occToPending = greedyMatch(occurrences, pendingSips, new Set(occToLot.keys()));
  const usedLots = new Set(occToLot.values());
  const usedPendingOrders = new Set(Array.from(occToPending.values()).map((i) => pendingSips[i].item));

  const inViewedMonth = (d: Date) => d.getFullYear() === year && d.getMonth() === month;
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const staleBefore = todayStart.getTime() - PENDING_STALE_DAYS * DAY_MS;

  const chipsByDay = new Map<number, SipChip[]>();
  const pushChip = (day: number, chip: SipChip) => {
    const list = chipsByDay.get(day) ?? [];
    list.push(chip);
    chipsByDay.set(day, list);
  };

  // Shared placement for executed and processing matches: same month → on
  // the actual day; cross-month → on the scheduled day in the occurrence's
  // month AND on the actual day in the other month, labelled as such.
  const placeMatched = (occ: Occ, actual: Date, chip: Omit<SipChip, "key" | "shift" | "shownOn">) => {
    const sameMonth =
      actual.getFullYear() === occ.date.getFullYear() && actual.getMonth() === occ.date.getMonth();
    if (sameMonth) {
      if (inViewedMonth(actual)) pushChip(actual.getDate(), { ...chip, key: occ.key, shift: null, shownOn: "lot" });
      return;
    }
    const shift = actual < occ.date ? ("early" as const) : ("late" as const);
    if (inViewedMonth(occ.date)) {
      pushChip(occ.date.getDate(), { ...chip, key: `${occ.key}-sched`, shift, shownOn: "scheduled" });
    }
    if (inViewedMonth(actual)) {
      pushChip(actual.getDate(), { ...chip, key: `${occ.key}-lot`, shift, shownOn: "lot" });
    }
  };

  occurrences.forEach((occ, occIdx) => {
    const base = { sip: occ.sip, scheduled: occ.date, isWeekend: occ.isWeekend };
    const lotIdx = occToLot.get(occIdx);
    if (lotIdx !== undefined) {
      placeMatched(occ, lots[lotIdx].date, { ...base, status: "executed", lot: lots[lotIdx].item, pending: null, stale: false });
      return;
    }
    const pendingIdx = occToPending.get(occIdx);
    if (pendingIdx !== undefined) {
      const { item, date } = pendingSips[pendingIdx];
      placeMatched(occ, date, {
        ...base,
        status: "processing",
        lot: null,
        pending: item,
        stale: date.getTime() < staleBefore,
      });
      return;
    }
    if (!inViewedMonth(occ.date)) return;
    pushChip(occ.date.getDate(), {
      ...base,
      key: occ.key,
      status: occ.date < todayStart ? "missed" : "upcoming",
      lot: null,
      pending: null,
      stale: false,
      shift: null,
      shownOn: "scheduled",
    });
  });

  const unscheduledByDay = new Map<number, SipLotEntry[]>();
  let executedTotal = 0;
  let executedCount = 0;
  lots.forEach(({ item, date }, lotIdx) => {
    if (!inViewedMonth(date)) return;
    executedTotal += item.amount;
    executedCount++;
    if (usedLots.has(lotIdx)) return;
    const list = unscheduledByDay.get(date.getDate()) ?? [];
    list.push(item);
    unscheduledByDay.set(date.getDate(), list);
  });

  const unscheduledPendingByDay = new Map<number, UnscheduledPending[]>();
  let processingTotal = 0;
  let processingCount = 0;
  pendings.forEach(({ item, date }) => {
    if (!inViewedMonth(date)) return;
    processingTotal += item.amount;
    processingCount++;
    if (usedPendingOrders.has(item)) return;
    const list = unscheduledPendingByDay.get(date.getDate()) ?? [];
    list.push({ order: item, stale: date.getTime() < staleBefore });
    unscheduledPendingByDay.set(date.getDate(), list);
  });

  return {
    chipsByDay,
    unscheduledByDay,
    unscheduledPendingByDay,
    executedTotal,
    executedCount,
    processingTotal,
    processingCount,
  };
}

export default function SIPCalendarClient({
  userEmail,
  initialSips,
  initialLumpsums,
  initialSells,
  initialSipLots,
  initialPendingOrders,
}: {
  userEmail: string;
  initialSips: MFSIPSchedule[];
  initialLumpsums: LumpsumEntry[];
  initialSells: SellEntry[];
  initialSipLots: SipLotEntry[];
  initialPendingOrders: PendingOrderEntry[];
}) {
  const today = useMemo(() => new Date(), []);

  const [sips, setSips] = useState<MFSIPSchedule[]>(initialSips);
  const [lumpsums] = useState<LumpsumEntry[]>(initialLumpsums);
  const [sells] = useState<SellEntry[]>(initialSells);
  const [sipLots] = useState<SipLotEntry[]>(initialSipLots);
  const [pendingOrders] = useState<PendingOrderEntry[]>(initialPendingOrders);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [fOwner, setFOwner] = useState<Owner>("praveen");
  const [fSchemeName, setFSchemeName] = useState("");
  const [fSchemeCode, setFSchemeCode] = useState<string | null>(null);
  const [fCategory, setFCategory] = useState(CATEGORY_OPTIONS[0]);
  const [fAmount, setFAmount] = useState("");
  const [fSipDate, setFSipDate] = useState("1");
  const [fStartDate, setFStartDate] = useState(() =>
    today.toISOString().slice(0, 10)
  );
  const [fFrequency, setFFrequency] = useState<SIPFrequency>("monthly");
  const [searchResults, setSearchResults] = useState<SchemeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // --- "All SIPs" table filters ---
  const [sipFilterOwner, setSipFilterOwner] = useState<"all" | Owner>("all");
  const [sipFilterFrequency, setSipFilterFrequency] = useState<"all" | SIPFrequency>("all");
  const [sipFilterCategory, setSipFilterCategory] = useState("all");
  const [sipFilterStatus, setSipFilterStatus] = useState<"all" | "active" | "paused">("all");

  const sipCategoryOptions = useMemo(
    () => Array.from(new Set(sips.map((s) => s.category).filter((c): c is string => !!c))).sort(),
    [sips]
  );

  const filteredSips = useMemo(() => {
    return sips.filter((s) => {
      if (sipFilterOwner !== "all" && s.owner !== sipFilterOwner) return false;
      if (sipFilterFrequency !== "all" && s.frequency !== sipFilterFrequency) return false;
      if (sipFilterCategory !== "all" && s.category !== sipFilterCategory) return false;
      if (sipFilterStatus === "active" && !s.is_active) return false;
      if (sipFilterStatus === "paused" && s.is_active) return false;
      return true;
    });
  }, [sips, sipFilterOwner, sipFilterFrequency, sipFilterCategory, sipFilterStatus]);

  // --- "Lumpsum Purchases" table filters ---
  const [lumpsumFilterOwner, setLumpsumFilterOwner] = useState<"all" | Owner>("all");
  const [lumpsumFilterCategory, setLumpsumFilterCategory] = useState("all");

  const groupedLumpsums = useMemo(() => groupLumpsums(lumpsums), [lumpsums]);

  const lumpsumCategoryOptions = useMemo(
    () => Array.from(new Set(groupedLumpsums.map((l) => l.category))).sort(),
    [groupedLumpsums]
  );

  const filteredLumpsums = useMemo(() => {
    return groupedLumpsums.filter((l) => {
      if (lumpsumFilterOwner !== "all" && l.owner !== lumpsumFilterOwner) return false;
      if (lumpsumFilterCategory !== "all" && l.category !== lumpsumFilterCategory) return false;
      return true;
    });
  }, [groupedLumpsums, lumpsumFilterOwner, lumpsumFilterCategory]);

  const occurrencesThisView = useMemo(
    () => computeOccurrences(sips, viewYear, viewMonth),
    [sips, viewYear, viewMonth]
  );

  const sipView = useMemo(
    () => computeSipCalendarView(sips, sipLots, pendingOrders, viewYear, viewMonth, today),
    [sips, sipLots, pendingOrders, viewYear, viewMonth, today]
  );

  const lumpsumsByDay = useMemo(
    () => computeLumpsumsByDay(lumpsums, viewYear, viewMonth),
    [lumpsums, viewYear, viewMonth]
  );

  const sellsByDay = useMemo(
    () => computeSellsByDay(sells, viewYear, viewMonth),
    [sells, viewYear, viewMonth]
  );

  const totalThisMonth = useMemo(() => {
    let sum = 0;
    occurrencesThisView.forEach((list) =>
      list.forEach((o) => (sum += o.sip.amount))
    );
    return sum;
  }, [occurrencesThisView]);

  const totalsByOwner = useMemo(() => {
    const totals: Record<Owner, number> = { praveen: 0, geetha: 0 };
    occurrencesThisView.forEach((list) =>
      list.forEach((o) => {
        totals[o.sip.owner] += o.sip.amount;
      })
    );
    return totals;
  }, [occurrencesThisView]);

  const nextSipCountdown = useMemo(() => {
    const occ = computeOccurrences(sips, today.getFullYear(), today.getMonth());
    const upcomingDays: number[] = [];
    occ.forEach((_list, day) => {
      if (day >= today.getDate()) upcomingDays.push(day);
    });
    if (upcomingDays.length === 0) return null;
    return Math.min(...upcomingDays) - today.getDate();
  }, [sips, today]);

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const dim = daysInMonth(viewYear, viewMonth);
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const totalCells = Math.ceil((firstDow + dim) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - firstDow + 1;
    return dayNum >= 1 && dayNum <= dim ? dayNum : null;
  });

  const isToday = (day: number) =>
    day === today.getDate() &&
    viewMonth === today.getMonth() &&
    viewYear === today.getFullYear();

  const handleSchemeSearch = async (query: string) => {
    setFSchemeName(query);
    setFSchemeCode(null);

    if (query.trim().length < 3) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(
        `https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`
      );
      if (res.ok) {
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data.slice(0, 8) : []);
      } else {
        setSearchResults([]);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const selectScheme = (scheme: SchemeSearchResult) => {
    setFSchemeName(scheme.schemeName);
    setFSchemeCode(String(scheme.schemeCode));
    setSearchResults([]);
  };

  const resetForm = () => {
    setFOwner("praveen");
    setFSchemeName("");
    setFSchemeCode(null);
    setFCategory(CATEGORY_OPTIONS[0]);
    setFAmount("");
    setFSipDate("1");
    setFStartDate(today.toISOString().slice(0, 10));
    setFFrequency("monthly");
    setSearchResults([]);
    setFormError(null);
  };

  const handleAddSip = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);

    const amountNum = Number(fAmount);
    const sipDateNum = Number(fSipDate);

    if (!fSchemeName.trim()) {
      setFormError("Fund name is required.");
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setFormError("Enter a valid amount.");
      return;
    }
    if (!Number.isInteger(sipDateNum) || sipDateNum < 1 || sipDateNum > 31) {
      setFormError("SIP date must be between 1 and 31.");
      return;
    }
    if (!fStartDate) {
      setFormError("Start date is required.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/mf/sip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: fOwner,
          scheme_code: fSchemeCode,
          scheme_name: fSchemeName.trim(),
          category: fCategory,
          amount: amountNum,
          sip_date: sipDateNum,
          frequency: fFrequency,
          start_date: fStartDate,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error ?? "Failed to save SIP.");
        return;
      }

      setSips((prev) => [...prev, json.data as MFSIPSchedule]);
      resetForm();
      setShowAddForm(false);
    } catch {
      setFormError("Failed to save SIP.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (sip: MFSIPSchedule) => {
    try {
      const res = await fetch(`/api/mf/sip/${sip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !sip.is_active }),
      });
      if (res.ok) {
        const json = await res.json();
        setSips((prev) =>
          prev.map((s) => (s.id === sip.id ? (json.data as MFSIPSchedule) : s))
        );
      }
    } catch (err) {
      console.error("Failed to toggle SIP:", err);
    }
  };

  const deleteSip = async (id: string) => {
    try {
      const res = await fetch(`/api/mf/sip/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSips((prev) => prev.filter((s) => s.id !== id));
      }
    } catch (err) {
      console.error("Failed to delete SIP:", err);
    }
  };

  // Deleting removes the whole recurring schedule, not one instalment.
  const confirmDeleteSip = (sip: MFSIPSchedule) => {
    const owner = sip.owner === "praveen" ? "Praveen" : "Geetha";
    const message =
      `Delete the entire recurring SIP schedule for ${sip.scheme_name} ` +
      `(${owner}, ${ordinal(sip.sip_date)}, ${sip.frequency})? Past purchases are not affected.`;
    if (window.confirm(message)) deleteSip(sip.id);
  };

  const toggleNotify = async (sip: MFSIPSchedule, field: "notify_email" | "notify_sms") => {
    const nextValue = !sip[field];
    try {
      const res = await fetch(`/api/mf/sip/${sip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: nextValue }),
      });
      if (res.ok) {
        const json = await res.json();
        setSips((prev) =>
          prev.map((s) => (s.id === sip.id ? (json.data as MFSIPSchedule) : s))
        );
      }
    } catch (err) {
      console.error(`Failed to toggle ${field}:`, err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={userEmail} />

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Summary bar */}
        <div className="mb-6 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <p className="text-xs font-medium text-slate-500">
              Total SIP this month
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              ₹{totalThisMonth.toLocaleString("en-IN")}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">SIPs executed</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              ₹{Math.round(sipView.executedTotal).toLocaleString("en-IN")}{" "}
              <span className="text-sm font-normal text-slate-500">({sipView.executedCount})</span>
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Processing</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              ₹{Math.round(sipView.processingTotal).toLocaleString("en-IN")}{" "}
              <span className="text-sm font-normal text-slate-500">({sipView.processingCount})</span>
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">By owner</p>
            <p className="mt-1 text-sm text-slate-700">
              <span className="text-blue-600">
                Praveen: ₹{totalsByOwner.praveen.toLocaleString("en-IN")}
              </span>
              <span className="mx-2 text-slate-300">|</span>
              <span className="text-amber-600">
                Geetha: ₹{totalsByOwner.geetha.toLocaleString("en-IN")}
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Next SIP</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {nextSipCountdown === null
                ? "No more SIPs this month"
                : nextSipCountdown === 0
                  ? "Today"
                  : `In ${nextSipCountdown} day${nextSipCountdown === 1 ? "" : "s"}`}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">
              Owner filter
            </p>
            <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-1">
              {(["all", "praveen", "geetha"] as OwnerFilter[]).map((o) => (
                <button
                  key={o}
                  onClick={() => setOwnerFilter(o)}
                  className={`flex-1 rounded-md px-2 py-1 text-xs font-medium capitalize transition ${
                    ownerFilter === o
                      ? "bg-white text-blue-600 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {o === "all" ? "All" : o}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Calendar */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <button
              onClick={goPrevMonth}
              aria-label="Previous month"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              ←
            </button>
            <h2 className="text-lg font-semibold text-slate-800">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </h2>
            <button
              onClick={goNextMonth}
              aria-label="Next month"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-xs">
            {WEEKDAY_NAMES.map((d) => (
              <div
                key={d}
                className="bg-slate-100 px-2 py-2 text-center font-medium text-slate-500"
              >
                {d}
              </div>
            ))}

            {cells.map((day, i) => {
              const weekendCol = i % 7 === 0 || i % 7 === 6;
              const occ = day
                ? (sipView.chipsByDay.get(day) ?? []).filter(
                    (c) => ownerFilter === "all" || c.sip.owner === ownerFilter
                  )
                : [];
              const dayUnscheduled = day
                ? (sipView.unscheduledByDay.get(day) ?? []).filter(
                    (l) => ownerFilter === "all" || l.owner === ownerFilter
                  )
                : [];
              const dayPending = day
                ? (sipView.unscheduledPendingByDay.get(day) ?? []).filter(
                    (p) => ownerFilter === "all" || p.order.owner === ownerFilter
                  )
                : [];
              const dayLumpsums = day
                ? (lumpsumsByDay.get(day) ?? []).filter(
                    (l) => ownerFilter === "all" || l.owner === ownerFilter
                  )
                : [];
              const daySells = day
                ? (sellsByDay.get(day) ?? []).filter(
                    (s) => ownerFilter === "all" || s.owner === ownerFilter
                  )
                : [];

              return (
                <div
                  key={i}
                  className={`min-h-[92px] p-1.5 ${
                    weekendCol ? "bg-slate-50" : "bg-white"
                  } ${day && isToday(day) ? "ring-2 ring-inset ring-blue-500" : ""}`}
                >
                  {day && (
                    <>
                      <span className="text-[11px] font-medium text-slate-500">
                        {day}
                      </span>
                      <div className="mt-1 flex flex-col gap-1">
                        {occ.map(({ key, status, sip, scheduled, isWeekend, lot, pending, stale, shift, shownOn }) => {
                          const isPraveen = sip.owner === "praveen";
                          const amount = lot?.amount ?? pending?.amount ?? sip.amount;
                          let title = `${sip.scheme_name} — ₹${sip.amount.toLocaleString("en-IN")}`;
                          let chipClass = isPraveen ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700";
                          let label = `${sip.scheme_name} · ₹${amount.toLocaleString("en-IN")}`;
                          if (status === "processing" && pending) {
                            const orderDate = localDateFromIso(pending.trade_date);
                            title =
                              `⏳ ${sip.scheme_name}\nProcessing since ${formatDayMonth(orderDate)} · ₹${pending.amount.toLocaleString("en-IN")} · units not allotted yet` +
                              (shift ? `\nFor the ${formatShortDate(scheduled)} instalment (${shift})` : "") +
                              (stale ? "\nStill processing after 7 days — check Coin; re-import once settled" : "");
                            chipClass = `border border-dashed bg-white ${isPraveen ? "border-blue-400 text-blue-700" : "border-amber-400 text-amber-700"}`;
                            if (shift && shownOn === "lot") {
                              label = `${sip.scheme_name} · ${MONTH_NAMES[scheduled.getMonth()].slice(0, 3)} ${ordinal(scheduled.getDate())} SIP (${shift})`;
                            }
                          } else if (status === "executed" && lot && shift) {
                            const lotDate = localDateFromIso(lot.trade_date);
                            const detail = `₹${lot.amount.toLocaleString("en-IN")} · ${formatUnits(lot.units)} units`;
                            if (shownOn === "scheduled") {
                              title = `✓ ${sip.scheme_name}\nExecuted ${shift} on ${formatDayMonth(lotDate)} · ${detail}`;
                              chipClass = isPraveen ? "bg-blue-600 text-white" : "bg-amber-500 text-white";
                            } else {
                              title =
                                `✓ ${sip.scheme_name}\nExecuted ${shift} on ${formatDayMonth(lotDate)} · ${detail}\n` +
                                `Counts as the ${formatShortDate(scheduled)} instalment`;
                              chipClass = `border bg-white ${isPraveen ? "border-blue-400 text-blue-700" : "border-amber-400 text-amber-700"}`;
                              label = `${sip.scheme_name} · ${MONTH_NAMES[scheduled.getMonth()].slice(0, 3)} ${ordinal(scheduled.getDate())} SIP (${shift})`;
                            }
                          } else if (status === "executed" && lot) {
                            title =
                              `✓ Executed — ${sip.scheme_name}\n` +
                              `${formatShortDate(localDateFromIso(lot.trade_date))} · ₹${lot.amount.toLocaleString("en-IN")} · ${formatUnits(lot.units)} units\n` +
                              `Scheduled ${formatShortDate(scheduled)}`;
                            chipClass = isPraveen ? "bg-blue-600 text-white" : "bg-amber-500 text-white";
                          } else if (status === "missed") {
                            title =
                              `${sip.scheme_name} — ₹${sip.amount.toLocaleString("en-IN")} (scheduled ${formatShortDate(scheduled)})\n` +
                              "No SIP purchase found in imported data — re-import Coin CSV if it executed";
                            chipClass = `border border-dashed bg-white text-slate-400 ${isPraveen ? "border-blue-200" : "border-amber-200"}`;
                          }
                          return (
                            <div key={key} className="group relative">
                              <span
                                title={title}
                                className={`block truncate rounded-full px-2 py-0.5 pr-4 text-[10px] font-medium ${chipClass}`}
                              >
                                {status === "executed" && "✓ "}
                                {status === "processing" && stale && <span className="font-bold text-amber-500">! </span>}
                                {status === "processing" && "⏳ "}
                                {status === "missed" && <span className="font-bold text-red-400">! </span>}
                                {label}
                              </span>
                              <button
                                type="button"
                                onClick={() => confirmDeleteSip(sip)}
                                aria-label="Delete SIP"
                                title="Delete SIP"
                                className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold leading-none text-white group-hover:flex"
                              >
                                ×
                              </button>
                              {isWeekend && status === "upcoming" && (
                                <span className="mt-0.5 block text-[9px] text-slate-400">
                                  → next trading day
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {dayUnscheduled.map((l, ui) => (
                          <span
                            key={`unscheduled-${ui}`}
                            title={`SIP (no schedule) — ${l.scheme_name}\n${formatShortDate(localDateFromIso(l.trade_date))} · ₹${l.amount.toLocaleString("en-IN")} · ${formatUnits(l.units)} units`}
                            className={`block truncate rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                              l.owner === "praveen"
                                ? "border-blue-300 bg-blue-50 text-blue-700"
                                : "border-amber-300 bg-amber-50 text-amber-700"
                            }`}
                          >
                            ✓ {l.scheme_name} · {formatMoneyAbbrev(l.amount)} · SIP (no schedule)
                          </span>
                        ))}
                        {dayPending.map(({ order, stale }, pi) => (
                          <span
                            key={`pending-${pi}`}
                            title={
                              `⏳ ${order.scheme_name} (${order.lot_type === "sip" ? "SIP" : "Lumpsum"})\n` +
                              `Processing since ${formatDayMonth(localDateFromIso(order.trade_date))} · ₹${order.amount.toLocaleString("en-IN")} · units not allotted yet` +
                              (order.remarks ? `\n${order.remarks}` : "") +
                              (stale ? "\nStill processing after 7 days — check Coin; re-import once settled" : "")
                            }
                            className={`block truncate rounded-full border border-dashed bg-white px-2 py-0.5 text-[10px] font-medium ${
                              order.owner === "praveen" ? "border-blue-400 text-blue-700" : "border-amber-400 text-amber-700"
                            }`}
                          >
                            {stale && <span className="font-bold text-amber-500">! </span>}⏳ {order.scheme_name} ·{" "}
                            {formatMoneyAbbrev(order.amount)} · {order.lot_type === "sip" ? "SIP" : "lumpsum"} processing
                          </span>
                        ))}
                        {dayLumpsums.map((l, li) => (
                          <div key={`lumpsum-${li}`} className="flex items-center gap-1">
                            <span
                              className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold ${
                                l.owner === "praveen"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {l.owner === "praveen" ? "P" : "G"}
                            </span>
                            <span
                              title={`Lumpsum — ${l.scheme_name} — ₹${l.amount.toLocaleString("en-IN")}`}
                              className="block flex-1 truncate rounded-full border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600"
                            >
                              {l.scheme_name} · {formatMoneyAbbrev(l.amount)}
                            </span>
                          </div>
                        ))}
                        {daySells.map((s, si) => (
                          <div key={`sell-${si}`} className="flex items-center gap-1">
                            <span
                              className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold ${
                                s.owner === "praveen"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {s.owner === "praveen" ? "P" : "G"}
                            </span>
                            <span
                              title={`Sell — ${s.scheme_name} — ${formatMoneyAbbrev(s.amount)}`}
                              className="block flex-1 truncate rounded-full border border-red-200 bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-700"
                            >
                              ↓ {s.scheme_name} · {formatMoneyAbbrev(s.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white">✓ Praveen</span>
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-medium text-white">✓ Geetha</span>
              SIP executed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded-full border border-blue-400 bg-white px-2 py-0.5 text-[10px] font-medium text-blue-700">✓ Nov 1st SIP (early)</span>
              Executed early/late for another month&apos;s SIP
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded-full border border-dashed border-blue-400 bg-white px-2 py-0.5 text-[10px] font-medium text-blue-700">⏳ SIP</span>
              Processing (Coin hasn&apos;t settled it yet;{" "}
              <span className="font-bold text-amber-500">!</span> = over 7 days)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">Praveen</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Geetha</span>
              SIP upcoming
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded-full border border-dashed border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-400">
                <span className="font-bold text-red-400">!</span> SIP
              </span>
              Missed / not found in imported data
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">✓ SIP</span>
              SIP (no schedule)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">Fund</span>
              Lumpsum
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">↓ Fund</span>
              Sell
            </span>
          </div>
        </div>

        {/* SIP list */}
        <div className="mt-8 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-800">All SIPs</h3>
            <button
              onClick={() => {
                setShowAddForm((v) => !v);
                if (showAddForm) resetForm();
              }}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              {showAddForm ? "Close" : "+ Add SIP"}
            </button>
          </div>

          {showAddForm && (
            <form
              onSubmit={handleAddSip}
              className="space-y-4 border-b border-slate-200 px-4 py-4"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Owner
                  </label>
                  <select
                    value={fOwner}
                    onChange={(e) => setFOwner(e.target.value as Owner)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="praveen">Praveen</option>
                    <option value="geetha">Geetha</option>
                  </select>
                </div>

                <div className="relative sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Fund name
                  </label>
                  <input
                    type="text"
                    value={fSchemeName}
                    onChange={(e) => handleSchemeSearch(e.target.value)}
                    placeholder="Search mfapi.in…"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  {searching && (
                    <p className="mt-1 text-xs text-slate-400">Searching…</p>
                  )}
                  {searchResults.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {searchResults.map((s) => (
                        <li key={s.schemeCode}>
                          <button
                            type="button"
                            onClick={() => selectScheme(s)}
                            className="block w-full truncate px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                          >
                            {s.schemeName}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Category
                  </label>
                  <select
                    value={fCategory}
                    onChange={(e) => setFCategory(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Amount (₹)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={fAmount}
                    onChange={(e) => setFAmount(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    SIP date
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={fSipDate}
                    onChange={(e) => setFSipDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={fStartDate}
                    onChange={(e) => setFStartDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Frequency
                  </label>
                  <select
                    value={fFrequency}
                    onChange={(e) => setFFrequency(e.target.value as SIPFrequency)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="bi-weekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
              </div>

              {formError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {formError}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    resetForm();
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
            <span className="text-xs font-medium text-slate-400">Filter:</span>
            <select
              value={sipFilterOwner}
              onChange={(e) => setSipFilterOwner(e.target.value as "all" | Owner)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All owners</option>
              <option value="praveen">Praveen</option>
              <option value="geetha">Geetha</option>
            </select>
            <select
              value={sipFilterFrequency}
              onChange={(e) => setSipFilterFrequency(e.target.value as "all" | SIPFrequency)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All frequencies</option>
              <option value="weekly">Weekly</option>
              <option value="bi-weekly">Bi-weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
            <select
              value={sipFilterCategory}
              onChange={(e) => setSipFilterCategory(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All categories</option>
              {sipCategoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={sipFilterStatus}
              onChange={(e) => setSipFilterStatus(e.target.value as "all" | "active" | "paused")}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium">Fund name</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">SIP date</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">SMS</th>
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sips.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                      No SIPs yet.
                    </td>
                  </tr>
                )}
                {sips.length > 0 && filteredSips.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                      No SIPs match the selected filters.
                    </td>
                  </tr>
                )}
                {filteredSips.map((sip) => (
                  <tr key={sip.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 text-slate-800">{sip.scheme_name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                          sip.owner === "praveen"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {sip.owner === "praveen" ? "P" : "G"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      ₹{sip.amount.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {ordinal(sip.sip_date)} of every{" "}
                      {sip.frequency === "weekly"
                        ? "week"
                        : sip.frequency === "bi-weekly"
                          ? "2 weeks"
                          : sip.frequency === "monthly"
                            ? "month"
                            : "quarter"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {sip.category ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          sip.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {sip.is_active ? "Active" : "Paused"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={sip.notify_email}
                        onChange={() => toggleNotify(sip, "notify_email")}
                        aria-label="Email notifications"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={sip.notify_sms}
                        onChange={() => toggleNotify(sip, "notify_sms")}
                        aria-label="SMS notifications"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button
                          onClick={() => toggleActive(sip)}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          {sip.is_active ? "Pause" : "Resume"}
                        </button>
                        <button
                          onClick={() => confirmDeleteSip(sip)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Lumpsum purchases */}
        {lumpsums.length > 0 && (
          <div className="mt-8 rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-800">Lumpsum Purchases</h3>
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
              <span className="text-xs font-medium text-slate-400">Filter:</span>
              <select
                value={lumpsumFilterOwner}
                onChange={(e) => setLumpsumFilterOwner(e.target.value as "all" | Owner)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">All owners</option>
                <option value="praveen">Praveen</option>
                <option value="geetha">Geetha</option>
              </select>
              <select
                value={lumpsumFilterCategory}
                onChange={(e) => setLumpsumFilterCategory(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">All categories</option>
                {lumpsumCategoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-4 py-2 font-medium">Fund name</th>
                    <th className="px-4 py-2 font-medium">Owner</th>
                    <th className="px-4 py-2 font-medium">Total invested</th>
                    <th className="px-4 py-2 font-medium">Last purchase date</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLumpsums.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                        No lumpsum purchases match the selected filters.
                      </td>
                    </tr>
                  )}
                  {filteredLumpsums.map((l) => (
                    <tr key={l.key} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 text-slate-800">{l.scheme_name}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                            l.owner === "praveen"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {l.owner === "praveen" ? "P" : "G"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        ₹{l.amount.toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{l.trade_date}</td>
                      <td className="px-4 py-3 text-slate-600">{l.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
