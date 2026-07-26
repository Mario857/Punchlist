import { COMMENT_KIND } from './comments';
import { MODEL_TIER } from './runState';
import type { CommentAnchor, PrComment } from './comments';
import type { ModelTier } from './runState';

/**
 * PLAN.md puts this heuristic in `src/main/router.ts`, and it lives here instead
 * on purpose: the tier is rendered as a badge on every comment *before* anything
 * runs, so the renderer needs it too. Routing it through IPC would be a round
 * trip per row for a pure function over data the renderer already holds. So the
 * heuristic is shared (one implementation, both processes) and `router.ts` keeps
 * only the SDK-facing tier-to-model resolution. Do not move it back.
 */

export const TIER_SIGNAL = {
  ANCHORED_SINGLE_LINE: 'anchoredSingleLine',
  UNANCHORED: 'unanchored',
  SMALL_HUNK: 'smallHunk',
  LARGE_HUNK: 'largeHunk',
  SHORT_BODY: 'shortBody',
  LONG_BODY: 'longBody',
  MECHANICAL_VERB: 'mechanicalVerb',
  DESIGN_VOCABULARY: 'designVocabulary',
  DEEP_THREAD: 'deepThread',
} as const;

export type TierSignal = (typeof TIER_SIGNAL)[keyof typeof TIER_SIGNAL];

/**
 * `detail` is evidence, never a sentence: the matched keyword, the anchor, or the
 * measured count rendered as a string. The badge tooltip composes the wording, so
 * phrasing changes never come back here.
 */
export interface TierSignalMatch {
  signal: TierSignal;
  detail: string;
}

export interface TierClassification {
  tier: ModelTier;
  signals: TierSignalMatch[];
}

/**
 * Signals score toward `mechanical` (negative) or `complex` (positive) and the
 * sum lands in one of three bands. Weights are relative judgments, not measured
 * values — the tier is overridable per comment and per batch precisely because
 * this will misfire, so there is deliberately no confidence number pretending
 * otherwise.
 */
const TIER_SIGNAL_WEIGHT: Record<TierSignal, number> = {
  [TIER_SIGNAL.ANCHORED_SINGLE_LINE]: -2,
  [TIER_SIGNAL.UNANCHORED]: 2,
  [TIER_SIGNAL.SMALL_HUNK]: -1,
  [TIER_SIGNAL.LARGE_HUNK]: 2,
  [TIER_SIGNAL.SHORT_BODY]: -1,
  [TIER_SIGNAL.LONG_BODY]: 2,
  [TIER_SIGNAL.MECHANICAL_VERB]: -3,
  [TIER_SIGNAL.DESIGN_VOCABULARY]: 3,
  [TIER_SIGNAL.DEEP_THREAD]: 2,
};

/**
 * Neither band is reachable from a single signal — leaving `standard` takes
 * corroboration, because one stray keyword is not evidence. The bands are
 * asymmetric on purpose: `complex` only raises reasoning effort inside the free
 * lane, while `mechanical` withholds it, so mechanical is set out of reach of the
 * scope signals alone and in practice needs the imperative verb plus an anchor.
 */
const MECHANICAL_MAX_SCORE = -5;
const COMPLEX_MIN_SCORE = 4;

/** Roughly one line of review: an instruction, not an argument. */
const SHORT_BODY_MAX_CHARS = 140;
/** Multi-paragraph. At this length the reviewer is explaining, not pointing. */
const LONG_BODY_MIN_CHARS = 600;

/** GitHub sends ~3 lines of context around the change, so this is a change of 1-2 lines. */
const SMALL_HUNK_MAX_LINES = 8;
/** Past this the comment is attached to a block, not to a line. */
const LARGE_HUNK_MIN_LINES = 40;

/** One reply answers, two clarify; three is a back-and-forth, which means contested. */
const DEEP_THREAD_MIN_REPLIES = 3;

/**
 * The verb has to *open* the comment to count as an instruction — `rename` in the
 * middle of a paragraph is narration. The window is wide enough to step over the
 * near-universal `nit:` / `super minor:` prefix.
 */
const MECHANICAL_VERB_MAX_LEAD_WORDS = 4;

const MECHANICAL_OPENING_VERBS: readonly string[] = [
  'rename',
  'typo',
  'remove',
  'inline',
  'extract',
  'format',
];

const DESIGN_VOCABULARY: readonly string[] = [
  'architecture',
  'architectural',
  'redesign',
  'approach',
  'trade-off',
  'tradeoff',
  'alternatively',
  'alternative',
  'rethink',
  'reconsider',
];

const HUNK_HEADER_PREFIX = '@@';
const ANCHOR_DETAIL_SEPARATOR = ':';
/** Splits on anything that is not part of a word, so `**rename**` still opens with `rename`. */
const NON_WORD_PATTERN = /[^a-z0-9-]+/;

interface TermPattern {
  term: string;
  pattern: RegExp;
}

/**
 * Word-boundary anchored so `format` does not fire inside `information`, and
 * deliberately *not* stemmed: a stemmer would make the lists impossible to read
 * back, and `approaches` firing `approach` is not obviously right anyway. Extra
 * inflections belong in the list, spelled out. Entries are plain words, so no
 * regex escaping is needed — keep them that way.
 */
function toTermPattern(term: string): TermPattern {
  return { term, pattern: new RegExp(`\\b${term}\\b`, 'i') };
}

const DESIGN_VOCABULARY_PATTERNS: readonly TermPattern[] = DESIGN_VOCABULARY.map(toTermPattern);

function findDesignTerm(body: string): string | null {
  const match = DESIGN_VOCABULARY_PATTERNS.find((candidate) => candidate.pattern.test(body));
  return match === undefined ? null : match.term;
}

function findMechanicalVerb(body: string): string | null {
  const leadWords = body
    .toLowerCase()
    .split(NON_WORD_PATTERN)
    .filter((word) => word.length > 0)
    .slice(0, MECHANICAL_VERB_MAX_LEAD_WORDS);
  const verb = leadWords.find((word) => MECHANICAL_OPENING_VERBS.includes(word));
  return verb === undefined ? null : verb;
}

/** The `@@` headers are framing, not code, and a blank tail line is not a line of work. */
function countHunkLines(diffHunk: string): number {
  return diffHunk
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.startsWith(HUNK_HEADER_PREFIX)).length;
}

/** Anchoring and hunk size are read together because both come off the anchor. */
function collectAnchorSignals(anchor: CommentAnchor): TierSignalMatch[] {
  const signals: TierSignalMatch[] = [];
  const { path, line, diffHunk } = anchor;

  if (line === null) {
    // The thread names a file but its line is gone (the code moved under it), so
    // the agent still has to go find the code — the same work an unanchored
    // comment implies.
    signals.push({ signal: TIER_SIGNAL.UNANCHORED, detail: path });
  } else {
    signals.push({
      signal: TIER_SIGNAL.ANCHORED_SINGLE_LINE,
      detail: `${path}${ANCHOR_DETAIL_SEPARATOR}${line}`,
    });
  }

  const hunkLines = countHunkLines(diffHunk);
  if (hunkLines <= SMALL_HUNK_MAX_LINES) {
    signals.push({ signal: TIER_SIGNAL.SMALL_HUNK, detail: String(hunkLines) });
  } else if (hunkLines >= LARGE_HUNK_MIN_LINES) {
    signals.push({ signal: TIER_SIGNAL.LARGE_HUNK, detail: String(hunkLines) });
  }

  return signals;
}

/** The one place the comment kind is branched on, so it is the one place to exhaust it. */
function collectScopeSignals(comment: PrComment): TierSignalMatch[] {
  switch (comment.kind) {
    case COMMENT_KIND.INLINE_THREAD:
      return collectAnchorSignals(comment.anchor);
    case COMMENT_KIND.REVIEW_BODY:
    case COMMENT_KIND.CONVERSATION:
      return [{ signal: TIER_SIGNAL.UNANCHORED, detail: comment.kind }];
    default: {
      // Not `assertNever(comment.kind)`: the unanchored member carries a
      // two-literal discriminant, so only exhausting all three cases narrows the
      // comment itself to never. An `if` chain does not — a switch does.
      const unhandled: never = comment;
      return unhandled;
    }
  }
}

function collectBodySignals(body: string): TierSignalMatch[] {
  const signals: TierSignalMatch[] = [];
  const trimmed = body.trim();

  if (trimmed.length <= SHORT_BODY_MAX_CHARS) {
    signals.push({ signal: TIER_SIGNAL.SHORT_BODY, detail: String(trimmed.length) });
  } else if (trimmed.length >= LONG_BODY_MIN_CHARS) {
    signals.push({ signal: TIER_SIGNAL.LONG_BODY, detail: String(trimmed.length) });
  }

  const verb = findMechanicalVerb(trimmed);
  if (verb !== null) {
    signals.push({ signal: TIER_SIGNAL.MECHANICAL_VERB, detail: verb });
  }

  const designTerm = findDesignTerm(trimmed);
  if (designTerm !== null) {
    signals.push({ signal: TIER_SIGNAL.DESIGN_VOCABULARY, detail: designTerm });
  }

  return signals;
}

function tierForScore(score: number): ModelTier {
  if (score <= MECHANICAL_MAX_SCORE) return MODEL_TIER.MECHANICAL;
  if (score >= COMPLEX_MIN_SCORE) return MODEL_TIER.COMPLEX;
  return MODEL_TIER.STANDARD;
}

/**
 * Pure and deterministic on purpose: spending a model call to decide which model
 * to use would undercut the point, so every signal is already present in the
 * comment. The returned signals are the whole explanation — a tier with no
 * signals to show for it would be an opaque verdict on an overridable badge.
 */
export function classifyCommentTier(comment: PrComment): TierClassification {
  const signals = [...collectScopeSignals(comment), ...collectBodySignals(comment.body)];

  if (comment.replies.length >= DEEP_THREAD_MIN_REPLIES) {
    signals.push({ signal: TIER_SIGNAL.DEEP_THREAD, detail: String(comment.replies.length) });
  }

  const score = signals.reduce((total, match) => total + TIER_SIGNAL_WEIGHT[match.signal], 0);

  return { tier: tierForScore(score), signals };
}
