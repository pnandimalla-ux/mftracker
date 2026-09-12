"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";

type OwnerFilter = "family" | "praveen" | "geetha";
type Owner = "praveen" | "geetha";

const OWNERS: { id: OwnerFilter; label: string }[] = [
  { id: "family", label: "Family" },
  { id: "praveen", label: "Praveen" },
  { id: "geetha", label: "Geetha" },
];

interface Summary {
  total_invested: number;
  sip_invested: number;
  lumpsum_invested: number;
  total_redeemed: number;
  net_invested: number;
}

interface MonthlyRow {
  month: string;
  month_label: string;
  sip: number;
  lumpsum: number;
  total_invested: number;
  redeemed: number;
  net: number;
}

interface FundRow {
  key: string;
  scheme_name: string;
  owner: Owner;
  sip: number;
  lumpsum: number;
  total_invested: number;
  redeemed: number;
  net: number;
}

interface ReportData {
  summary: Summary;
  monthly: MonthlyRow[];
  per_fund: FundRow[];
}

function formatInr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function OwnerBadge({ owner }: { owner: Owner }) {
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

export default function ReportsClient({ userEmail }: { userEmail: string }) {
  const [owner, setOwner] = useState<OwnerFilter>("family");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const apiOwner = owner === "family" ? "all" : owner;

    fetch(`/api/mf/reports?owner=${apiOwner}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load report");
        if (!cancelled) setData(json as ReportData);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to load reports:", err);
          setError(err instanceof Error ? err.message : "Failed to load report");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [owner]);

  const handleDownloadPdf = () => {
    window.print();
  };

  const handleDownloadExcel = async () => {
    if (!data) return;
    setExportingExcel(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();

      const monthlySheet = wb.addWorksheet("Monthly");
      monthlySheet.columns = [
        { header: "Month", key: "month_label", width: 18 },
        { header: "SIP ₹", key: "sip", width: 14 },
        { header: "Lumpsum ₹", key: "lumpsum", width: 14 },
        { header: "Total Invested ₹", key: "total_invested", width: 18 },
        { header: "Redeemed ₹", key: "redeemed", width: 14 },
        { header: "Net ₹", key: "net", width: 14 },
      ];
      for (const m of data.monthly) {
        monthlySheet.addRow({
          month_label: m.month_label,
          sip: Math.round(m.sip),
          lumpsum: Math.round(m.lumpsum),
          total_invested: Math.round(m.total_invested),
          redeemed: Math.round(m.redeemed),
          net: Math.round(m.net),
        });
      }
      const totalRow = monthlySheet.addRow({
        month_label: "Total",
        sip: Math.round(data.summary.sip_invested),
        lumpsum: Math.round(data.summary.lumpsum_invested),
        total_invested: Math.round(data.summary.total_invested),
        redeemed: Math.round(data.summary.total_redeemed),
        net: Math.round(data.summary.net_invested),
      });
      totalRow.font = { bold: true };

      const fundSheet = wb.addWorksheet("Per Fund");
      fundSheet.columns = [
        { header: "Fund Name", key: "scheme_name", width: 32 },
        { header: "Owner", key: "owner", width: 12 },
        { header: "SIP ₹", key: "sip", width: 14 },
        { header: "Lumpsum ₹", key: "lumpsum", width: 14 },
        { header: "Total Invested ₹", key: "total_invested", width: 18 },
        { header: "Redeemed ₹", key: "redeemed", width: 14 },
        { header: "Net ₹", key: "net", width: 14 },
      ];
      for (const f of data.per_fund) {
        fundSheet.addRow({
          scheme_name: f.scheme_name,
          owner: f.owner === "praveen" ? "Praveen" : "Geetha",
          sip: Math.round(f.sip),
          lumpsum: Math.round(f.lumpsum),
          total_invested: Math.round(f.total_invested),
          redeemed: Math.round(f.redeemed),
          net: Math.round(f.net),
        });
      }

      for (const sheet of [monthlySheet, fundSheet]) {
        sheet.getRow(1).font = { bold: true };
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `MFTracker_Report_${owner}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export Excel report:", err);
    } finally {
      setExportingExcel(false);
    }
  };

  const summary = data?.summary ?? {
    total_invested: 0,
    sip_invested: 0,
    lumpsum_invested: 0,
    total_redeemed: 0,
    net_invested: 0,
  };
  const monthly = data?.monthly ?? [];
  const perFund = data?.per_fund ?? [];

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <div className="print:hidden">
        <AppHeader userEmail={userEmail} />
      </div>

      <main className="mx-auto max-w-6xl px-4 py-8 print:px-0 print:py-0">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Reports</h1>
            <p className="mt-1 text-sm text-slate-500">
              Investment, redemption, and SIP/lumpsum breakdown from every recorded transaction.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPdf}
              disabled={!data || loading}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Download PDF
            </button>
            <button
              onClick={handleDownloadExcel}
              disabled={!data || loading || exportingExcel}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportingExcel ? "Exporting…" : "Download Excel"}
            </button>
          </div>
        </div>

        <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 print:hidden">
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

        <div className="mb-4 hidden print:mb-6 print:block">
          <h1 className="text-xl font-semibold text-slate-900">
            MFTracker Report — {OWNERS.find((o) => o.id === owner)?.label}
          </h1>
          <p className="text-sm text-slate-500">Generated {new Date().toLocaleDateString("en-IN")}</p>
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 print:hidden">{error}</p>
        )}

        {loading ? (
          <p className="text-sm text-slate-400">Loading report…</p>
        ) : (
          <>
            {/* Summary cards */}
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 print:grid-cols-5 print:gap-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4 print:border print:p-2">
                <p className="text-xs font-medium text-slate-500">Total Invested</p>
                <p className="mt-1 text-xl font-semibold text-slate-900 print:text-base">
                  {formatInr(summary.total_invested)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 print:border print:p-2">
                <p className="text-xs font-medium text-slate-500">SIP Invested</p>
                <p className="mt-1 text-xl font-semibold text-blue-700 print:text-base">
                  {formatInr(summary.sip_invested)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 print:border print:p-2">
                <p className="text-xs font-medium text-slate-500">Lumpsum Invested</p>
                <p className="mt-1 text-xl font-semibold text-slate-900 print:text-base">
                  {formatInr(summary.lumpsum_invested)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 print:border print:p-2">
                <p className="text-xs font-medium text-slate-500">Total Redeemed</p>
                <p className="mt-1 text-xl font-semibold text-red-600 print:text-base">
                  {formatInr(summary.total_redeemed)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 print:border print:p-2">
                <p className="text-xs font-medium text-slate-500">Net Invested</p>
                <p className="mt-1 text-xl font-semibold text-green-700 print:text-base">
                  {formatInr(summary.net_invested)}
                </p>
              </div>
            </div>

            {/* Monthly breakdown */}
            <div className="mb-6 rounded-xl border border-slate-200 bg-white print:break-inside-avoid print:border">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-800">Monthly Breakdown</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                      <th className="px-4 py-2 font-medium">Month</th>
                      <th className="px-4 py-2 font-medium text-right">SIP ₹</th>
                      <th className="px-4 py-2 font-medium text-right">Lumpsum ₹</th>
                      <th className="px-4 py-2 font-medium text-right">Total Invested ₹</th>
                      <th className="px-4 py-2 font-medium text-right">Redeemed ₹</th>
                      <th className="px-4 py-2 font-medium text-right">Net ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                          No transactions yet.
                        </td>
                      </tr>
                    )}
                    {monthly.map((m) => (
                      <tr key={m.month} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-2 text-slate-800">{m.month_label}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{formatInr(m.sip)}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{formatInr(m.lumpsum)}</td>
                        <td className="px-4 py-2 text-right text-slate-800">{formatInr(m.total_invested)}</td>
                        <td className="px-4 py-2 text-right text-red-600">{formatInr(m.redeemed)}</td>
                        <td className="px-4 py-2 text-right font-medium text-slate-900">{formatInr(m.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {monthly.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                        <td className="px-4 py-2 text-slate-800">Total</td>
                        <td className="px-4 py-2 text-right text-slate-800">{formatInr(summary.sip_invested)}</td>
                        <td className="px-4 py-2 text-right text-slate-800">{formatInr(summary.lumpsum_invested)}</td>
                        <td className="px-4 py-2 text-right text-slate-900">{formatInr(summary.total_invested)}</td>
                        <td className="px-4 py-2 text-right text-red-600">{formatInr(summary.total_redeemed)}</td>
                        <td className="px-4 py-2 text-right text-slate-900">{formatInr(summary.net_invested)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Per-fund breakdown */}
            <div className="mb-6 rounded-xl border border-slate-200 bg-white print:break-inside-avoid print:border">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-800">Per-Fund Breakdown</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                      <th className="px-4 py-2 font-medium">Fund Name</th>
                      <th className="px-4 py-2 font-medium">Owner</th>
                      <th className="px-4 py-2 font-medium text-right">SIP ₹</th>
                      <th className="px-4 py-2 font-medium text-right">Lumpsum ₹</th>
                      <th className="px-4 py-2 font-medium text-right">Total Invested ₹</th>
                      <th className="px-4 py-2 font-medium text-right">Redeemed ₹</th>
                      <th className="px-4 py-2 font-medium text-right">Net ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perFund.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                          No transactions yet.
                        </td>
                      </tr>
                    )}
                    {perFund.map((f) => (
                      <tr key={f.key} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-2 text-slate-800">{f.scheme_name}</td>
                        <td className="px-4 py-2">
                          <OwnerBadge owner={f.owner} />
                        </td>
                        <td className="px-4 py-2 text-right text-slate-600">{formatInr(f.sip)}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{formatInr(f.lumpsum)}</td>
                        <td className="px-4 py-2 text-right text-slate-800">{formatInr(f.total_invested)}</td>
                        <td className="px-4 py-2 text-right text-red-600">{formatInr(f.redeemed)}</td>
                        <td className="px-4 py-2 text-right font-medium text-slate-900">{formatInr(f.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
