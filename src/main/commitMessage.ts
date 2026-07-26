import { isInlineThread, type PrComment } from '@shared/comments';
import type { AgentSummary } from '@shared/runs';
import { REVISION_KIND, type RevisionKind } from '@shared/runState';

/**
 * Two layers of commit exist and only one of them is read by humans.
 *
 * Revision commits inside a worktree are an internal audit trail that gets squashed
 * away at landing time, so they are terse by design — their job is revertability, not
 * prose. Typed as a total Record so a new REVISION_KIND is a compile error here.
 */
export const REVISION_COMMIT_SUBJECT: Record<RevisionKind, string> = {
  [REVISION_KIND.AGENT_RESULT]: 'agent: apply resolution',
  [REVISION_KIND.HAND_EDIT]: 'revise: manual edit',
  [REVISION_KIND.TARGETED_EDIT]: 'revise: targeted edit',
  [REVISION_KIND.DECISION_CONTINUATION]: 'revise: continue after decision',
  [REVISION_KIND.FOLLOW_UP]: 'revise: follow-up prompt',
};

/** Normal git convention: imperative mood, no trailing period, under 72 characters. */
const SUBJECT_MAX_LENGTH = 72;
const SUBJECT_ELLIPSIS = '…';
const TRAILING_PUNCTUATION_PATTERN = /[.,;:\s]+$/;
const WHITESPACE_RUN_PATTERN = /\s+/g;
const LINE_BREAK_PATTERN = /\r\n?/g;

const SPACE = ' ';
const LINE_SEPARATOR = '\n';
const PARAGRAPH_SEPARATOR = '\n\n';

const BLOCKQUOTE_PREFIX = '> ';
const BLOCKQUOTE_EMPTY_LINE = '>';
/**
 * A review comment can carry a pasted stack trace or a whole file. The quote is
 * provenance, not an archive, so a long body is cut rather than allowed to bury the
 * message that explains the change.
 */
const MAX_QUOTED_BODY_LINES = 20;
const QUOTE_TRUNCATION_LINE = '> […]';

const AUTHOR_MENTION_PREFIX = '@';
const ANCHOR_LINE_SEPARATOR = ':';

const PROVENANCE_PREFIX = 'Resolves review comment';
const PROVENANCE_AUTHOR_JOINER = ' from ';
const PROVENANCE_LOCATION_JOINER = ' on ';
const SENTENCE_TERMINATOR = '.';

const FALLBACK_SUBJECT = 'Address review comment';

const PR_URL_LABEL = 'PR:';
const THREAD_URL_LABEL = 'Thread:';

export interface LandingCommitMessageInput {
  comment: PrComment;
  /** The pull request's own URL; the thread URL comes from the comment. */
  prUrl: string;
  /** Null when the agent wrote no summary, or wrote one that failed to parse. */
  summary: AgentSummary | null;
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(TRAILING_PUNCTUATION_PATTERN, '');
}

function normalizeLineBreaks(text: string): string {
  return text.replaceAll(LINE_BREAK_PATTERN, LINE_SEPARATOR);
}

/** Null when there is nothing usable left, which is what selects the template. */
function normalizeSubject(candidate: string): string | null {
  const collapsed = stripTrailingPunctuation(
    candidate.replaceAll(WHITESPACE_RUN_PATTERN, SPACE).trim(),
  );
  if (collapsed.length === 0) return null;
  if (collapsed.length <= SUBJECT_MAX_LENGTH) return collapsed;

  // Truncating beats emitting an over-long subject: git tooling elides the overflow
  // anyway, and an explicit ellipsis says the sentence was cut rather than badly written.
  const cut = collapsed.slice(0, SUBJECT_MAX_LENGTH - SUBJECT_ELLIPSIS.length);
  return `${stripTrailingPunctuation(cut)}${SUBJECT_ELLIPSIS}`;
}

/** `path:line` for an anchored comment, `path` when the line has drifted away. */
function describeAnchor(comment: PrComment): string | null {
  if (!isInlineThread(comment)) return null;
  const { path, line } = comment.anchor;
  if (line === null) return path;
  return `${path}${ANCHOR_LINE_SEPARATOR}${line}`;
}

function describeAuthor(comment: PrComment): string {
  return `${AUTHOR_MENTION_PREFIX}${comment.author.login}`;
}

/** An unanchored comment has no file to name, so the author is the only locator left. */
function buildTemplateSubject(comment: PrComment): string {
  const anchor = describeAnchor(comment);
  const locator =
    anchor === null
      ? `${PROVENANCE_AUTHOR_JOINER}${describeAuthor(comment)}`
      : `${PROVENANCE_LOCATION_JOINER}${anchor}`;
  return normalizeSubject(`${FALLBACK_SUBJECT}${locator}`) ?? FALLBACK_SUBJECT;
}

/**
 * The agent drafts the subject because it knows what it changed and a template cannot.
 * The template is not a degraded mode to avoid, though: landing is never blocked on the
 * agent's summary, and a hand-edited patch makes the drafted subject stale anyway.
 */
function resolveSubject(comment: PrComment, summary: AgentSummary | null): string {
  if (summary === null) return buildTemplateSubject(comment);
  return normalizeSubject(summary.subject) ?? buildTemplateSubject(comment);
}

function resolveDetails(summary: AgentSummary | null): string | null {
  if (summary === null || summary.details === null) return null;
  const normalized = normalizeLineBreaks(summary.details).trim();
  return normalized.length === 0 ? null : normalized;
}

function buildProvenanceSentence(comment: PrComment): string {
  const anchor = describeAnchor(comment);
  const location = anchor === null ? '' : `${PROVENANCE_LOCATION_JOINER}${anchor}`;
  const author = `${PROVENANCE_AUTHOR_JOINER}${describeAuthor(comment)}`;
  return `${PROVENANCE_PREFIX}${author}${location}${SENTENCE_TERMINATOR}`;
}

function quoteCommentBody(body: string): string | null {
  const normalized = normalizeLineBreaks(body).trim();
  if (normalized.length === 0) return null;

  const lines = normalized.split(LINE_SEPARATOR);
  const quoted = lines.slice(0, MAX_QUOTED_BODY_LINES).map((line) => {
    const trimmed = line.trimEnd();
    return trimmed.length === 0 ? BLOCKQUOTE_EMPTY_LINE : `${BLOCKQUOTE_PREFIX}${trimmed}`;
  });
  if (lines.length > MAX_QUOTED_BODY_LINES) quoted.push(QUOTE_TRUNCATION_LINE);

  return quoted.join(LINE_SEPARATOR);
}

function buildLinks(prUrl: string, threadUrl: string): string {
  return [`${PR_URL_LABEL} ${prUrl}`, `${THREAD_URL_LABEL} ${threadUrl}`].join(LINE_SEPARATOR);
}

/**
 * The squashed landing commit is what appears in `git log` on the target branch, so it
 * carries the provenance that makes the change traceable back to the remark that caused
 * it: who asked, where, what they said, and both URLs.
 *
 * Pure and string-returning on purpose. The message is editable in the landing preview,
 * because the agent's summary can go stale the moment the patch is hand-edited — so
 * nothing here reads or writes a file, and this is not the last word on the text.
 *
 * No `Co-authored-by` trailer for the agent: both author and committer are the user.
 */
export function buildLandingCommitMessage(input: LandingCommitMessageInput): string {
  const { comment, prUrl, summary } = input;

  const paragraphs: readonly (string | null)[] = [
    resolveSubject(comment, summary),
    resolveDetails(summary),
    buildProvenanceSentence(comment),
    quoteCommentBody(comment.body),
    buildLinks(prUrl, comment.url),
  ];

  return paragraphs
    .filter((paragraph): paragraph is string => paragraph !== null)
    .join(PARAGRAPH_SEPARATOR);
}
