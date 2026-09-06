"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
          <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-5 text-center">
            <p className="text-sm font-semibold text-red-700">Something went wrong</p>
            <p className="mt-2 break-words text-xs text-red-600">{this.state.error.message}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
