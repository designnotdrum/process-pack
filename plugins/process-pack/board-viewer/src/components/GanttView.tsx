import { useMemo } from "react";
import type { Lane } from "../lib/board";
import { STATE_COLOR_VAR } from "../lib/state";
import { isTerminal } from "../lib/state";
import { addDays, daysBetween, formatDayLabel, parseDate, startOfDay } from "../lib/time";

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 32;
const DAY_WIDTH = 36;
const SIDEBAR_WIDTH = 172;
const MIN_TOTAL_DAYS = 7;

interface Bar {
  hasBar: boolean;
  left: number;
  width: number;
}

interface Row {
  lane: Lane;
  index: number;
  bar: Bar;
}

function computeDomain(lanes: Lane[], now: Date) {
  const dates: Date[] = [now];
  for (const lane of lanes) {
    const s = parseDate(lane.startedAt);
    const u = parseDate(lane.updatedAt);
    if (s) dates.push(s);
    if (u) dates.push(u);
  }

  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  const max = new Date(Math.max(...dates.map((d) => d.getTime())));

  const minDate = addDays(startOfDay(min), -1);
  const maxDateCandidate = addDays(startOfDay(max), 2);
  const totalDaysCandidate = daysBetween(minDate, maxDateCandidate);
  const totalDays = Math.max(totalDaysCandidate, MIN_TOTAL_DAYS);

  return { minDate, totalDays };
}

function computeBar(lane: Lane, minDate: Date, now: Date): Bar {
  const startDate = parseDate(lane.startedAt);
  if (!startDate) {
    return { hasBar: false, left: 0, width: 0 };
  }

  const updatedDate = parseDate(lane.updatedAt);
  let endDate = isTerminal(lane.state) && updatedDate ? updatedDate : now;
  if (endDate.getTime() < startDate.getTime()) endDate = startDate;

  const left = Math.max(daysBetween(minDate, startDate), 0) * DAY_WIDTH;
  const widthDays = daysBetween(startDate, endDate);
  const width = Math.max(widthDays * DAY_WIDTH, DAY_WIDTH * 0.5);

  return { hasBar: true, left, width };
}

function buildWeekTicks(minDate: Date, totalDays: number) {
  const ticks: { left: number; label: string }[] = [];
  for (let d = 0; d < totalDays; d += 7) {
    ticks.push({ left: d * DAY_WIDTH, label: formatDayLabel(addDays(minDate, d)) });
  }
  return ticks;
}

function DependencyArrow({ from, to }: { from: Row; to: Row }) {
  const x1 = from.bar.left + from.bar.width;
  const y1 = from.index * ROW_HEIGHT + ROW_HEIGHT / 2;
  const x2 = to.bar.left;
  const y2 = to.index * ROW_HEIGHT + ROW_HEIGHT / 2;
  const midX = Math.min(x1 + 16, Math.max(x2 - 6, x1 + 4));
  const resolved = isTerminal(from.lane.state);

  const d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${Math.max(x2 - 5, midX)} ${y2}`;

  return (
    <path
      d={d}
      fill="none"
      stroke="var(--text-faint)"
      strokeWidth={1.25}
      strokeDasharray={resolved ? undefined : "3 3"}
      markerEnd="url(#gantt-arrowhead)"
      opacity={0.8}
    />
  );
}

export function GanttView({ lanes }: { lanes: Lane[] }) {
  const now = useMemo(() => new Date(), []);

  const ordered = useMemo(
    () =>
      [...lanes].sort((a, b) => {
        const da = parseDate(a.startedAt)?.getTime() ?? Number.POSITIVE_INFINITY;
        const db = parseDate(b.startedAt)?.getTime() ?? Number.POSITIVE_INFINITY;
        return da - db;
      }),
    [lanes]
  );

  const { minDate, totalDays } = useMemo(() => computeDomain(ordered, now), [ordered, now]);

  const rows: Row[] = useMemo(
    () => ordered.map((lane, index) => ({ lane, index, bar: computeBar(lane, minDate, now) })),
    [ordered, minDate, now]
  );

  const rowById = useMemo(() => new Map(rows.map((r) => [r.lane.id, r])), [rows]);
  const weekTicks = useMemo(() => buildWeekTicks(minDate, totalDays), [minDate, totalDays]);

  const timelineWidth = totalDays * DAY_WIDTH;
  const contentHeight = rows.length * ROW_HEIGHT;
  const todayLeft = daysBetween(minDate, now) * DAY_WIDTH;

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">
        No lanes in this board.
      </div>
    );
  }

  const edges = rows.flatMap((row) =>
    row.lane.deps
      .map((depId) => rowById.get(depId))
      .filter((dep): dep is Row => Boolean(dep && dep.bar.hasBar && row.bar.hasBar))
      .map((dep) => ({ from: dep, to: row }))
  );

  return (
    <div className="h-full overflow-auto p-3 sm:p-4">
      <div className="relative flex" style={{ width: SIDEBAR_WIDTH + timelineWidth }}>
        <div
          className="sticky left-0 z-30 shrink-0 border-r border-[var(--border-soft)] bg-[var(--bg)]"
          style={{ width: SIDEBAR_WIDTH }}
        >
          <div
            className="sticky top-0 z-10 flex items-end border-b border-[var(--border-soft)] bg-[var(--bg)] px-2.5 pb-1.5 text-[10px] font-medium text-[var(--text-faint)]"
            style={{ height: HEADER_HEIGHT }}
          >
            lane
          </div>
          {rows.map(({ lane }) => (
            <div
              key={lane.id}
              className="flex flex-col justify-center gap-0.5 border-b border-[var(--border-soft)] px-2.5"
              style={{ height: ROW_HEIGHT }}
            >
              <p className="truncate text-[11px] font-medium text-[var(--text)]">{lane.title}</p>
              <p className="truncate text-[10px] text-[var(--text-faint)]">
                {lane.owner}
                {lane.model && ` · ${lane.model}`}
              </p>
            </div>
          ))}
        </div>

        <div className="relative" style={{ width: timelineWidth }}>
          <div
            className="sticky top-0 z-20 border-b border-[var(--border-soft)] bg-[var(--bg)]/95 backdrop-blur"
            style={{ height: HEADER_HEIGHT }}
          >
            {weekTicks.map((tick) => (
              <div
                key={tick.left}
                className="absolute top-0 h-full border-l border-[var(--border-soft)] pl-1.5 text-[10px] leading-[32px] text-[var(--text-faint)]"
                style={{ left: tick.left }}
              >
                {tick.label}
              </div>
            ))}
            <div
              className="absolute top-0 z-10 h-full pl-1.5 text-[10px] leading-[32px] font-semibold"
              style={{ left: todayLeft, color: "var(--state-running)" }}
            >
              today
            </div>
          </div>

          <div className="relative" style={{ height: contentHeight }}>
            {rows.map((r) => (
              <div
                key={`bg-${r.lane.id}`}
                className="absolute inset-x-0 border-b border-[var(--border-soft)]"
                style={{ top: r.index * ROW_HEIGHT, height: ROW_HEIGHT }}
              />
            ))}
            {weekTicks.map((tick) => (
              <div
                key={`grid-${tick.left}`}
                className="absolute top-0 border-l border-[var(--border-soft)]"
                style={{ left: tick.left, height: contentHeight }}
              />
            ))}
            <div
              className="absolute top-0 z-10 border-l-2"
              style={{ left: todayLeft, height: contentHeight, borderColor: "var(--state-running)" }}
            />

            <svg
              className="pointer-events-none absolute inset-0 z-[5]"
              width={timelineWidth}
              height={contentHeight}
            >
              <defs>
                <marker id="gantt-arrowhead" markerWidth={8} markerHeight={8} refX={5} refY={3} orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-faint)" />
                </marker>
              </defs>
              {edges.map(({ from, to }) => (
                <DependencyArrow from={from} key={`${from.lane.id}->${to.lane.id}`} to={to} />
              ))}
            </svg>

            {rows.map((r) =>
              r.bar.hasBar ? (
                <div
                  key={`bar-${r.lane.id}`}
                  className="absolute z-20 flex items-center overflow-hidden rounded-md bg-[var(--bg-raised)] px-2"
                  style={{
                    top: r.index * ROW_HEIGHT + 7,
                    left: r.bar.left,
                    width: r.bar.width,
                    height: ROW_HEIGHT - 14,
                    borderLeft: `3px solid ${STATE_COLOR_VAR[r.lane.state]}`,
                  }}
                  title={`${r.lane.title} — ${r.lane.state}`}
                >
                  <span className="truncate text-[10px] font-medium text-[var(--text)]">{r.lane.title}</span>
                </div>
              ) : (
                <div
                  key={`nostart-${r.lane.id}`}
                  className="absolute z-20 flex items-center pl-1 text-[10px] text-[var(--text-faint)]"
                  style={{ top: r.index * ROW_HEIGHT, height: ROW_HEIGHT }}
                >
                  not started
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
