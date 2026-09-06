"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/sip", label: "SIP Calendar" },
  { href: "/import", label: "Import" },
  { href: "/insights", label: "Insights" },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/settings", label: "Settings" },
];

export default function AppHeader({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <span className="shrink-0 text-xl font-bold text-blue-600">MFTracker</span>

          <nav className="flex items-center gap-1 overflow-x-auto whitespace-nowrap">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? "bg-blue-50 text-blue-600"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          {userEmail && (
            <span className="hidden text-sm text-slate-500 sm:inline">
              {userEmail}
            </span>
          )}
          <button
            onClick={handleSignOut}
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
