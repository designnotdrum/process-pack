// Board data model. Kept intentionally loose: the orchestrator writing
// board.json owns the schema (constants/schemas/board.schema.json elsewhere
// in this pack); this viewer only reads it, and reads it tolerantly. Extra
// fields are ignored, not rejected, and missing optional fields fall back to
// sane display defaults so a partial or evolving board.json still renders.

export const LANE_STATES = [
  "planned",
  "running",
  "blocked",
  "review",
  "merged",
  "done",
  "killed",
] as const;

export type LaneState = (typeof LANE_STATES)[number];

export interface Lane {
  id: string;
  title: string;
  owner: string;
  model: string;
  state: LaneState;
  phase: string;
  deps: string[];
  pr: string;
  blockedOn: string;
  startedAt: string | null;
  updatedAt: string | null;
  next: string;
}

export interface BoardMeta {
  session: string;
  updatedAt: string | null;
  notes: string;
}

export interface BoardData {
  board: BoardMeta;
  lanes: Lane[];
}

export interface ParseResult {
  data: BoardData | null;
  error: string | null;
  warnings: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asString = (v: unknown, fallback = ""): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return fallback;
};

const asStringOrNull = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim().length > 0) return v;
  if (typeof v === "number") return String(v);
  return null;
};

const asState = (v: unknown, warnings: string[], laneId: string): LaneState => {
  if (typeof v === "string" && (LANE_STATES as readonly string[]).includes(v)) {
    return v as LaneState;
  }
  warnings.push(
    `lane "${laneId}": unknown or missing state "${String(v)}", defaulting to "planned"`
  );
  return "planned";
};

const asStringArray = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === "string");
};

function normalizeLane(raw: unknown, index: number, warnings: string[]): Lane | null {
  if (!isRecord(raw)) {
    warnings.push(`lane at index ${index} is not an object, skipped`);
    return null;
  }

  const id = asStringOrNull(raw.id);
  if (!id) {
    warnings.push(`lane at index ${index} has no usable "id", skipped`);
    return null;
  }

  return {
    id,
    title: asString(raw.title, id),
    owner: asString(raw.owner, "—"),
    model: asString(raw.model, "—"),
    state: asState(raw.state, warnings, id),
    phase: asString(raw.phase, ""),
    deps: asStringArray(raw.deps),
    pr: asString(raw.pr, ""),
    blockedOn: asString(raw.blockedOn, ""),
    startedAt: asStringOrNull(raw.startedAt),
    updatedAt: asStringOrNull(raw.updatedAt),
    next: asString(raw.next, ""),
  };
}

function normalizeBoardMeta(raw: unknown): BoardMeta {
  if (!isRecord(raw)) {
    return { session: "", updatedAt: null, notes: "" };
  }
  return {
    session: asString(raw.session, ""),
    updatedAt: asStringOrNull(raw.updatedAt),
    notes: asString(raw.notes, ""),
  };
}

/** Parse and tolerantly normalize a board.json payload of unknown shape. */
export function parseBoard(raw: unknown): ParseResult {
  const warnings: string[] = [];

  if (!isRecord(raw)) {
    return { data: null, error: "board.json is not a JSON object", warnings };
  }

  const rawLanes = Array.isArray(raw.lanes) ? raw.lanes : [];
  if (!Array.isArray(raw.lanes)) {
    warnings.push('top-level "lanes" is missing or not an array, treating as empty');
  }

  const lanes = rawLanes
    .map((lane, i) => normalizeLane(lane, i, warnings))
    .filter((lane): lane is Lane => lane !== null);

  const board = normalizeBoardMeta(raw.board);

  return { data: { board, lanes }, error: null, warnings };
}

export function safeParseJson(text: string): { value: unknown; error: string | null } {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : "invalid JSON" };
  }
}
