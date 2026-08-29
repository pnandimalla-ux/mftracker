"use client";

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
          <h1 className="text-xl font-bold text-slate-800">
            The application failed to load
          </h1>
          <p className="mt-2 max-w-sm text-sm text-slate-500">
            Please refresh the page. If this keeps happening, contact
            support.
          </p>
          {error.digest && (
            <p className="mt-2 text-xs text-slate-400">
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
