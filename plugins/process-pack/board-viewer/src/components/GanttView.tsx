import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Lane } from "../lib/board";
import { STATE_COLOR_VAR, STATE_LABEL, isTerminal } from "../lib/state";
import { formatDuration, parseDate } from "../lib/time";
import { buildTicks, computeBarGeometry, computeDomain, type Domain } from "../lib/timeline";

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 32;
const SIDEBAR_WIDTH = 176;
const MIN_TIMELINE_WIDTH = 480;
const MIN_BAR_WIDTH = 6;
// Reserved pixels inside a bar for padding + the state dot + its gap, used
// to decide whether a label fits inside the bar or has to go outside it.
const BAR_LABEL_CHROME = 30;
const BAR_LABEL_FONT =
  '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

interface Bar {
  hasBar: boolean;
  scheduled: boolean;
  left: number;
  width: number;
  startMs: number;
  endMs: number;
}

interface Row {
  lane: Lane;
  index: number;
  bar: Bar;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Pixel width of `text` set in `font`, via an offscreen canvas. */
function textWidth(text: string, font: string): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * 6.5; // canvas unavailable — rough fallback
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** Content-box width available inside `ref`'s element (clientWidth minus its own horizontal padding), tracked live. */
function useContentWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const style = getComputedStyle(el);
      const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      setWidth(Math.max(el.clientWidth - padding, 0));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function buildRows(lanes: Lane[], domain: Domain, timelineWidth: number, now: number): Row[] {
  const pxPerMs = timelineWidth / Math.max(domain.end - domain.start, 1);
  const toPx = (ms: number) => (ms - domain.start) * pxPerMs;

  return lanes.map((lane, index) => {
    const geo = computeBarGeometry(lane, now);
    const bar: Bar = geo.hasBar
      ? {
          hasBar: true,
          scheduled: geo.scheduled,
          left: toPx(geo.startMs),
          width: Math.max(toPx(geo.endMs) - toPx(geo.startMs), MIN_BAR_WIDTH),
          startMs: geo.startMs,
          endMs: geo.endMs,
        }
      : { hasBar: false, scheduled: geo.scheduled, left: 0, width: 0, startMs: 0, endMs: 0 };
    return { lane, index, bar };
  });
}

function DependencyArrow({ from, to }: { from: Row; to: Row }) {
  const x1 = from.bar.left + from.bar.width;
  const y1 = from.index * ROW_HEIGHT + ROW_HEIGHT / 2;
  const x2 = to.bar.left;
  const y2 = to.index * ROW_HEIGHT + ROW_HEIGHT / 2;
  const resolved = isTerminal(from.lane.state);
  const reach = Math.max(Math.abs(x2 - x1) * 0.45, 20);

  const d = `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${Math.max(x2 - 6, x1 + 2)} ${y2}`;

  return (
    <path
      d={d}
      fill="none"
      stroke="var(--text-muted)"
      strokeWidth={1.25}
      strokeDasharray={resolved ? undefined : "3 3"}
      markerEnd="url(#gantt-arrowhead)"
      opacity={0.75}
    />
  );
}

function StateDot({ state }: { state: Lane["state"] }) {
  return (
    <span
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: STATE_COLOR_VAR[state] }}
    />
  );
}

function GanttBar({ row }: { row: Row }) {
  const { lane, bar } = row;
  const durationLabel = formatDuration(bar.endMs - bar.startMs);
  const available = bar.width - BAR_LABEL_CHROME;
  const fitsLabel = available >= textWidth(lane.title, BAR_LABEL_FONT);
  const fitsDuration =
    fitsLabel && available - 8 >= textWidth(`${lane.title} ${durationLabel}`, BAR_LABEL_FONT);

  return (
    <div
      className="absolute z-20 flex items-center"
      style={{ top: row.index * ROW_HEIGHT + 7, left: bar.left, height: ROW_HEIGHT - 14 }}
      title={`${lane.title} — ${STATE_LABEL[lane.state]} — ${durationLabel}`}
    >
      <div
        className="h-full rounded-md"
        style={{
          width: Math.max(bar.width, MIN_BAR_WIDTH),
          background: "var(--bg-raised)",
          border: `1.5px solid ${STATE_COLOR_VAR[lane.state]}`,
        }}
      />
      {fitsLabel ? (
        <span className="pointer-events-none absolute inset-0 flex items-center gap-1.5 overflow-hidden px-2 text-[11px] font-medium text-[var(--text)]">
          <StateDot state={lane.state} />
          <span className="truncate">{lane.title}</span>
          {fitsDuration && <span className="shrink-0 text-[var(--text-faint)]">{durationLabel}</span>}
        </span>
      ) : (
        <span className="pointer-events-none absolute left-full flex items-center gap-1.5 pl-2 text-[11px] font-medium whitespace-nowrap text-[var(--text)]">
          <StateDot state={lane.state} />
          {lane.title}
          <span className="text-[var(--text-faint)]">{durationLabel}</span>
        </span>
      )}
    </div>
  );
}

export function GanttView({ lanes }: { lanes: Lane[] }) {
  const now = useMemo(() => Date.now(), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportWidth = useContentWidth(scrollRef, 900);

  const ordered = useMemo(
    () =>
      [...lanes].sort((a, b) => {
        const da = parseDate(a.startedAt)?.getTime() ?? Number.POSITIVE_INFINITY;
        const db = parseDate(b.startedAt)?.getTime() ?? Number.POSITIVE_INFINITY;
        return da - db;
      }),
    [lanes]
  );

  const domain = useMemo(() => computeDomain(ordered, now), [ordered, now]);
  const timelineWidth = Math.max(viewportWidth - SIDEBAR_WIDTH, MIN_TIMELINE_WIDTH);
  const rows = useMemo(
    () => buildRows(ordered, domain, timelineWidth, now),
    [ordered, domain, timelineWidth, now]
  );

  const rowById = useMemo(() => new Map(rows.map((r) => [r.lane.id, r])), [rows]);
  const ticks = useMemo(() => buildTicks(domain), [domain]);
  const contentHeight = rows.length * ROW_HEIGHT;
  const pxPerMs = timelineWidth / Math.max(domain.end - domain.start, 1);
  const toPx = (ms: number) => (ms - domain.start) * pxPerMs;
  const todayLeft = toPx(now);

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
    <div className="h-full overflow-auto p-3 sm:p-4" ref={scrollRef}>
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
          {rows.map((row) => (
            <div
              key={row.lane.id}
              className={`flex flex-col justify-center gap-0.5 border-b border-[var(--border-soft)] px-2.5 ${
                row.bar.hasBar ? "" : "opacity-60"
              }`}
              style={{ height: ROW_HEIGHT }}
            >
              <p className="truncate text-[11px] font-medium text-[var(--text)]">{row.lane.title}</p>
              <p className="truncate text-[10px] text-[var(--text-faint)]">
                {row.lane.owner}
                {row.lane.model && ` · ${row.lane.model}`}
              </p>
            </div>
          ))}
        </div>

        <div className="relative" style={{ width: timelineWidth }}>
          <div
            className="sticky top-0 z-20 border-b border-[var(--border-soft)] bg-[var(--bg)]/95 backdrop-blur"
            style={{ height: HEADER_HEIGHT }}
          >
            {ticks.map((tick) => (
              <div
                key={tick.at}
                className="absolute top-0 h-full border-l border-[var(--border-soft)] pl-1.5 text-[10px] leading-[32px] whitespace-nowrap text-[var(--text-faint)]"
                style={{ left: toPx(tick.at) }}
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
                className={`absolute inset-x-0 border-b border-[var(--border-soft)] ${
                  r.bar.hasBar ? "" : "opacity-60"
                }`}
                style={{ top: r.index * ROW_HEIGHT, height: ROW_HEIGHT }}
              />
            ))}
            {ticks.map((tick) => (
              <div
                key={`grid-${tick.at}`}
                className="absolute top-0 border-l border-[var(--border-soft)]"
                style={{ left: toPx(tick.at), height: contentHeight }}
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
                  <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-muted)" />
                </marker>
              </defs>
              {edges.map(({ from, to }) => (
                <DependencyArrow from={from} key={`${from.lane.id}->${to.lane.id}`} to={to} />
              ))}
            </svg>

            {rows.map((r) =>
              r.bar.hasBar ? (
                <GanttBar key={`bar-${r.lane.id}`} row={r} />
              ) : (
                <div
                  key={`nostart-${r.lane.id}`}
                  className="absolute z-20 flex items-center pl-2 text-[10px] text-[var(--text-faint)] opacity-70"
                  style={{ top: r.index * ROW_HEIGHT, height: ROW_HEIGHT }}
                >
                  {r.bar.scheduled ? "scheduled" : "not started"}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
