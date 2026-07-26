import { isInlineThread, type PrComment } from '@shared/comments';
import {
  GUARDRAIL_FLAG_KIND,
  type GuardrailFlag,
  type GuardrailFlagKind,
} from '@shared/guardrails';
import { MODEL_TIER, type ModelTier } from '@shared/runState';
import type { CandidatePatch, CandidatePatchFile } from '@shared/runs';

/**
 * `prompt.ts` already tells the agent not to touch these, but a prompt instruction is
 * a request. This is the enforcement, and it mirrors the "Do NOT Touch" list in
 * `core-principles.mdc` — keep the two consistent, without conflating their scope:
 * that list governs agents working on Punchlist, this one governs agents working on the
 * user's repos through Punchlist.
 *
 * Exported as a named constant so a settings-configurable list can replace the default
 * later without a second source of truth appearing.
 */
export const DEFAULT_PROTECTED_PATH_PATTERNS: readonly string[] = [
  // Lock files change through a package manager, never through an editing agent.
  'package-lock.json',
  'bun.lock',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  // Generated output: the source is what a review comment is actually about.
  '*.generated.*',
  'src/generated/**',
  // A silent edit here is the highest-consequence change an agent could make.
  '.github/workflows/**',
  '.env',
  '.env.*',
  'node_modules/**',
  'vendor/**',
  // An agent resolving a comment has no business rewriting its own guardrails.
  '.cursor/rules/**',
];

const PATH_SEPARATOR = '/';
const REPO_ROOT_DIRECTORY = '';
const SEGMENT_WILDCARD = '*';
const PATH_GLOBSTAR = '**';
const NOT_FOUND_INDEX = -1;
const FIRST_INDEX = 0;
const NEXT_SEGMENT_OFFSET = 1;
const EMPTY_LENGTH = 0;

const FLAG_ID_SEPARATOR = ':';

const LINE_SPLIT_PATTERN = /\r?\n/;
const LINE_JOINER = '\n';

interface CredentialPattern {
  /** Stable across wording changes, because it is part of the flag id. */
  id: string;
  label: string;
  pattern: RegExp;
}

/**
 * Recognisable credential shapes. Every one of these is a *prefix* convention the
 * issuing service publishes, which is why matching them is cheap and reasonably
 * precise — unlike the entropy heuristic below.
 */
const CREDENTIAL_PATTERNS: readonly CredentialPattern[] = [
  { id: 'awsAccessKeyId', label: 'an AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'githubToken', label: 'a GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { id: 'openAiKey', label: 'an OpenAI-style API key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { id: 'slackToken', label: 'a Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'googleApiKey', label: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    id: 'privateKeyBlock',
    label: 'a PEM private key block',
    pattern: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/,
  },
];

const SECRET_LITERAL_PATTERN_ID = 'secretNamedLiteral';
const SECRET_LITERAL_LABEL = 'a high-entropy literal assigned to a secret-named identifier';

/**
 * Capture group 1 is the literal itself. It is read for length and entropy only and
 * must never leave this module — a flag is rendered in the UI and persisted to the
 * store, so echoing the match would make the flag the leak it is reporting.
 */
const SECRET_NAMED_LITERAL_PATTERN =
  /(?:secret|token|password|passwd|api[-_]?key|access[-_]?key)["'\s]*[:=]\s*["'`]([^"'`\s]+)["'`]/gi;
const SECRET_LITERAL_CAPTURE_INDEX = 1;

/**
 * Judgement calls, and the entropy pair is the one that decides how noisy this check
 * is. 20 characters is longer than the placeholders that appear in real code
 * (`"changeme"`, `"xxx"`), and 3.5 bits per character is above English prose and below
 * a base64 or hex key — a UUID clears it, which is an accepted false positive.
 */
const MIN_SECRET_LITERAL_LENGTH = 20;
const MIN_SECRET_ENTROPY_BITS_PER_CHARACTER = 3.5;
const NO_ENTROPY_BITS = 0;
const NO_OCCURRENCES = 0;
const SINGLE_OCCURRENCE = 1;

interface DiffSizeLimit {
  maxFiles: number;
  maxChangedLines: number;
}

/**
 * Judgement calls too: these are not "correct" sizes, they are the point past which the
 * router's classification and the diff stop telling the same story. A `mechanical`
 * comment is a rename or a one-line fix, so a forty-file diff means the run was
 * misrouted or the agent went exploring — worth knowing before you start reading rather
 * than three files in. Generous on purpose, because a flag you learn to dismiss is
 * worse than no flag.
 */
const TIER_DIFF_LIMITS = {
  [MODEL_TIER.MECHANICAL]: { maxFiles: 3, maxChangedLines: 60 },
  [MODEL_TIER.STANDARD]: { maxFiles: 10, maxChangedLines: 300 },
  [MODEL_TIER.COMPLEX]: { maxFiles: 25, maxChangedLines: 1000 },
} as const satisfies Record<ModelTier, DiffSizeLimit>;

/**
 * Derived from the kind and its subject rather than randomly generated: re-checking a
 * patch after a revision has to produce the same id, or an acknowledgement already
 * given is silently discarded and the acknowledgement flow is useless.
 */
function toFlagId(kind: GuardrailFlagKind, subject: string): string {
  return `${kind}${FLAG_ID_SEPARATOR}${subject}`;
}

function matchesSegment(segment: string, pattern: string): boolean {
  if (!pattern.includes(SEGMENT_WILDCARD)) return segment === pattern;

  const parts = pattern.split(SEGMENT_WILDCARD);
  const lastPartIndex = parts.length - NEXT_SEGMENT_OFFSET;
  let consumed = FIRST_INDEX;

  for (const [index, part] of parts.entries()) {
    if (part.length === EMPTY_LENGTH) continue;

    if (index === FIRST_INDEX) {
      if (!segment.startsWith(part)) return false;
      consumed = part.length;
      continue;
    }

    if (index === lastPartIndex) {
      if (!segment.endsWith(part)) return false;
      // A trailing literal that overlaps what earlier parts already consumed would
      // let `*.generated.*` match a segment that only contains one `.generated.`.
      return segment.length - part.length >= consumed;
    }

    const found = segment.indexOf(part, consumed);
    if (found === NOT_FOUND_INDEX) return false;
    consumed = found + part.length;
  }

  return true;
}

function matchesSegments(segments: readonly string[], patternSegments: readonly string[]): boolean {
  if (patternSegments.length === EMPTY_LENGTH) return segments.length === EMPTY_LENGTH;

  const [head, ...rest] = patternSegments;
  if (head === PATH_GLOBSTAR) {
    for (let start = FIRST_INDEX; start <= segments.length; start += NEXT_SEGMENT_OFFSET) {
      if (matchesSegments(segments.slice(start), rest)) return true;
    }
    return false;
  }

  if (segments.length === EMPTY_LENGTH) return false;
  if (!matchesSegment(segments[FIRST_INDEX], head)) return false;
  return matchesSegments(segments.slice(NEXT_SEGMENT_OFFSET), rest);
}

/**
 * Deliberately simple glob-ish matching — prefix, suffix and `**` segment matching —
 * rather than a dependency: the patterns are ours, and a full glob engine would be a
 * larger trust surface than the check it serves.
 *
 * A pattern is anchored at the end of the path but may begin at any segment boundary,
 * so `bun.lock` matches a nested lock file in a monorepo package and `node_modules/**`
 * matches a nested vendored tree. Both are the answers you want.
 */
function matchesPathPattern(filePath: string, pattern: string): boolean {
  const segments = filePath.split(PATH_SEPARATOR);
  const patternSegments = pattern.split(PATH_SEPARATOR);

  for (let start = FIRST_INDEX; start < segments.length; start += NEXT_SEGMENT_OFFSET) {
    if (matchesSegments(segments.slice(start), patternSegments)) return true;
  }

  return false;
}

function findProtectedPattern(filePath: string): string | null {
  const pattern = DEFAULT_PROTECTED_PATH_PATTERNS.find((candidate) =>
    matchesPathPattern(filePath, candidate),
  );
  return pattern ?? null;
}

interface LineDelta {
  addedLines: string[];
  changedLineCount: number;
}

/**
 * A set difference rather than a real LCS diff. It over-reports a moved line and skips
 * a line that already existed elsewhere in the file, which is the right trade here:
 * both checks that consume this only need to know roughly how much is new and whether
 * anything credential-shaped is among it, and an exact diff would cost far more per
 * patch than the answer is worth.
 */
function toLineDelta(file: CandidatePatchFile): LineDelta {
  const originalLines = file.originalContent.split(LINE_SPLIT_PATTERN);
  const modifiedLines = file.modifiedContent.split(LINE_SPLIT_PATTERN);
  const originalSet = new Set(originalLines);
  const modifiedSet = new Set(modifiedLines);

  const addedLines = modifiedLines.filter((line) => !originalSet.has(line));
  const removedCount = originalLines.filter((line) => !modifiedSet.has(line)).length;

  return { addedLines, changedLineCount: addedLines.length + removedCount };
}

function toShannonEntropyBits(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? NO_OCCURRENCES) + SINGLE_OCCURRENCE);
  }

  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;
    return entropy - probability * Math.log2(probability);
  }, NO_ENTROPY_BITS);
}

function hasHighEntropySecretLiteral(addedContent: string): boolean {
  for (const match of addedContent.matchAll(SECRET_NAMED_LITERAL_PATTERN)) {
    const literal = match[SECRET_LITERAL_CAPTURE_INDEX];
    if (literal.length < MIN_SECRET_LITERAL_LENGTH) continue;
    if (toShannonEntropyBits(literal) >= MIN_SECRET_ENTROPY_BITS_PER_CHARACTER) return true;
  }

  return false;
}

function toProtectedPathFlags(files: readonly CandidatePatchFile[]): GuardrailFlag[] {
  const flags: GuardrailFlag[] = [];

  for (const file of files) {
    const pattern = findProtectedPattern(file.path);
    if (pattern === null) continue;

    flags.push({
      id: toFlagId(GUARDRAIL_FLAG_KIND.PROTECTED_PATH, file.path),
      kind: GUARDRAIL_FLAG_KIND.PROTECTED_PATH,
      path: file.path,
      detail: `This file matches the protected pattern "${pattern}", which an agent resolving a comment is not expected to change.`,
    });
  }

  return flags;
}

/**
 * A safety net, not a guarantee. Regex scanning has both false positives (a UUID, a
 * long test fixture) and blind spots (a split or encoded credential, a secret with no
 * recognisable prefix), and the code should not pretend otherwise — its value is
 * catching the obvious accident cheaply, and it does not replace never committing
 * secrets in the first place.
 *
 * Every `detail` below names the *kind* of finding and the file. None of them, and no
 * log line anywhere in this module, carries any part of the matched content.
 */
function toSecretFlags(file: CandidatePatchFile, addedLines: readonly string[]): GuardrailFlag[] {
  if (addedLines.length === EMPTY_LENGTH) return [];

  const addedContent = addedLines.join(LINE_JOINER);
  const flags: GuardrailFlag[] = [];

  for (const credential of CREDENTIAL_PATTERNS) {
    if (!credential.pattern.test(addedContent)) continue;

    flags.push({
      id: toFlagId(
        GUARDRAIL_FLAG_KIND.SECRET_LIKE,
        `${file.path}${FLAG_ID_SEPARATOR}${credential.id}`,
      ),
      kind: GUARDRAIL_FLAG_KIND.SECRET_LIKE,
      path: file.path,
      detail: `Added lines in this file look like ${credential.label}. The value is deliberately not shown here.`,
    });
  }

  if (hasHighEntropySecretLiteral(addedContent)) {
    flags.push({
      id: toFlagId(
        GUARDRAIL_FLAG_KIND.SECRET_LIKE,
        `${file.path}${FLAG_ID_SEPARATOR}${SECRET_LITERAL_PATTERN_ID}`,
      ),
      kind: GUARDRAIL_FLAG_KIND.SECRET_LIKE,
      path: file.path,
      detail: `Added lines in this file contain ${SECRET_LITERAL_LABEL}. The value is deliberately not shown here.`,
    });
  }

  return flags;
}

function toScopeMismatchFlag(
  tier: ModelTier,
  fileCount: number,
  changedLineCount: number,
): GuardrailFlag | null {
  const limit = TIER_DIFF_LIMITS[tier];
  if (fileCount <= limit.maxFiles && changedLineCount <= limit.maxChangedLines) return null;

  return {
    // The subject is the tier rather than the measured size: an id that moved with the
    // numbers would drop the acknowledgement on every subsequent revision.
    id: toFlagId(GUARDRAIL_FLAG_KIND.SCOPE_MISMATCH, tier),
    kind: GUARDRAIL_FLAG_KIND.SCOPE_MISMATCH,
    path: null,
    detail: `The ${tier} tier expects at most ${limit.maxFiles} files and ${limit.maxChangedLines} changed lines; this patch changes ${fileCount} files and about ${changedLineCount} lines.`,
  };
}

function toDirectory(filePath: string): string {
  const index = filePath.lastIndexOf(PATH_SEPARATOR);
  return index === NOT_FOUND_INDEX ? REPO_ROOT_DIRECTORY : filePath.slice(FIRST_INDEX, index);
}

/**
 * The anchor's own directory counts as in scope. Resolving a comment routinely touches
 * a sibling — the test beside the file, the barrel it is exported from — and flagging
 * that every time would train you to dismiss the flag, which costs more than the cases
 * it would catch.
 */
function isWithinAnchorScope(filePath: string, anchorPath: string): boolean {
  return filePath === anchorPath || toDirectory(filePath) === toDirectory(anchorPath);
}

function toOutOfAnchorFlag(filePath: string, anchorPath: string): GuardrailFlag {
  return {
    // Per file, so a revision that touches a *new* unrelated file raises a fresh,
    // unacknowledged flag instead of hiding behind the earlier acknowledgement.
    id: toFlagId(GUARDRAIL_FLAG_KIND.OUT_OF_ANCHOR_PATH, filePath),
    kind: GUARDRAIL_FLAG_KIND.OUT_OF_ANCHOR_PATH,
    path: filePath,
    detail: `This file is outside the comment's anchor at ${anchorPath}, so the run changed something it was not asked about.`,
  };
}

/**
 * Unanchored comments — review bodies and conversation comments — have no anchor, so
 * this check does not apply to them rather than inventing one.
 */
function toOutOfAnchorFlags(
  files: readonly CandidatePatchFile[],
  comment: PrComment,
): GuardrailFlag[] {
  if (!isInlineThread(comment)) return [];

  const anchorPath = comment.anchor.path;
  return files
    .filter((file) => !isWithinAnchorScope(file.path, anchorPath))
    .map((file) => toOutOfAnchorFlag(file.path, anchorPath));
}

export interface InspectPatchInput {
  patch: CandidatePatch;
  comment: PrComment;
  tier: ModelTier;
}

/**
 * Containment stops an agent reaching the network; it says nothing about *what it
 * wrote*, which is what these four checks cover. Findings are flags requiring
 * acknowledgement, not hard blocks — a review comment may legitimately ask for a
 * dependency bump, which touches a lock file.
 *
 * Synchronous and dependency-free: everything it needs is already in memory, and the
 * same function runs against the combined landing diff, which is why nothing here
 * reads the run record or the worktree.
 */
export function inspectCandidatePatch(input: InspectPatchInput): GuardrailFlag[] {
  const { patch, comment, tier } = input;
  if (patch.isEmpty) return [];

  const flags: GuardrailFlag[] = toProtectedPathFlags(patch.files);
  let changedLineCount = NO_OCCURRENCES;

  for (const file of patch.files) {
    const delta = toLineDelta(file);
    changedLineCount += delta.changedLineCount;
    flags.push(...toSecretFlags(file, delta.addedLines));
  }

  const scopeMismatch = toScopeMismatchFlag(tier, patch.files.length, changedLineCount);
  if (scopeMismatch !== null) flags.push(scopeMismatch);

  flags.push(...toOutOfAnchorFlags(patch.files, comment));

  return flags;
}
