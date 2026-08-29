"use client";

import { useMemo, useState, type FormEvent } from "react";
import AppHeader from "@/components/AppHeader";
import type { MFSIPSchedule, Owner, SIPFrequency } from "@/types/mf";

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

    const day = Math.min(sip.sip_date, dim);
    const dow = new Date(year, month, day).getDay();
    const isWeekend = dow === 0 || dow === 6;

    const existing = map.get(day) ?? [];
    existing.push({ sip, isWeekend });
    map.set(day, existing);
  }

  return map;
}

export default function SIPCalendarClient({
  userEmail,
  initialSips,
}: {
  userEmail: string;
  initialSips: MFSIPSchedule[];
}) {
  const today = useMemo(() => new Date(), []);

  const [sips, setSips] = useState<MFSIPSchedule[]>(initialSips);
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

  const occurrencesThisView = useMemo(
    () => computeOccurrences(sips, viewYear, viewMonth),
    [sips, viewYear, viewMonth]
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

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={userEmail} />

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Summary bar */}
        <div className="mb-6 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-medium text-slate-500">
              Total SIP this month
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              ₹{totalThisMonth.toLocaleString("en-IN")}
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
                ? (occurrencesThisView.get(day) ?? []).filter(
                    (o) => ownerFilter === "all" || o.sip.owner === ownerFilter
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
                        {occ.map(({ sip, isWeekend }) => (
                          <div key={sip.id}>
                            <span
                              title={`${sip.scheme_name} — ₹${sip.amount.toLocaleString("en-IN")}`}
                              className={`block truncate rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                sip.owner === "praveen"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {sip.scheme_name} · ₹{sip.amount.toLocaleString("en-IN")}
                            </span>
                            {isWeekend && (
                              <span className="mt-0.5 block text-[9px] text-slate-400">
                                → next trading day
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
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
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sips.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                      No SIPs yet.
                    </td>
                  </tr>
                )}
                {sips.map((sip) => (
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
                      {sip.frequency === "monthly" ? "month" : "quarter"}
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
                      <div className="flex gap-3">
                        <button
                          onClick={() => toggleActive(sip)}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          {sip.is_active ? "Pause" : "Resume"}
                        </button>
                        <button
                          onClick={() => deleteSip(sip.id)}
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
      </main>
    </div>
  );
}
