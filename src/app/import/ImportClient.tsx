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
import type { CoinFund, CoinParseResult, ExcludedRow, SellRow } from "@/lib/parsers/coinCsvParser";
import type { MFCASImport, Owner } from "@/types/mf";
import { CATEGORY_OPTIONS } from "@/lib/categoryOptions";
import { detectCategory, type DetectCategoryResult } from "@/lib/analysis/fundCategoriser";

type ConfidenceLevel = "high" | "medium" | "low";

const COIN_STEPS = [
  "Open Zerodha Coin app or coin.zerodha.com",
  "Go to Orders → Order History",
  "Set date range: All time",
  "Click Download / Export CSV",
  "Repeat for Geetha's account (WKT509) if needed",
  "Upload both CSVs below (or one at a time)",
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

interface PreviewFund extends CoinFund {
  key: string;
  selected: boolean;
  expanded: boolean;
}

interface DuplicateInfo {
  scheme_name: string;
  owner: Owner;
  scheme_code: string | null;
  existing_lot_count: number;
}

type DuplicateAction = "skip" | "add_lots" | "replace";

function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const styles: Record<ConfidenceLevel, string> = {
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

function formatMoney(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
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

  // --- Coin CSV import state ---
  const [coinFiles, setCoinFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewFunds, setPreviewFunds] = useState<PreviewFund[]>([]);
  const [excludedEtfs, setExcludedEtfs] = useState<ExcludedRow[]>([]);
  const [sellTransactions, setSellTransactions] = useState<SellRow[]>([]);
  const [parseErrorRows, setParseErrorRows] = useState<string[]>([]);
  const [etfsOpen, setEtfsOpen] = useState(false);
  const [sellsOpen, setSellsOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateInfo[]>([]);
  const [duplicateAction, setDuplicateAction] = useState<DuplicateAction>("skip");
  const [importHistory] = useState<MFCASImport[]>(initialImportHistory);
  const [confirming, setConfirming] = useState(false);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // --- Manual add form state ---
  const [mOwner, setMOwner] = useState<Owner>("praveen");
  const [mSchemeName, setMSchemeName] = useState("");
  const [mSchemeCode, setMSchemeCode] = useState<string | null>(null);
  const [mCategory, setMCategory] = useState("");
  const [mDetection, setMDetection] = useState<DetectCategoryResult | null>(null);
  const [mCategoryConfirmed, setMCategoryConfirmed] = useState(false);
  const [mShowCategoryDropdown, setMShowCategoryDropdown] = useState(false);
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

  // --- Coin CSV upload handlers ---

  const addCoinFiles = (incoming: File[]) => {
    const csvFiles = incoming.filter((f) => f.name.toLowerCase().endsWith(".csv"));
    if (csvFiles.length === 0) {
      setParseError("Please upload .csv file(s) exported from Coin's Order History.");
      return;
    }
    setCoinFiles((prev) => [...prev, ...csvFiles]);
    setPreviewFunds([]);
    setExcludedEtfs([]);
    setSellTransactions([]);
    setParseErrorRows([]);
    setDuplicates([]);
    setParseError(null);
    setImportSuccess(null);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    addCoinFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    addCoinFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const removeCoinFile = (index: number) => {
    setCoinFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Merges per-file parse results (a fund held in both accounts often shows
  // up as two separate exports, or the same export uploaded alongside an
  // older one) by isin + owner, summing lots rather than overwriting them.
  const mergeCoinResults = (results: CoinParseResult[]): CoinParseResult => {
    const fundMap = new Map<string, CoinFund>();
    for (const result of results) {
      for (const fund of result.funds) {
        const key = `${fund.isin}::${fund.owner}`;
        const existing = fundMap.get(key);
        if (!existing) {
          fundMap.set(key, { ...fund, lots: [...fund.lots] });
          continue;
        }
        existing.lots = [...existing.lots, ...fund.lots].sort((a, b) =>
          a.trade_date.localeCompare(b.trade_date)
        );
        existing.total_invested += fund.total_invested;
        existing.total_units += fund.total_units;
        existing.avg_nav = existing.total_units > 0 ? existing.total_invested / existing.total_units : 0;
      }
    }

    const funds = Array.from(fundMap.values());
    return {
      funds,
      excluded_etfs: results.flatMap((r) => r.excluded_etfs),
      sell_transactions: results.flatMap((r) => r.sell_transactions),
      total_invested: funds.reduce((s, f) => s + f.total_invested, 0),
      owner_split: {
        praveen: funds.filter((f) => f.owner === "praveen").reduce((s, f) => s + f.total_invested, 0),
        geetha: funds.filter((f) => f.owner === "geetha").reduce((s, f) => s + f.total_invested, 0),
      },
      date_range: {
        from: results.map((r) => r.date_range.from).filter(Boolean).sort()[0] ?? "",
        to: results.map((r) => r.date_range.to).filter(Boolean).sort().at(-1) ?? "",
      },
      errors: results.flatMap((r) => r.errors),
    };
  };

  const handleParsePreview = async () => {
    if (coinFiles.length === 0) return;
    setParsing(true);
    setParseError(null);
    setPreviewFunds([]);
    setExcludedEtfs([]);
    setSellTransactions([]);
    setParseErrorRows([]);
    setDuplicates([]);
    try {
      const results = await Promise.all(
        coinFiles.map(async (f) => {
          const formData = new FormData();
          formData.append("file", f);
          const res = await fetch("/api/mf/import/coin", { method: "POST", body: formData });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? `Failed to parse ${f.name}`);
          return json as CoinParseResult;
        })
      );

      const merged = mergeCoinResults(results);
      if (merged.funds.length === 0) {
        setParseError("No importable purchase lots were found in the uploaded file(s).");
      }
      setPreviewFunds(
        merged.funds.map((f, i) => ({
          ...f,
          key: `${i}-${f.isin}-${f.owner}`,
          selected: true,
          expanded: false,
        }))
      );
      setExcludedEtfs(merged.excluded_etfs);
      setSellTransactions(merged.sell_transactions);
      setParseErrorRows(merged.errors);

      if (merged.funds.length > 0) {
        const dupRes = await fetch("/api/mf/import/coin/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            check_only: true,
            funds: merged.funds.map((f) => ({
              isin: f.isin,
              scheme_code: f.scheme_code,
              scheme_name: f.scheme_name,
              owner: f.owner,
              category: f.category,
              amc: f.amc,
              lots: f.lots,
            })),
          }),
        });
        if (dupRes.ok) {
          const dupJson = await dupRes.json();
          setDuplicates(Array.isArray(dupJson.duplicates) ? dupJson.duplicates : []);
        }
      }
    } catch (err) {
      console.error("Coin CSV parse failed:", err);
      setParseError(
        err instanceof Error ? err.message : "Could not parse this file. Please check it's a valid Coin Order History export."
      );
    } finally {
      setParsing(false);
    }
  };

  const updateFund = (key: string, patch: Partial<PreviewFund>) => {
    setPreviewFunds((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  };

  const isDuplicateFund = (f: PreviewFund) =>
    !!f.scheme_code && duplicates.some((d) => d.owner === f.owner && d.scheme_code === f.scheme_code);

  const selectedFunds = previewFunds.filter((f) => f.selected);
  const selectedTotal = selectedFunds.reduce((sum, f) => sum + f.total_invested, 0);
  const selectedLots = selectedFunds.reduce((sum, f) => sum + f.lots.length, 0);

  const foundTotalInvested = previewFunds.reduce((s, f) => s + f.total_invested, 0);
  const foundTotalLots = previewFunds.reduce((s, f) => s + f.lots.length, 0);
  const foundOwnerSplit = {
    praveen: previewFunds.filter((f) => f.owner === "praveen").reduce((s, f) => s + f.total_invested, 0),
    geetha: previewFunds.filter((f) => f.owner === "geetha").reduce((s, f) => s + f.total_invested, 0),
  };

  const handleConfirmImport = async () => {
    if (selectedFunds.length === 0) return;
    setConfirming(true);
    setParseError(null);
    try {
      const res = await fetch("/api/mf/import/coin/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duplicate_action: duplicateAction,
          funds: selectedFunds.map((f) => ({
            isin: f.isin,
            scheme_code: f.scheme_code,
            scheme_name: f.scheme_name,
            owner: f.owner,
            category: f.category,
            amc: f.amc,
            lots: f.lots,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setParseError(json.error ?? "Import failed.");
        return;
      }
      setImportSuccess(
        `${json.funds_imported} fund${json.funds_imported === 1 ? "" : "s"} imported (${json.lots_imported} lot${json.lots_imported === 1 ? "" : "s"} total)`
      );
      setTimeout(() => {
        router.push("/dashboard");
      }, 2000);
    } catch (err) {
      console.error("Coin CSV import failed:", err);
      setParseError("Import failed. Please try again.");
    } finally {
      setConfirming(false);
    }
  };

  // --- Manual add handlers ---

  const handleManualSchemeSearch = async (query: string) => {
    setMSchemeName(query);
    setMSchemeCode(null);
    setMDetection(null);
    setMCategoryConfirmed(false);
    setMShowCategoryDropdown(false);
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

    const detection = detectCategory(scheme.schemeName);
    setMDetection(detection);
    setMCategoryConfirmed(false);
    if (detection.confidence === "low") {
      setMCategory("");
      setMShowCategoryDropdown(true);
    } else {
      setMCategory(detection.category);
      setMShowCategoryDropdown(false);
    }

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

  const handleUseDetectedCategory = () => {
    if (!mDetection) return;
    setMCategory(mDetection.category);
    setMCategoryConfirmed(true);
    setMShowCategoryDropdown(false);
  };

  const handleSelectCategory = (category: string) => {
    setMCategory(category);
    setMCategoryConfirmed(true);
    setMShowCategoryDropdown(false);
  };

  const resetManualForm = () => {
    setMOwner("praveen");
    setMSchemeName("");
    setMSchemeCode(null);
    setMCategory("");
    setMDetection(null);
    setMCategoryConfirmed(false);
    setMShowCategoryDropdown(false);
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
    if (mSchemeCode && !mCategoryConfirmed) {
      setMError("Confirm the fund category before continuing.");
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

  // Once a fund is picked from search, the rest of the form waits for the
  // category to be confirmed (auto-detected or manually chosen) before
  // enabling — manual-only entry (no fund picked) is never gated this way.
  const formLocked = !!mSchemeCode && !mCategoryConfirmed;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={userEmail} />

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-slate-800">Import holdings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Import your holdings from Zerodha Coin order history. Works for both
            Praveen (YE7266) and Geetha (WKT509).
          </p>
        </div>

        {/* Primary — Zerodha Coin CSV import */}
        <div className="rounded-xl border-2 border-blue-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">🪙</span>
              <h2 className="text-base font-semibold text-slate-800">
                Import from Zerodha Coin (Best option)
              </h2>
            </div>
            <span className="rounded-full bg-blue-600 px-2.5 py-1 text-xs font-bold text-white">
              Recommended ★
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Your complete order history with exact purchase dates, amounts, and
            NAV per transaction. Covers both accounts.
          </p>

          <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2">
            <p className="text-xs text-blue-800">
              💡 Unlike CAMS/KFintech statements, Coin CSV has every purchase lot
              with exact NAV and date — giving you precise cost basis per lot.
            </p>
          </div>

          <ol className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {COIN_STEPS.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                  {i + 1}
                </span>
                <span className="text-sm text-slate-600">{step}</span>
              </li>
            ))}
          </ol>

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
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
              <p className="text-sm font-medium text-slate-600">
                Drop CSV(s) here or click to browse
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Supports both YE7266 and WKT509 — owner auto-detected from file
              </p>
            </div>

            {coinFiles.length > 0 && (
              <div className="mt-3 space-y-2">
                {coinFiles.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-700">{f.name}</p>
                      <p className="text-xs text-slate-400">{(f.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCoinFile(i)}
                      className="text-xs font-medium text-slate-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  onClick={handleParsePreview}
                  disabled={parsing}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
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
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Secondary — Add fund manually */}
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

                {mSchemeCode && mCategoryConfirmed && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      {mCategory}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMCategoryConfirmed(false);
                        setMShowCategoryDropdown(true);
                      }}
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      Change
                    </button>
                  </div>
                )}

                {mSchemeCode && !mCategoryConfirmed && mDetection && (
                  <div
                    className={`mt-2 rounded-lg border p-3 ${
                      mDetection.confidence === "high"
                        ? "border-green-200 bg-green-50"
                        : mDetection.confidence === "medium"
                          ? "border-amber-200 bg-amber-50"
                          : "border-slate-300 bg-slate-100"
                    }`}
                  >
                    <p className="text-xs font-semibold text-slate-700">🏷️ Detected category</p>

                    {mDetection.confidence === "low" ? (
                      <p className="mt-1 text-xs text-slate-500">Could not detect — please select below</p>
                    ) : (
                      <>
                        <p className="mt-1.5 text-sm font-semibold text-slate-800">{mDetection.category}</p>
                        <p className="text-xs text-slate-500">&quot;{mDetection.reason}&quot;</p>
                        <div className="mt-2 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={handleUseDetectedCategory}
                            className="text-xs font-semibold text-green-700 hover:underline"
                          >
                            ✓ Use this
                          </button>
                          <button
                            type="button"
                            onClick={() => setMShowCategoryDropdown((prev) => !prev)}
                            className="text-xs font-medium text-blue-600 hover:underline"
                          >
                            Change category ▾
                          </button>
                        </div>
                      </>
                    )}

                    {mShowCategoryDropdown && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2">
                        <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                          Select category
                        </p>
                        <div className="max-h-48 overflow-y-auto">
                          {CATEGORY_OPTIONS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => handleSelectCategory(c)}
                              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition hover:bg-slate-50 ${
                                c === mDetection.category ? "font-semibold text-blue-700" : "text-slate-700"
                              }`}
                            >
                              <span>
                                {c}
                                {c === mDetection.category && (
                                  <span className="ml-1.5 text-[10px] font-normal text-blue-500">(detected)</span>
                                )}
                              </span>
                              {c === mCategory && <span className="text-green-600">✓</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Category
                  </label>
                  {mSchemeCode ? (
                    <div className="flex h-[38px] items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
                      {mCategoryConfirmed ? mCategory : "Pending confirmation above"}
                    </div>
                  ) : (
                    <select
                      value={mCategory}
                      onChange={(e) => setMCategory(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="" disabled>
                        Select category
                      </option>
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
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
                    disabled={formLocked}
                    onChange={(e) => setMInvested(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
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
                    disabled={formLocked}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  />
                  {formLocked ? (
                    <p className="mt-1 text-xs text-amber-600">Select a category to continue</p>
                  ) : mDateError ? (
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
                        disabled={formLocked}
                        onChange={(e) => setMAvgNav(e.target.value)}
                        placeholder="Enter NAV"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
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
                      disabled={formLocked}
                      className="mt-1 text-xs font-medium text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                    >
                      Auto-fetch
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={switchToManual}
                      disabled={formLocked}
                      className="mt-1 text-xs font-medium text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
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
                      disabled={formLocked}
                      onChange={(e) => setMUnits(e.target.value)}
                      placeholder="Enter units"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
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
                disabled={mSaving || mNavLoading || !!mDateError || formLocked}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {mSaving ? "Adding…" : mNavLoading ? "Fetching NAV…" : "Add Fund"}
              </button>
            </form>
          </div>

          {/* Tertiary — Other import options */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-800">
              Other import options
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Use Zerodha Coin CSV for best accuracy — these alternatives only
              cover funds serviced by that RTA.
            </p>

            <ul className="mt-4 space-y-3">
              <li className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-sm font-medium text-slate-700">CAMS CSV</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  camsonline.com → Mailback Services — CAMS-serviced funds only
                </p>
              </li>
              <li className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-sm font-medium text-slate-700">KFintech CSV</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  kfintech.com — KFintech-serviced funds only
                </p>
              </li>
            </ul>
          </div>
        </div>

        {/* Import history — full width */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">
            Import history
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Source</th>
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

        {/* Preview & confirm — full width */}
        {previewFunds.length > 0 && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="mb-1 text-base font-semibold text-slate-800">
              Found {previewFunds.length} mutual fund{previewFunds.length === 1 ? "" : "s"} · {foundTotalLots} purchase
              lot{foundTotalLots === 1 ? "" : "s"} · {formatMoney(foundTotalInvested)} total
            </h3>
            <p className="text-sm text-slate-500">
              Praveen: {formatMoney(foundOwnerSplit.praveen)} · Geetha: {formatMoney(foundOwnerSplit.geetha)}
              {excludedEtfs.length > 0 && ` · Excluded ${excludedEtfs.length} ETF${excludedEtfs.length === 1 ? "" : "s"}`}
            </p>

            {duplicates.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-800">
                  ⚠️ {duplicates.length} fund{duplicates.length === 1 ? "" : "s"} already exist in MFTracker:
                </p>
                <ul className="mt-1.5 space-y-0.5 text-xs text-amber-700">
                  {duplicates.map((d, i) => (
                    <li key={i}>
                      • {d.scheme_name} ({d.owner === "praveen" ? "Praveen" : "Geetha"}) — {d.existing_lot_count} existing lot
                      {d.existing_lot_count === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs font-medium text-amber-800">What would you like to do?</p>
                <div className="mt-1.5 space-y-1.5">
                  {(
                    [
                      ["skip", "Skip duplicates (only import new funds)"],
                      ["add_lots", "Add as additional lots (if these are new purchases)"],
                      ["replace", "Replace existing data (delete old, import fresh)"],
                    ] as [DuplicateAction, string][]
                  ).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-xs text-amber-800">
                      <input
                        type="radio"
                        name="duplicate_action"
                        checked={duplicateAction === value}
                        onChange={() => setDuplicateAction(value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">
                      <input
                        type="checkbox"
                        checked={previewFunds.every((f) => f.selected)}
                        onChange={(e) =>
                          setPreviewFunds((prev) => prev.map((f) => ({ ...f, selected: e.target.checked })))
                        }
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">Fund</th>
                    <th className="px-3 py-2 font-medium">Owner</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Lots</th>
                    <th className="px-3 py-2 font-medium">Total invested</th>
                    <th className="px-3 py-2 font-medium">Avg NAV</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {previewFunds.map((f) => (
                    <>
                      <tr
                        key={f.key}
                        className={`border-b border-slate-100 last:border-0 ${
                          isDuplicateFund(f) ? "bg-amber-50" : ""
                        }`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={f.selected}
                            onChange={(e) => updateFund(f.key, { selected: e.target.checked })}
                          />
                        </td>
                        <td className="px-3 py-2 text-slate-800">
                          <div className="flex items-center gap-1.5">
                            {isDuplicateFund(f) && <span title="Already in MFTracker">⚠️</span>}
                            <span className="truncate">{f.scheme_name}</span>
                          </div>
                          {!f.scheme_code && (
                            <p className="mt-0.5 text-xs text-slate-400">Scheme code not matched</p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                              f.owner === "praveen" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {f.owner === "praveen" ? "P" : "G"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <select
                              value={f.category}
                              onChange={(e) => updateFund(f.key, { category: e.target.value })}
                              className="rounded border border-slate-300 px-2 py-1 text-xs"
                            >
                              {CATEGORY_OPTIONS.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                            <span title={f.category_confidence === "medium" ? "Please verify" : undefined}>
                              <ConfidenceBadge level={f.category_confidence} />
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{f.lots.length}</td>
                        <td className="px-3 py-2 text-slate-800">{formatMoney(f.total_invested)}</td>
                        <td className="px-3 py-2 text-slate-600">
                          ₹{f.avg_nav.toLocaleString("en-IN", { maximumFractionDigits: 4 })}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => updateFund(f.key, { expanded: !f.expanded })}
                            className="text-xs font-medium text-blue-600 hover:underline"
                          >
                            {f.expanded ? "Hide lots" : "Show lots"}
                          </button>
                        </td>
                      </tr>
                      {f.expanded && (
                        <tr key={`${f.key}-lots`} className="border-b border-slate-100 last:border-0 bg-slate-50">
                          <td />
                          <td colSpan={7} className="px-3 py-2">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="py-1 pr-3 font-medium">Date</th>
                                  <th className="py-1 pr-3 font-medium">Amount</th>
                                  <th className="py-1 pr-3 font-medium">Units</th>
                                  <th className="py-1 pr-3 font-medium">NAV</th>
                                  <th className="py-1 pr-3 font-medium">Settlement ID</th>
                                </tr>
                              </thead>
                              <tbody>
                                {f.lots.map((lot, i) => (
                                  <tr key={i} className="border-t border-slate-200">
                                    <td className="py-1 pr-3 text-slate-600">{lot.trade_date}</td>
                                    <td className="py-1 pr-3 text-slate-600">{formatMoney(lot.amount)}</td>
                                    <td className="py-1 pr-3 text-slate-600">
                                      {lot.units.toLocaleString("en-IN", { maximumFractionDigits: 4 })}
                                    </td>
                                    <td className="py-1 pr-3 text-slate-600">
                                      ₹{lot.nav.toLocaleString("en-IN", { maximumFractionDigits: 4 })}
                                    </td>
                                    <td className="py-1 pr-3 text-slate-600">{lot.settlement_id || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {parseErrorRows.length > 0 && (
              <p className="mt-3 text-xs text-slate-400">
                {parseErrorRows.length} row{parseErrorRows.length === 1 ? "" : "s"} could not be parsed and were
                skipped.
              </p>
            )}

            {sellTransactions.length > 0 && (
              <div className="mt-4 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setSellsOpen((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700"
                >
                  <span>{sellsOpen ? "▼" : "▶"}</span>
                  ℹ️ {sellTransactions.length} sell transaction{sellTransactions.length === 1 ? "" : "s"} found — not
                  imported (redemptions reduce units)
                </button>
                {sellsOpen && (
                  <ul className="space-y-1 border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
                    {sellTransactions.map((s, i) => (
                      <li key={i}>
                        {s.trade_date} · {s.scheme_name} · {formatMoney(s.amount)} ·{" "}
                        {s.units.toLocaleString("en-IN", { maximumFractionDigits: 4 })} units
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {excludedEtfs.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setEtfsOpen((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700"
                >
                  <span>{etfsOpen ? "▼" : "▶"}</span>
                  {excludedEtfs.length} ETF{excludedEtfs.length === 1 ? "" : "s"} excluded — track in StockSense-AI
                </button>
                {etfsOpen && (
                  <ul className="space-y-1 border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
                    {excludedEtfs.map((e, i) => (
                      <li key={i}>{e.scheme_name}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                {selectedFunds.length} of {previewFunds.length} funds selected · Total invested:{" "}
                {formatMoney(selectedTotal)}
              </p>
              <button
                onClick={handleConfirmImport}
                disabled={confirming || selectedFunds.length === 0}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {confirming ? "Importing…" : `Import ${selectedFunds.length} fund${selectedFunds.length === 1 ? "" : "s"} (${selectedLots} lot${selectedLots === 1 ? "" : "s"}) →`}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
