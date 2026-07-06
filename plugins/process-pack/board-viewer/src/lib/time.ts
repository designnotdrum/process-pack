// Minimal date/time helpers. No date library dependency: the viewer only
// needs to place points on a day-scale timeline and print short relative
// labels, both easy with plain Date/ms arithmetic.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const STALE_AFTER_MS = 30 * MINUTE;

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isStale(value: string | null | undefined, now: number = Date.now()): boolean {
  const d = parseDate(value);
  if (!d) return false;
  return now - d.getTime() > STALE_AFTER_MS;
}

/**
 * "3m ago" / "2h ago" / "5d ago" / "just now".
 *
 * Always describes the past. A future `value` here means clock skew or bad
 * sample data — an "updated at" timestamp can't legitimately be ahead of
 * now — so it clamps to "just now" instead of ever printing "4h from now".
 */
export function relativeFromNow(value: string | null | undefined, now: number = Date.now()): string {
  const d = parseDate(value);
  if (!d) return "unknown";
  const deltaMs = now - d.getTime();
  if (deltaMs <= 0) return "just now";

  if (deltaMs < MINUTE) return "just now";
  if (deltaMs < HOUR) return `${Math.round(deltaMs / MINUTE)}m ago`;
  if (deltaMs < DAY) return `${Math.round(deltaMs / HOUR)}h ago`;
  return `${Math.round(deltaMs / DAY)}d ago`;
}

/** "45m" / "6h" / "2.5d" / "12d" — a short duration label for a Gantt bar. */
export function formatDuration(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  const days = ms / DAY;
  return `${days >= 10 ? Math.round(days) : Math.round(days * 10) / 10}d`;
}

export function formatDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatClockLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
}

export { DAY, HOUR, MINUTE };
