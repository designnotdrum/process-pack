import type { Lane } from "../lib/board";
import { STATE_COLOR_VAR, STATE_LABEL, STATE_ORDER } from "../lib/state";
import { relativeFromNow } from "../lib/time";
import { IconLink } from "./icons";

export function KanbanView({ lanes }: { lanes: Lane[] }) {
  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3 sm:p-4">
      {STATE_ORDER.map((state) => {
        const laneGroup = lanes.filter((l) => l.state === state);
        return (
          <div
            key={state}
            className="flex w-64 shrink-0 flex-col rounded-lg border border-[var(--border-soft)] bg-[var(--bg-raised)]/60"
          >
            <div
              className="flex items-center justify-between gap-2 border-b border-[var(--border-soft)] px-3 py-2 text-xs font-semibold"
              style={{ color: STATE_COLOR_VAR[state] }}
            >
              <span>{STATE_LABEL[state]}</span>
              <span className="text-[var(--text-faint)]">{laneGroup.length}</span>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
              {laneGroup.length === 0 && (
                <p className="px-1 py-2 text-center text-[11px] text-[var(--text-faint)]">—</p>
              )}
              {laneGroup.map((lane) => (
                <LaneCard key={lane.id} lane={lane} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LaneCard({ lane }: { lane: Lane }) {
  return (
    <div
      className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2.5 text-xs"
      style={{ borderLeft: `3px solid ${STATE_COLOR_VAR[lane.state]}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-[var(--text)]">{lane.title}</p>
        {lane.pr && (
          <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-[var(--text-faint)]">
            <IconLink width={10} height={10} />
            {lane.pr}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
        {lane.owner}
        {lane.model && <span className="text-[var(--text-faint)]"> · {lane.model}</span>}
        {lane.phase && <span className="text-[var(--text-faint)]"> · {lane.phase}</span>}
      </p>
      {lane.state === "blocked" && lane.blockedOn && (
        <p className="mt-1.5 rounded bg-[var(--warn-bg)] px-1.5 py-1 text-[10px] text-[var(--warn-text)]">
          blocked on: {lane.blockedOn}
        </p>
      )}
      {lane.next && <p className="mt-1.5 line-clamp-2 text-[11px] text-[var(--text-muted)]">{lane.next}</p>}
      {lane.deps.length > 0 && (
        <p className="mt-1.5 truncate text-[10px] text-[var(--text-faint)]">needs: {lane.deps.join(", ")}</p>
      )}
      <p className="mt-1.5 text-[10px] text-[var(--text-faint)]">{relativeFromNow(lane.updatedAt)}</p>
    </div>
  );
}
