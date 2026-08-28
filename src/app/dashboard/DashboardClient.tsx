"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";

type Owner = "family" | "praveen" | "geetha";

const OWNERS: { id: Owner; label: string }[] = [
  { id: "family", label: "Family" },
  { id: "praveen", label: "Praveen" },
  { id: "geetha", label: "Geetha" },
];

type Kpi = {
  label: string;
  value: string;
};

export default function DashboardClient({
  userEmail,
}: {
  userEmail: string;
}) {
  const [owner, setOwner] = useState<Owner>("family");
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<Kpi[]>([]);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      setKpis([
        { label: "Total invested", value: "—" },
        { label: "Current value", value: "—" },
        { label: "Total P&L", value: "—" },
        { label: "Avg 1Y return", value: "—" },
        { label: "Underperforming", value: "—" },
      ]);
      setLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [owner]);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={userEmail} />

      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3">
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
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="h-3 w-20 rounded bg-slate-200" />
                  <div className="mt-3 h-6 w-16 rounded bg-slate-200" />
                </div>
              ))
            : kpis.map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <p className="text-xs font-medium text-slate-500">
                    {kpi.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {kpi.value}
                  </p>
                </div>
              ))}
        </div>

        <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-slate-700">
            No holdings yet — import your CAMS CAS statement
          </p>
        </div>
      </main>
    </div>
  );
}
