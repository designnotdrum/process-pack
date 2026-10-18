// Trimmed from packages/ui/src/components/open-unknowns.ts in component-monkey-app at bdcf7cc0f
// (NJM-1182, after). The exported types are copied as they were. The copy object and the date
// helper are declared and not written out, because AnswerNudgeCard only reads their types.

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
  /** Clerk profile image of the person it waits on. */
  imageUrl?: string;
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
  /**
   * Prima can answer it from the cards now. An answerable question has no
   * waiting-on line: the surfaces do not render `waitingOn` when this is true.
   */
  answerableNow: boolean;
  /** ISO date. */
  raisedAt: string;
  /** Display name of the person who raised it. */
  raisedBy: string;
  /** Clerk profile image of the person who raised it. */
  raisedByImageUrl?: string;
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

export declare const OPEN_UNKNOWNS_COPY: { nudge: NudgeCopy };
export declare function formatRaisedWhen(raisedAt: string, now: Date): RaisedWhen;
