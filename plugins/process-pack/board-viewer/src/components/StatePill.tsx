import type { LaneState } from "../lib/board";
import { STATE_COLOR_VAR, STATE_LABEL } from "../lib/state";

export function StatePill({ state }: { state: LaneState }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{
        color: STATE_COLOR_VAR[state],
        background: `color-mix(in oklab, ${STATE_COLOR_VAR[state]} 16%, transparent)`,
      }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: STATE_COLOR_VAR[state] }}
      />
      {STATE_LABEL[state]}
    </span>
  );
}
