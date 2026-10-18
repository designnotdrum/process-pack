"use client";

import { MoreHorizontal } from "lucide-react";
import * as React from "react";
import {
  OPEN_UNKNOWNS_COPY,
  formatRaisedWhen,
  type OpenUnknown,
  type OpenUnknownsCopyOption,
} from "./open-unknowns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export interface AnswerNudgeCardProps {
  /** The unknown that now has an answer. */
  question: OpenUnknown;
  /** Title of the evidence card that answers it. */
  evidenceTitle: string;
  copy?: OpenUnknownsCopyOption;
  now: Date;
  /** Hands off to Prima chat. Filing the conclusion waits behind a Confirm card there. */
  onAccept: () => void;
  onDismiss: () => void;
  onMute: () => void;
}

/**
 * NJM-1182: the answer nudge as it appears in the canvas toast. Same chrome as
 * `NudgeToast` in apps/web (CanvasToastStack.tsx): 340px, a 1px Prima gradient
 * border on `--canvas-elevated`, no shadow, "Prima noticed", the reasoning, a
 * primary action and "Not now", a menu with the per-rule mute. Only the words
 * are new. On implementation the chrome should be extracted so the toast and
 * this card share it.
 *
 * This card shows the offer. The Confirm card that gates filing belongs to
 * Prima chat and is not drawn here.
 */
export function AnswerNudgeCard({
  question,
  evidenceTitle,
  copy = "A",
  now,
  onAccept,
  onDismiss,
  onMute,
}: AnswerNudgeCardProps): JSX.Element {
  const strings = OPEN_UNKNOWNS_COPY[copy].nudge;
  return (
    <div
      className="w-[340px] rounded-xl border border-transparent p-3"
      data-testid="answer-nudge-card"
      style={{
        backgroundImage:
          "linear-gradient(var(--canvas-elevated), var(--canvas-elevated)), var(--prima-gradient)",
        backgroundOrigin: "border-box",
        backgroundClip: "padding-box, border-box",
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="pointer-events-none relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--prima-gradient)" }}
        >
          <span
            className="h-[11px] w-[11px] rounded-full"
            style={{ background: "var(--canvas-elevated)" }}
          />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
          {strings.header}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Nudge options"
              className="ml-auto rounded p-0.5 text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prima-core)]"
              type="button"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onMute}>{strings.mute}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="mt-1.5 text-sm text-[color:var(--text-secondary)]">
        {strings.body({
          question: question.utterance,
          evidenceTitle,
          when: formatRaisedWhen(question.raisedAt, now),
        })}
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          className="h-7 rounded-md bg-[var(--prima-core)] px-2.5 text-xs font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prima-core)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas-elevated)]"
          onClick={onAccept}
          type="button"
        >
          {strings.accept}
        </button>
        <button
          className="h-7 rounded-md border border-[var(--canvas-border-mid)] px-2.5 text-xs text-[color:var(--text-secondary)] hover:bg-[var(--canvas-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prima-core)]"
          onClick={onDismiss}
          type="button"
        >
          {strings.dismiss}
        </button>
      </div>
    </div>
  );
}

AnswerNudgeCard.displayName = "AnswerNudgeCard";
