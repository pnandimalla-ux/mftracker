"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/sip", label: "SIP Calendar" },
  { href: "/import", label: "Import" },
  { href: "/insights", label: "Insights" },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

// Sub-routes count as active too (/sip/anything → SIP Calendar). Matching on
// `href + "/"` rather than a bare prefix keeps e.g. "/sipx" from matching.
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppHeader({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const mobileNavRef = useRef<HTMLElement>(null);
  const activeMobileItemRef = useRef<HTMLAnchorElement>(null);
  const [mobileNavAtEnd, setMobileNavAtEnd] = useState(false);

  const updateMobileNavEdge = useCallback(() => {
    const el = mobileNavRef.current;
    if (!el) return;
    setMobileNavAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  // Phone nav is one scrollable line — bring the current page's tab into view.
  // No-op on sm+ where that nav is display:none.
  useEffect(() => {
    activeMobileItemRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
    updateMobileNavEdge();
  }, [pathname, updateMobileNavEdge]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex items-center justify-between gap-3 py-3 sm:py-4">
          <div className="flex min-w-0 items-center gap-4 sm:gap-6">
            <span className="shrink-0 text-xl font-bold text-blue-600">MFTracker</span>

            {/* Desktop: nav inline with the logo (unchanged layout). */}
            <nav aria-label="Main" className="hidden items-center gap-1 overflow-x-auto whitespace-nowrap sm:flex">
              {NAV_ITEMS.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                      active ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-4">
            {userEmail && <span className="hidden text-sm text-slate-500 sm:inline">{userEmail}</span>}
            <button
              onClick={handleSignOut}
              className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Phone: nav on its own full-width row as tabs — one horizontally
            scrollable line, scrollbar hidden, right-edge fade while more
            items are off-screen. -mx-4/px-4 lets it scroll edge to edge
            without widening the page; -mb-px puts the active tab's border
            on the header's bottom border. */}
        <div className="relative -mx-4 -mb-px sm:hidden">
          <nav
            ref={mobileNavRef}
            aria-label="Main"
            onScroll={updateMobileNavEdge}
            className="flex gap-1 overflow-x-auto whitespace-nowrap px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  ref={active ? activeMobileItemRef : undefined}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                    active
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent transition-opacity ${
              mobileNavAtEnd ? "opacity-0" : "opacity-100"
            }`}
          />
        </div>
      </div>
    </header>
  );
}
