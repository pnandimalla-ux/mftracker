// Shared number formatting + gain/loss colours for the dashboard. Cards and
// charts use the short lakh/crore form (₹15.5L, ₹1.2Cr); tables use the full
// amount with Indian digit grouping (₹1,71,000).

// One green and one red for every gain/loss on the page (Tailwind emerald-600 /
// rose-600). Hex values are for Recharts, which can't take Tailwind classes.
export const GAIN_HEX = "#059669";
export const LOSS_HEX = "#e11d48";
export const GAIN_TEXT = "text-emerald-600";
export const LOSS_TEXT = "text-rose-600";
export const GAIN_BG = "bg-emerald-600";
export const LOSS_BG = "bg-rose-600";

export function toneText(value: number | null | undefined, neutral = "text-slate-400"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return neutral;
  return value >= 0 ? GAIN_TEXT : LOSS_TEXT;
}

const trimZero = (s: string) => s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");

// ₹1.2Cr / ₹15.5L / ₹45K / ₹850. Negative values keep a leading "-".
export function formatInrShort(value: number, digits = 1): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${sign}₹${trimZero((abs / 1e7).toFixed(Math.min(2, digits + 1)))}Cr`;
  if (abs >= 1e5) return `${sign}₹${trimZero((abs / 1e5).toFixed(digits))}L`;
  if (abs >= 1e3) return `${sign}₹${trimZero((abs / 1e3).toFixed(digits))}K`;
  return `${sign}₹${Math.round(abs)}`;
}

// ₹1,71,000 — rounded to the rupee, Indian digit grouping.
export function formatInrFull(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;
}

// Explicit "+" for gains, "-" for losses.
export function formatSignedInrFull(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatInrFull(Math.abs(value))}`;
}

export function formatSignedInrShort(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : "-"}${formatInrShort(Math.abs(value), digits)}`;
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}
