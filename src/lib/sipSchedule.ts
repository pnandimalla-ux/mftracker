import type { MFSIPSchedule } from "@/types/mf";

// Next instalment date for a SIP schedule, on or after `from` — mirrors the
// occurrence rules the SIP calendar (src/app/sip/SIPCalendarClient.tsx) uses:
// monthly/quarterly on sip_date (clamped to month length), quarterly every
// third month from the start month, weekly/bi-weekly stepping from
// start_date. All dates are local Y/M/D (never `new Date(isoString)`, which
// parses as UTC midnight and shifts the day under IST).

function parseLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function nextSipDate(sip: MFSIPSchedule, from: Date = new Date()): Date | null {
  if (!sip.is_active) return null;
  const today = startOfDay(from);
  const start = parseLocal(sip.start_date);
  const end = sip.end_date ? parseLocal(sip.end_date) : null;
  const earliest = start > today ? start : today;

  let candidate: Date | null = null;

  if (sip.frequency === "weekly" || sip.frequency === "bi-weekly") {
    const stepDays = sip.frequency === "bi-weekly" ? 14 : 7;
    let current = start;
    while (current < earliest) {
      current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + stepDays);
    }
    candidate = current;
  } else {
    const startMonthIndex = start.getFullYear() * 12 + start.getMonth();
    // Two years of months is more than enough to find the next instalment.
    for (let offset = 0; offset < 24; offset++) {
      const year = earliest.getFullYear();
      const month = earliest.getMonth() + offset;
      const y = year + Math.floor(month / 12);
      const m = month % 12;
      const monthIndex = y * 12 + m;
      if (sip.frequency === "quarterly" && (monthIndex - startMonthIndex) % 3 !== 0) continue;
      const day = Math.min(sip.sip_date, daysInMonth(y, m));
      const d = new Date(y, m, day);
      if (d >= earliest) {
        candidate = d;
        break;
      }
    }
  }

  if (!candidate) return null;
  if (end && candidate > end) return null;
  return candidate;
}

// The soonest upcoming instalment across all schedules. When several SIPs
// fall on that same day, their amounts are summed.
export function nextSipAcross(
  sips: MFSIPSchedule[],
  from: Date = new Date()
): { date: Date; amount: number; count: number; schemes: string[] } | null {
  let best: { date: Date; amount: number; count: number; schemes: string[] } | null = null;
  for (const sip of sips) {
    const d = nextSipDate(sip, from);
    if (!d) continue;
    if (!best || d < best.date) {
      best = { date: d, amount: Number(sip.amount), count: 1, schemes: [sip.scheme_name] };
    } else if (d.getTime() === best.date.getTime()) {
      best.amount += Number(sip.amount);
      best.count += 1;
      best.schemes.push(sip.scheme_name);
    }
  }
  return best;
}
