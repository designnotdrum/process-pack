import type { LaneState } from "./board";

export const STATE_ORDER: LaneState[] = [
  "planned",
  "running",
  "blocked",
  "review",
  "merged",
  "done",
  "killed",
];

export const STATE_LABEL: Record<LaneState, string> = {
  planned: "Planned",
  running: "Running",
  blocked: "Blocked",
  review: "Review",
  merged: "Merged",
  done: "Done",
  killed: "Killed",
};

/** CSS custom property (defined in index.css) carrying this state's color. */
export const STATE_COLOR_VAR: Record<LaneState, string> = {
  planned: "var(--state-planned)",
  running: "var(--state-running)",
  blocked: "var(--state-blocked)",
  review: "var(--state-review)",
  merged: "var(--state-merged)",
  done: "var(--state-done)",
  killed: "var(--state-killed)",
};

export const isTerminal = (state: LaneState): boolean =>
  state === "merged" || state === "done" || state === "killed";
