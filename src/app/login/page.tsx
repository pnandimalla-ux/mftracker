"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen">
      {/* Left panel — hidden on mobile */}
      <div className="relative hidden w-[60%] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0F172A] to-[#1E3A5F] px-12 py-10 md:flex">
        <span className="text-2xl font-bold text-white">MFTracker</span>

        <div className="max-w-lg">
          <h1 className="text-3xl font-bold leading-tight text-white">
            Your family&apos;s mutual fund intelligence
          </h1>
          <p className="mt-4 text-base text-slate-300">
            Three-layer analysis — past returns, portfolio quality, and
            expense ratios. All in one place.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <span className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-white backdrop-blur-sm">
              📊 Peer comparison
            </span>
            <span className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-white backdrop-blur-sm">
              🤖 AI recommendations
            </span>
            <span className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-white backdrop-blur-sm">
              ⚡ Live NAV sync
            </span>
          </div>
        </div>

        <p className="text-sm text-slate-400">
          Praveen · YE7266&nbsp;&nbsp;|&nbsp;&nbsp;Geetha · WKT509
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex w-full flex-col items-center justify-center bg-white px-6 py-10 md:w-[40%]">
        <div className="mb-8 flex w-full max-w-sm justify-end">
          <span className="text-sm font-semibold text-blue-600">
            MFTracker
          </span>
        </div>

        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold text-slate-800">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-500">
            Sign in to view your family portfolio
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>

            <p className="text-center text-xs text-slate-400">
              For personal use only · Not SEBI-registered advice
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
