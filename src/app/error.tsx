"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <h1 className="text-xl font-bold text-slate-800">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        An unexpected error occurred. Please try again, or contact support if
        the problem persists.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
      >
        Try again
      </button>
    </div>
  );
}
