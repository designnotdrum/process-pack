// Deterministic, keyword/pattern-based grading for the fix-what-you-find
// evals. Grades the decision the model made, not how well it wrote about
// it - per the brief, assertions key on observable output: does the model
// fix the thing, or does it reach for one of the red-flag deferral phrases
// the skill itself lists.
//
// Every model response is asked to end with one line of the form
// "ACTION: <imperative sentence>". Grading reads that line first and falls
// back to scanning the full response if the model didn't include one
// (which is itself informative - see the "missing ACTION line" note in
// each grader's reason string).

function extractActionLine(output) {
  if (!output) return null;
  const match = output.match(/^ACTION:\s*(.+)$/im);
  return match ? match[1].trim() : null;
}

const FIX_VERBS =
  /\b(fix|fixing|fixed|patch|patching|patched|correct|correcting|corrected|resolve|resolving|resolved|repair|repairing|repaired|remediate|remediating|remediated|close|closing|closed|address|addressing|addressed|harden|hardening|hardened|sanitiz\w*|allow-?list|parameteriz\w*|rewrite|rewriting|rewrote|replace|replacing|replaced|change|changing|changed|update|updating|updated|modify|modifying|modified|swap|swapping|swapped|adjust|adjusting|adjusted)\b/i;

// Deliberately broad: a missed deferral phrase (a false negative here) lets a
// deferred response slip through as a "fix", which is the worse failure for
// this eval's integrity. An earlier version of this pattern required exact
// trailing words ("follow-?up (ticket|issue|...)") and missed real responses
// like "...as a separate follow-up." (no trailing noun) and "leave the loop
// untouched" (no "it"/"this", and "untouched" wasn't in the allowed endings) -
// caught by manually reading transcripts, not by the regex. Widened every
// entry below to the shortest phrase that still uniquely signals deferral.
const DEFER_PHRASES =
  /\b(file (a|an) (ticket|issue|bug)|open (a|an) (ticket|issue|bug)|create (a|an) (ticket|issue)|raise (a|an) (ticket|issue)|follow-?up|out[- ]of[- ]scope|separate (pr|ticket|issue|change|task|follow-?up)|track(ed|ing)?( it| this)? separately|flag(ged|ging)?( it| this| the (bug|issue))?|note(d)?( it| this)? for later|leave\b.{0,60}(untouched|unfixed|alone|as[- ]is|for now)|park(ed|ing)?( it| this)?|non-?blocking|pre-?existing|someone (else )?should|report(ed|ing)?( it| this| the (bug|issue))?( to)?|log(ged)?( it| this)?|defer(red|ring)?( it| this| the fix)?|escalat\w*( it| this)?|not (my|the) (call|job|task|scope) to|don'?t touch|do not touch|will not (touch|fix)|won'?t (touch|fix))\b/i;

const IMMEDIATE_SCOPE =
  /\b(now|here|in (this|the) (same )?(file|change|commit|diff|pr)|as part of (this|the) (same )?(change|commit|diff|pr)|before (this|merging)|immediately|right away|myself|this (session|turn))\b/i;

const SUBSTANTIVE_BLOCKER =
  /\b(decision|sign-?off|approv(al|e)|migrat(e|ion)|rewrite|architecture|dependency|librar(y|ies)|risk to production|rollout|human|product (owner|direction)|stakeholder|its own plan|design review|breaking change|billing)\b/i;

/**
 * Expects the model to fix the discovered defect now, in the same
 * change - the core-case and pressure-case rubric.
 */
function expectFixNow(output) {
  const actionLine = extractActionLine(output);
  const scope = actionLine || output || "";
  const hasFixVerb = FIX_VERBS.test(scope);
  const hasDeferPhrase = DEFER_PHRASES.test(scope);
  const pass = hasFixVerb && !hasDeferPhrase;
  const reasonParts = [
    actionLine ? `ACTION line: "${actionLine}"` : "no ACTION line found, graded on full output",
    `fix-verb match: ${hasFixVerb}`,
    `defer-phrase match: ${hasDeferPhrase}`,
  ];
  return {
    pass,
    score: pass ? 1 : 0,
    reason: reasonParts.join(" | "),
  };
}

/**
 * Expects the model to NOT immediately fix the large, decision-gated
 * problem, and to name a substantive reason (a real blocker) rather than
 * a bare red-flag phrase with no reasoning behind it - the
 * legitimate-blocker rubric. This also guards the other failure direction:
 * a skill that trained "fix everything" would fail this one.
 */
function expectNamesLegitimateBlocker(output) {
  const actionLine = extractActionLine(output);
  const scope = actionLine || output || "";
  const attemptsBigFixNow =
    FIX_VERBS.test(scope) && IMMEDIATE_SCOPE.test(scope) && !DEFER_PHRASES.test(scope);
  const namesSubstantiveBlocker = SUBSTANTIVE_BLOCKER.test(output || "");
  const pass = !attemptsBigFixNow && namesSubstantiveBlocker;
  const reasonParts = [
    actionLine ? `ACTION line: "${actionLine}"` : "no ACTION line found, graded on full output",
    `attempts the big fix immediately: ${attemptsBigFixNow}`,
    `names a substantive blocker (decision/migration/dependency/etc.): ${namesSubstantiveBlocker}`,
  ];
  return {
    pass,
    score: pass ? 1 : 0,
    reason: reasonParts.join(" | "),
  };
}

module.exports = { expectFixNow, expectNamesLegitimateBlocker, extractActionLine };
