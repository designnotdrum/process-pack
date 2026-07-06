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

/** "3m ago" / "2h ago" / "5d ago" / "just now" */
export function relativeFromNow(value: string | null | undefined, now: number = Date.now()): string {
  const d = parseDate(value);
  if (!d) return "unknown";
  const deltaMs = now - d.getTime();
  const abs = Math.abs(deltaMs);
  const suffix = deltaMs >= 0 ? "ago" : "from now";

  if (abs < MINUTE) return "just now";
  if (abs < HOUR) return `${Math.round(abs / MINUTE)}m ${suffix}`;
  if (abs < DAY) return `${Math.round(abs / HOUR)}h ${suffix}`;
  return `${Math.round(abs / DAY)}d ${suffix}`;
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
