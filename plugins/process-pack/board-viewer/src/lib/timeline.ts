// Gantt-specific time-domain and scale helpers. Kept separate from time.ts
// (generic date/relative-time helpers) because this is specifically about
// turning a set of lanes into one continuous pixel scale: a padded
// [minStart, maxEnd] domain, a "nice" tick step chosen from that domain's
// span, and per-lane bar start/end in that same scale.

import type { Lane } from "./board";
import { isTerminal } from "./state";
import { DAY, HOUR, formatDayLabel, parseDate } from "./time";

export interface Domain {
  start: number;
  end: number;
}

const MIN_SPAN_MS = 6 * HOUR;
// Total padding split evenly across both ends of the domain.
const DOMAIN_PAD_FRACTION = 0.05;

/**
 * Domain = [min(startedAt), max(updatedAt, now)], padded ~10% total so bars
 * (and "today") get breathing room instead of hugging the edges — then
 * rendered at whatever pixel width the viewport actually has (see
 * GanttView's useContentWidth), not a fixed per-day pixel count.
 */
export function computeDomain(lanes: Lane[], now: number): Domain {
  const starts = lanes
    .map((l) => parseDate(l.startedAt)?.getTime())
    .filter((n): n is number => n != null);
  const ends = lanes
    .map((l) => parseDate(l.updatedAt)?.getTime())
    .filter((n): n is number => n != null);

  const rawMin = starts.length > 0 ? Math.min(...starts) : now;
  const rawMax = Math.max(now, rawMin, ...ends);

  const span = Math.max(rawMax - rawMin, MIN_SPAN_MS);
  const pad = span * DOMAIN_PAD_FRACTION;

  return { start: rawMin - pad, end: rawMax + pad };
}

interface TickSpec {
  stepMs: number;
  format: (d: Date) => string;
}

const HOUR_FMT = (d: Date) =>
  `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.toLocaleTimeString(undefined, { hour: "numeric" })}`;

/** Picks a tick interval + label formatter sized to the domain span. */
function chooseTicks(span: number): TickSpec {
  if (span <= 2 * DAY) return { stepMs: 3 * HOUR, format: HOUR_FMT };
  if (span <= 5 * DAY) return { stepMs: 6 * HOUR, format: HOUR_FMT };
  if (span <= 16 * DAY) return { stepMs: DAY, format: formatDayLabel };
  if (span <= 70 * DAY) return { stepMs: 7 * DAY, format: formatDayLabel };
  return { stepMs: 30 * DAY, format: formatDayLabel };
}

export interface Tick {
  at: number;
  label: string;
}

export function buildTicks(domain: Domain): Tick[] {
  const { stepMs, format } = chooseTicks(domain.end - domain.start);
  const ticks: Tick[] = [];
  const first = Math.ceil(domain.start / stepMs) * stepMs;
  for (let t = first; t <= domain.end; t += stepMs) {
    ticks.push({ at: t, label: format(new Date(t)) });
  }
  return ticks;
}

export interface BarGeometry {
  hasBar: boolean;
  /** true if `startedAt` is after `now` — clock skew / bad data, not a real plan. */
  scheduled: boolean;
  startMs: number;
  endMs: number;
}

/** Where a lane's bar starts/ends on the time axis, defensively clamped. */
export function computeBarGeometry(lane: Lane, now: number): BarGeometry {
  const start = parseDate(lane.startedAt)?.getTime();
  if (start == null) {
    return { hasBar: false, scheduled: false, startMs: 0, endMs: 0 };
  }

  const updated = parseDate(lane.updatedAt)?.getTime();
  let end = isTerminal(lane.state) && updated != null ? updated : now;
  // Defensive: an updatedAt in the future (clock skew / stale sample data)
  // can never push a bar past "today", and end can never precede start.
  end = Math.min(end, now);
  if (end < start) end = start;

  return { hasBar: true, scheduled: start > now, startMs: start, endMs: end };
}
