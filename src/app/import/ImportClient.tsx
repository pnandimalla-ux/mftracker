"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import {
  parseCasCsv,
  type Confidence,
  type ParsedHolding,
  type ParseRowError,
} from "@/lib/parsers/casCsvParser";
import type { MFCASImport, Owner } from "@/types/mf";
import { CATEGORY_OPTIONS } from "@/lib/categoryOptions";

const STEPS = [
  "Go to camsonline.com → Mailback Services",
  "Request Consolidated Account Statement (enter both PANs)",
  "Download CSV and upload below",
];

interface SchemeSearchResult {
  schemeCode: number;
  schemeName: string;
}

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

interface PreviewRow extends ParsedHolding {
  key: string;
  selected: boolean;
  editing: boolean;
}

function OwnerToggleCards({
  value,
  onChange,
}: {
  value: Owner;
  onChange: (owner: Owner) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["praveen", "geetha"] as Owner[]).map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-xl border-2 px-4 py-3 text-left transition ${
            value === o
              ? "border-blue-600 bg-blue-50"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <p className="text-sm font-semibold text-slate-800">
            {o === "praveen" ? "Praveen" : "Geetha"}
          </p>
          <p className="text-xs text-slate-500">
            {o === "praveen" ? "YE7266" : "WKT509"}
          </p>
        </button>
      ))}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: Confidence }) {
  const styles: Record<Confidence, string> = {
    high: "bg-green-100 text-green-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[level]}`}>
      {level[0].toUpperCase() + level.slice(1)}
    </span>
  );
}

export default function ImportClient({
  userEmail,
  initialImportHistory,
}: {
  userEmail: string;
  initialImportHistory: MFCASImport[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- CAS import state ---
  const [casOwner, setCasOwner] = useState<Owner>("praveen");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [parseRowErrors, setParseRowErrors] = useState<ParseRowError[]>([]);
  const [importHistory] = useState<MFCASImport[]>(initialImportHistory);
  const [confirming, setConfirming] = useState(false);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // --- Manual add form state ---
  const [mOwner, setMOwner] = useState<Owner>("praveen");
  const [mSchemeName, setMSchemeName] = useState("");
  const [mSchemeCode, setMSchemeCode] = useState<string | null>(null);
  const [mCategory, setMCategory] = useState(CATEGORY_OPTIONS[0]);
  const [mAmc, setMAmc] = useState("");
  const [mUnits, setMUnits] = useState("");
  const [mAvgNav, setMAvgNav] = useState("");
  const [mInvested, setMInvested] = useState("");
  const [mAsOnDate, setMAsOnDate] = useState(() => daysAgoIso(30));
  const [mDateTouched, setMDateTouched] = useState(false);
  const [mDateError, setMDateError] = useState<string | null>(null);
  const [mNavLoading, setMNavLoading] = useState(false);
  const [mNavError, setMNavError] = useState<string | null>(null);
  const [mNavExhausted, setMNavExhausted] = useState(false);
  const [mNavSlow, setMNavSlow] = useState(false);
  const [mManualMode, setMManualMode] = useState(false);
  const [mSearchResults, setMSearchResults] = useState<SchemeSearchResult[]>([]);
  const [mSearching, setMSearching] = useState(false);
  const [mSaving, setMSaving] = useState(false);
  const [mError, setMError] = useState<string | null>(null);
  const [mToast, setMToast] = useState(false);

  // Units are always derived from invested amount ÷ NAV — unless the user has
  // switched to manual entry, in which case they type both directly.
  useEffect(() => {
    if (mManualMode) return;
    const amt = Number(mInvested);
    const nav = Number(mAvgNav);
    if (Number.isFinite(amt) && amt > 0 && Number.isFinite(nav) && nav > 0) {
      setMUnits((amt / nav).toFixed(4));
    } else {
      setMUnits("");
    }
  }, [mInvested, mAvgNav, mManualMode]);

  // Whenever both a fund and a date are picked, auto-fetch the NAV for that
  // date, retrying prior trading days when the market was closed. Skipped
  // entirely while the user has switched to manual NAV/units entry.
  useEffect(() => {
    if (mManualMode) return;
    if (!mSchemeCode || !mAsOnDate) {
      setMNavError(null);
      return;
    }
    if (mAsOnDate > todayIso()) {
      // Invalid (future) date — handled by the inline date error instead.
      setMNavError(null);
      return;
    }

    let cancelled = false;

    const shiftDate = (iso: string, days: number) => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };

    const run = async () => {
      setMNavLoading(true);
      setMNavError(null);
      setMNavExhausted(false);
      setMNavSlow(false);
      setMAvgNav("");

      const slowTimer = setTimeout(() => {
        if (!cancelled) setMNavSlow(true);
      }, 5000);

      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        const tryDate = shiftDate(mAsOnDate, -attempt);
        try {
          const res = await fetch(`/api/mf/nav/${mSchemeCode}?date=${tryDate}`);
          if (res.ok) {
            const json = await res.json();
            const nav = Number(json?.data?.nav);
            if (Number.isFinite(nav) && nav > 0) {
              if (!cancelled) {
                setMAvgNav(String(nav));
                setMNavError(null);
                setMNavLoading(false);
                setMNavSlow(false);
              }
              clearTimeout(slowTimer);
              return;
            }
          }
        } catch {
          // treat as a miss for this date and fall through to retry
        }
        if (!cancelled && attempt < 4) {
          setMNavError(
            "NAV not available for this date — trying nearest trading day…"
          );
        }
      }

      clearTimeout(slowTimer);
      if (!cancelled) {
        setMNavError(
          `NAV not available for ${mAsOnDate}. Try a nearby date or enter manually.`
        );
        setMNavExhausted(true);
        setMNavLoading(false);
        setMNavSlow(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [mSchemeCode, mAsOnDate, mManualMode]);

  // --- CAS upload handlers ---

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setPreviewRows([]);
      setParseRowErrors([]);
      setParseError(null);
      setImportSuccess(null);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    if (!dropped.name.toLowerCase().endsWith(".csv")) {
      setParseError("Please upload a .csv file.");
      return;
    }
    setFile(dropped);
    setPreviewRows([]);
    setParseRowErrors([]);
    setParseError(null);
    setImportSuccess(null);
  };

  const handleParsePreview = async () => {
    if (!file) return;
    setParsing(true);
    setParseError(null);
    setPreviewRows([]);
    setParseRowErrors([]);
    try {
      const text = await file.text();
      const result = await parseCasCsv(text);
      if (result.holdings.length === 0) {
        setParseError("No importable holdings were found in this file.");
      }
      setPreviewRows(
        result.holdings.map((h, i) => ({
          ...h,
          key: `${i}-${h.scheme_name}`,
          selected: true,
          editing: false,
        }))
      );
      setParseRowErrors(result.errors);
    } catch (err) {
      console.error("CAS parse failed:", err);
      setParseError(
        "Could not parse this file. Please check it's a valid CAMS CAS CSV export."
      );
    } finally {
      setParsing(false);
    }
  };

  const updateRow = (key: string, patch: Partial<PreviewRow>) => {
    setPreviewRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r))
    );
  };

  const selectedRows = previewRows.filter((r) => r.selected);
  const selectedTotal = selectedRows.reduce((sum, r) => sum + r.invested_amount, 0);

  const handleConfirmImport = async () => {
    if (selectedRows.length === 0) return;
    setConfirming(true);
    setParseError(null);
    try {
      const res = await fetch("/api/mf/import/cas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: casOwner,
          filename: file?.name ?? null,
          rows: selectedRows.map((r) => ({
            scheme_name: r.scheme_name,
            scheme_code: r.scheme_code,
            category: r.category,
            units: r.units,
            avg_nav: r.avg_nav,
            invested_amount: r.invested_amount,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setParseError(json.error ?? "Import failed.");
        return;
      }
      setImportSuccess(
        `${json.imported} fund${json.imported === 1 ? "" : "s"} imported successfully`
      );
      setTimeout(() => {
        router.push("/dashboard");
      }, 2000);
    } catch (err) {
      console.error("CAS import failed:", err);
      setParseError("Import failed. Please try again.");
    } finally {
      setConfirming(false);
    }
  };

  // --- Manual add handlers ---

  const handleManualSchemeSearch = async (query: string) => {
    setMSchemeName(query);
    setMSchemeCode(null);
    if (query.trim().length < 3) {
      setMSearchResults([]);
      return;
    }
    setMSearching(true);
    try {
      const res = await fetch(
        `https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`
      );
      if (res.ok) {
        const data = await res.json();
        setMSearchResults(Array.isArray(data) ? data.slice(0, 8) : []);
      } else {
        setMSearchResults([]);
      }
    } catch {
      setMSearchResults([]);
    } finally {
      setMSearching(false);
    }
  };

  const selectManualScheme = async (scheme: SchemeSearchResult) => {
    setMSchemeName(scheme.schemeName);
    setMSchemeCode(String(scheme.schemeCode));
    setMSearchResults([]);
    try {
      const res = await fetch(`https://api.mfapi.in/mf/${scheme.schemeCode}`);
      if (res.ok) {
        const json = await res.json();
        const fundHouse = json?.meta?.fund_house;
        if (typeof fundHouse === "string" && fundHouse) {
          setMAmc(fundHouse);
        }
      }
    } catch {
      // best-effort only — AMC field stays editable regardless.
    }
  };

  const resetManualForm = () => {
    setMOwner("praveen");
    setMSchemeName("");
    setMSchemeCode(null);
    setMCategory(CATEGORY_OPTIONS[0]);
    setMAmc("");
    setMUnits("");
    setMAvgNav("");
    setMInvested("");
    setMAsOnDate(daysAgoIso(30));
    setMDateTouched(false);
    setMDateError(null);
    setMNavError(null);
    setMNavExhausted(false);
    setMNavSlow(false);
    setMNavLoading(false);
    setMManualMode(false);
    setMSearchResults([]);
  };

  const handleDateChange = (value: string) => {
    setMAsOnDate(value);
    setMDateTouched(true);
    setMDateError(value > todayIso() ? "Purchase date cannot be in the future" : null);
  };

  const switchToManual = () => {
    setMManualMode(true);
    setMNavLoading(false);
    setMNavSlow(false);
    setMNavError(null);
    setMNavExhausted(false);
  };

  const switchToAutoFetch = () => {
    setMAvgNav("");
    setMUnits("");
    setMNavError(null);
    setMNavExhausted(false);
    setMNavSlow(false);
    setMManualMode(false);
  };

  const handleAddFundManually = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMError(null);

    const units = Number(mUnits);
    const avgNav = Number(mAvgNav);
    const invested = Number(mInvested);

    if (!mSchemeName.trim()) {
      setMError("Fund name is required.");
      return;
    }
    if (!mCategory) {
      setMError("Category is required.");
      return;
    }
    if (!Number.isFinite(units) || units <= 0) {
      setMError("Units must be a positive number.");
      return;
    }
    if (!Number.isFinite(avgNav) || avgNav <= 0) {
      setMError("Average NAV must be a positive number.");
      return;
    }
    if (!Number.isFinite(invested) || invested <= 0) {
      setMError("Invested amount must be a positive number.");
      return;
    }
    if (!mAsOnDate) {
      setMError("As on date is required.");
      return;
    }
    if (mAsOnDate > todayIso()) {
      setMError("Purchase date cannot be in the future.");
      return;
    }

    setMSaving(true);
    try {
      const res = await fetch("/api/mf/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: mOwner,
          scheme_code: mSchemeCode,
          scheme_name: mSchemeName.trim(),
          category: mCategory,
          amc: mAmc.trim() || null,
          units,
          avg_nav: avgNav,
          invested_amount: invested,
          as_on_date: mAsOnDate,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMError(json.error ?? "Failed to add fund.");
        return;
      }
      setMToast(true);
      setTimeout(() => setMToast(false), 3000);
      resetManualForm();
    } catch (err) {
      console.error("Failed to add fund:", err);
      setMError("Failed to add fund. Please try again.");
    } finally {
      setMSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={userEmail} />

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left card — CAMS CAS import */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <span className="text-lg">📁</span>
              <h2 className="text-base font-semibold text-slate-800">
                Import from CAMS CAS
              </h2>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Download your Consolidated Account Statement from
              camsonline.com → Mailback Services. Covers all AMCs for both
              PANs in one file.
            </p>

            <ol className="mt-4 space-y-3">
              {STEPS.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                    {i + 1}
                  </span>
                  <span className="text-sm text-slate-600">{step}</span>
                </li>
              ))}
            </ol>

            <div className="mt-5">
              <p className="mb-2 text-xs font-medium text-slate-700">Owner</p>
              <OwnerToggleCards value={casOwner} onChange={setCasOwner} />
            </div>

            <div className="mt-5">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
                  dragOver
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-300 bg-slate-50 hover:border-slate-400"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileInputChange}
                />
                <p className="text-sm font-medium text-slate-600">
                  Drop CSV here or click to browse
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  CAMS CAS export (.csv)
                </p>
              </div>

              {file && (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      {file.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <button
                    onClick={handleParsePreview}
                    disabled={parsing}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {parsing ? "Parsing…" : "Parse & Preview"}
                  </button>
                </div>
              )}

              {parseError && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {parseError}
                </p>
              )}

              {importSuccess && (
                <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                  {importSuccess} — redirecting to dashboard…
                </p>
              )}
            </div>

            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                Import history
              </h3>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Owner</th>
                      <th className="px-3 py-2 font-medium">File</th>
                      <th className="px-3 py-2 font-medium">Rows</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importHistory.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                          No imports yet.
                        </td>
                      </tr>
                    ) : (
                      importHistory.map((imp) => (
                        <tr key={imp.id} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-2 text-slate-600">
                            {new Date(imp.imported_at).toLocaleDateString("en-IN")}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                                imp.owner === "praveen"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {imp.owner === "praveen" ? "P" : "G"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {imp.filename ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {imp.rows_imported}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                imp.status === "success"
                                  ? "bg-green-100 text-green-700"
                                  : imp.status === "partial"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-red-100 text-red-700"
                              }`}
                            >
                              {imp.status ?? "unknown"}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right card — Add fund manually */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-800">
              Add fund manually
            </h2>

            {mToast && (
              <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                Fund added successfully
              </p>
            )}

            <form onSubmit={handleAddFundManually} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Owner
                </label>
                <div className="flex gap-2">
                  {(["praveen", "geetha"] as Owner[]).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setMOwner(o)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                        mOwner === o
                          ? "border-blue-600 bg-blue-50 text-blue-700"
                          : "border-slate-300 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {o === "praveen" ? "Praveen" : "Geetha"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Fund name
                </label>
                <input
                  type="text"
                  value={mSchemeName}
                  onChange={(e) => handleManualSchemeSearch(e.target.value)}
                  placeholder="Search mfapi.in…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {mSearching && (
                  <p className="mt-1 text-xs text-slate-400">Searching…</p>
                )}
                {mSearchResults.length > 0 && (
                  <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {mSearchResults.map((s) => (
                      <li key={s.schemeCode}>
                        <button
                          type="button"
                          onClick={() => selectManualScheme(s)}
                          className="block w-full truncate px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                        >
                          {s.schemeName}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Category
                  </label>
                  <select
                    value={mCategory}
                    onChange={(e) => setMCategory(e.target.value)}
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
                    AMC
                  </label>
                  <input
                    type="text"
                    value={mAmc}
                    onChange={(e) => setMAmc(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Invested amount (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={mInvested}
                    onChange={(e) => setMInvested(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    As on date
                  </label>
                  <input
                    type="date"
                    value={mAsOnDate}
                    max={todayIso()}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  {mDateError ? (
                    <p className="mt-1 text-xs text-red-600">{mDateError}</p>
                  ) : mManualMode ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Manual entry — NAV won&apos;t be re-fetched
                    </p>
                  ) : mSchemeCode ? (
                    <p className="mt-1 text-xs text-slate-400">
                      NAV will be auto-fetched for the selected date
                    </p>
                  ) : (
                    mDateTouched && (
                      <p className="mt-1 text-xs text-amber-600">
                        Select a fund first to fetch NAV
                      </p>
                    )
                  )}
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-700">
                    {!mManualMode && <span aria-hidden="true">🔒</span>} Avg NAV (₹)
                  </label>
                  <div className="relative">
                    {mNavLoading ? (
                      <div className="flex h-[38px] w-full items-center rounded-lg border border-slate-200 bg-slate-100 px-3">
                        <div className="h-3.5 w-16 animate-pulse rounded bg-slate-300" />
                      </div>
                    ) : mManualMode ? (
                      <input
                        type="number"
                        step="0.0001"
                        min={0}
                        value={mAvgNav}
                        onChange={(e) => setMAvgNav(e.target.value)}
                        placeholder="Enter NAV"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <input
                        type="text"
                        readOnly
                        value={mAvgNav ? `₹${mAvgNav}` : ""}
                        placeholder="Auto-filled"
                        className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                      />
                    )}
                  </div>

                  {mManualMode ? (
                    <button
                      type="button"
                      onClick={switchToAutoFetch}
                      className="mt-1 text-xs font-medium text-blue-600 hover:underline"
                    >
                      Auto-fetch
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={switchToManual}
                      className="mt-1 text-xs font-medium text-blue-600 hover:underline"
                    >
                      Enter manually
                    </button>
                  )}

                  {mNavSlow && mNavLoading && (
                    <div className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1.5">
                      <p className="text-xs text-amber-700">
                        Taking longer than usual… you can enter NAV manually below
                      </p>
                      <button
                        type="button"
                        onClick={switchToManual}
                        className="mt-1 text-xs font-semibold text-blue-600 hover:underline"
                      >
                        Enter manually
                      </button>
                    </div>
                  )}

                  {mNavError && !mManualMode && (
                    <div
                      className={`mt-1.5 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${
                        mNavExhausted ? "bg-red-50" : ""
                      }`}
                    >
                      <p className={`text-xs ${mNavExhausted ? "text-red-600" : "text-amber-600"}`}>
                        {mNavError}
                      </p>
                      {mNavExhausted && (
                        <button
                          type="button"
                          onClick={switchToManual}
                          className="shrink-0 text-xs font-semibold text-blue-600 hover:underline"
                        >
                          Enter manually
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-700">
                    {!mManualMode && <span aria-hidden="true">🔒</span>} Units
                  </label>
                  {mNavLoading ? (
                    <div className="flex h-[38px] w-full items-center rounded-lg border border-slate-200 bg-slate-100 px-3">
                      <div className="h-3.5 w-16 animate-pulse rounded bg-slate-300" />
                    </div>
                  ) : mManualMode ? (
                    <input
                      type="number"
                      step="0.0001"
                      min={0}
                      value={mUnits}
                      onChange={(e) => setMUnits(e.target.value)}
                      placeholder="Enter units"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  ) : (
                    <input
                      type="text"
                      readOnly
                      value={mUnits}
                      placeholder="Auto-calculated"
                      className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                    />
                  )}
                </div>
              </div>

              {mError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {mError}
                </p>
              )}

              <button
                type="submit"
                disabled={mSaving || mNavLoading || !!mDateError}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {mSaving ? "Adding…" : mNavLoading ? "Fetching NAV…" : "Add Fund"}
              </button>
            </form>
          </div>
        </div>

        {/* Preview & confirm — full width */}
        {previewRows.length > 0 && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="mb-4 text-base font-semibold text-slate-800">
              Preview import
            </h3>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">
                      <input
                        type="checkbox"
                        checked={previewRows.every((r) => r.selected)}
                        onChange={(e) =>
                          setPreviewRows((prev) =>
                            prev.map((r) => ({ ...r, selected: e.target.checked }))
                          )
                        }
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">Fund name</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Units</th>
                    <th className="px-3 py-2 font-medium">Avg NAV</th>
                    <th className="px-3 py-2 font-medium">Invested ₹</th>
                    <th className="px-3 py-2 font-medium">Confidence</th>
                    <th className="px-3 py-2 font-medium">Scheme code</th>
                    <th className="px-3 py-2 font-medium">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr
                      key={row.key}
                      className={`border-b border-slate-100 last:border-0 ${
                        row.confidence === "low" ? "bg-amber-50" : ""
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) =>
                            updateRow(row.key, { selected: e.target.checked })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-slate-800">
                        <div className="flex items-center gap-1.5">
                          {row.confidence === "low" && <span title="Low confidence match">⚠️</span>}
                          <span className="truncate">{row.scheme_name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {row.editing ? (
                          <select
                            value={row.category}
                            onChange={(e) =>
                              updateRow(row.key, { category: e.target.value })
                            }
                            className="rounded border border-slate-300 px-2 py-1 text-xs"
                          >
                            {CATEGORY_OPTIONS.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-600">{row.category}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {row.units.toLocaleString("en-IN", { maximumFractionDigits: 4 })}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        ₹{row.avg_nav.toLocaleString("en-IN", { maximumFractionDigits: 4 })}
                      </td>
                      <td className="px-3 py-2 text-slate-800">
                        ₹{Math.round(row.invested_amount).toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-2">
                        <ConfidenceBadge level={row.confidence} />
                      </td>
                      <td className="px-3 py-2">
                        {row.editing ? (
                          <input
                            type="text"
                            value={row.scheme_code ?? ""}
                            onChange={(e) =>
                              updateRow(row.key, { scheme_code: e.target.value || null })
                            }
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-xs"
                          />
                        ) : (
                          <span className={row.scheme_code ? "text-green-600" : "text-slate-400"}>
                            {row.scheme_code ? "✓" : "?"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => updateRow(row.key, { editing: !row.editing })}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          {row.editing ? "Done" : "Edit"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {parseRowErrors.length > 0 && (
              <p className="mt-3 text-xs text-slate-400">
                {parseRowErrors.length} row{parseRowErrors.length === 1 ? "" : "s"}{" "}
                could not be parsed and were skipped.
              </p>
            )}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                {selectedRows.length} of {previewRows.length} funds selected · Total
                invested: ₹{Math.round(selectedTotal).toLocaleString("en-IN")}
              </p>
              <button
                onClick={handleConfirmImport}
                disabled={confirming || selectedRows.length === 0}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {confirming ? "Importing…" : "Confirm Import"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
