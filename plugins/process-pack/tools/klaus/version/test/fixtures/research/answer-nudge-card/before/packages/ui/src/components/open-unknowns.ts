// Trimmed from packages/ui/src/components/open-unknowns.ts in component-monkey-app at bdcf7cc0f^
// (NJM-1182, before). The exported types are copied as they were. The copy object and the date
// helper are declared and not written out, because AnswerNudgeCard only reads their types.

export type OpenUnknownsCopyOption = "A" | "B";

export type WaitingOnKind =
  | "PERSON"
  | "LOOP"
  | "EVIDENCE"
  | "EXTERNAL"
  | "NONE";

export interface UnknownWaitingOn {
  kind: WaitingOnKind;
  clerkUserId?: string;
  displayName?: string;
  loopName?: string;
}

export type UnknownStatus = "open" | "answered" | "dismissed";

export interface OpenUnknown {
  id: string;
  projectId: string;
  /** The question text, as the person said it. */
  utterance: string;
  status: UnknownStatus;
  waitingOn: UnknownWaitingOn;
  answerableNow: boolean;
  /** ISO date. */
  raisedAt: string;
  /** Display name of the person who raised it. */
  raisedBy: string;
  sourceHref: string;
}

export interface OpenUnknownsSummary {
  openQuestions: number;
  answerableNow: number;
  waitingOn: { label: string; count: number }[];
}

export interface RaisedWhen {
  /** "Tuesday", "today", "yesterday", "Sep 12". */
  label: string;
  /** "on Tuesday", "today", "yesterday", "on Sep 12". */
  phrase: string;
}

interface NudgeCopy {
  header: string;
  body: (parts: { question: string; evidenceTitle: string; when: RaisedWhen }) => string;
  accept: string;
  dismiss: string;
  snooze: string;
  mute: string;
}

export declare const OPEN_UNKNOWNS_COPY: Record<OpenUnknownsCopyOption, { nudge: NudgeCopy }>;
export declare function formatRaisedWhen(raisedAt: string, now: Date): RaisedWhen;
