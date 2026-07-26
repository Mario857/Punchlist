import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
// A static import from the CJS main process, not `import()`: @cursor/sdk ships a CJS
// build behind the `require` condition in its exports map, so the ESM-only carve-out in
// the no-dynamic-imports rule does not apply here.
import { Agent } from '@cursor/sdk';
import type { AgentOptions, Run, RunOperation, RunResultStatus, SDKAgent } from '@cursor/sdk';
import { z } from 'zod';
import { RUN_TIMEOUT_MS } from '@main/agent';
import { appendAuditEntry } from '@main/audit';
import { resolveLocalRepoPath } from '@main/discovery';
import { PUNCHLIST_SCRATCH_DIR } from '@main/prompt';
import { resolveTierModel, toModelSelection } from '@main/router';
import {
  assertSandboxConfirmation,
  SANDBOX_EXIT_ACTION,
  type SandboxConfirmation,
} from '@main/sandbox';
import {
  getConventionEvidence,
  getConventionRules,
  getCursorApiKey,
  setConventionsState,
} from '@main/store';
import { AUDIT_ACTION } from '@shared/audit';
import { isInlineThread, type PrComment } from '@shared/comments';
import type { PrRef } from '@shared/discovery';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import {
  CONFIRMABLE_EVIDENCE_THRESHOLD,
  CONVENTION_CATEGORY,
  CONVENTION_SCOPE,
  CONVENTION_STATE,
  isConfirmable,
  shouldPromoteToGlobal,
  type ConventionCategory,
  type ConventionEvidence,
  type ConventionExportPreview,
  type ConventionRule,
  type ConventionState,
  type ExportConventionsRequest,
} from '@shared/conventions';
import { MODEL_TIER } from '@shared/runState';

const CONVENTIONS_LOG_SCOPE = '[conventions]';

/**
 * Distillation needs a working directory and nothing else — there is no repository to
 * read, because the corpus travels in the prompt. A directory under `userData` keeps it
 * out of every real checkout, and reusing one directory rather than a fresh temporary
 * path means a stale proposals file has exactly one place to be cleared from.
 */
const CONVENTIONS_DIRECTORY_NAME = 'conventions';

const PROPOSALS_FILE_NAME = 'conventions.json';
/** Written into the agent's own scratch directory, like every other agent artefact. */
const PROPOSALS_FILE_PATH = `${PUNCHLIST_SCRATCH_DIR}/${PROPOSALS_FILE_NAME}`;

/** Surfaced as the agent's title in `Agent.list()`, so a stray distiller is identifiable. */
const DISTILLATION_AGENT_NAME = 'Punchlist conventions';
/** Plan mode produces a plan and no file, and the proposals file is the entire output. */
const AGENT_MODE_AGENT = 'agent';

const RUN_OPERATION_CANCEL = 'cancel' as const satisfies RunOperation;
const RUN_STATUS_FINISHED = 'finished' as const satisfies RunResultStatus;

const FILE_ENCODING = 'utf8';
const SYSTEM_ERROR_ENOENT = 'ENOENT';

/**
 * One batch is one agent call, so the corpus has to fit in one context. Evidence beyond
 * this stays undistilled and is picked up by the next batch rather than being dropped —
 * only what was actually read is marked as read.
 */
const MAX_EVIDENCE_PER_BATCH = 150;

/** A review comment can quote a whole file; the rule behind it is in the first lines. */
const MAX_EVIDENCE_BODY_LENGTH = 2_000;
const BODY_TRUNCATION_SUFFIX = '…';

/** An empty rule is not a rule, which the proposal schema rejects rather than stores. */
const MIN_RULE_TEXT_LENGTH = 1;

const NO_ENTRIES = 0;
const FIRST_INDEX = 0;
const SKIPPED_PROPOSAL_INCREMENT = 1;

const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]+/g;
const SINGLE_SPACE = ' ';
const MATCH_KEY_SEPARATOR = ':';

const ISSUE_PATH_SEPARATOR = '.';
const ISSUE_SEPARATOR = '; ';

const LINE_SEPARATOR = '\n';
const SECTION_SEPARATOR = '\n\n';

const MISSING_API_KEY_MESSAGE =
  'No Cursor API key is set, so the review comments cannot be distilled.';
const MISSING_API_KEY_REMEDIATION = 'Paste the key from cursor.com/settings into Settings.';
const AGENT_START_FAILED_MESSAGE = 'The distillation agent could not be started.';
const AGENT_FAILED_MESSAGE = 'The distillation agent did not finish.';
const AGENT_FAILED_REMEDIATION = 'Retry the distillation; the evidence is kept either way.';
const AGENT_TIMED_OUT_MESSAGE = 'The distillation agent exceeded its time limit and was cancelled.';
const MISSING_PROPOSALS_MESSAGE =
  'The distillation agent finished without writing its proposals file.';
const MALFORMED_PROPOSALS_MESSAGE =
  'The distillation agent wrote a proposals file that could not be read.';
const NOT_CONFIRMABLE_REMEDIATION = `A rule needs ${CONFIRMABLE_EVIDENCE_THRESHOLD} backing comments before it can be confirmed.`;
const EXPORTED_STATE_REMEDIATION = 'Export the rule instead; exporting is what records it.';
const NOTHING_TO_EXPORT_REMEDIATION = 'Confirm at least one rule before exporting.';
const REPO_NOT_CLONED_REMEDIATION = 'Add the repository in Settings, then export again.';

function toEvidence(comment: PrComment, ref: PrRef, capturedAt: string): ConventionEvidence {
  return {
    commentId: comment.id,
    repoKey: ref.repoKey,
    prNumber: ref.number,
    url: comment.url,
    author: comment.author.login,
    body: comment.body,
    path: isInlineThread(comment) ? comment.anchor.path : null,
    capturedAt,
    isDistilled: false,
  };
}

/**
 * Records each ingested comment as evidence. Capture piggybacks on ingestion, so it costs
 * one store write and no network call.
 *
 * Deduped on comment id, which is not a tidiness measure: recurrence *is* the promotion
 * signal, so a re-fetched PR whose comments were counted twice would manufacture
 * conventions out of one reviewer saying something once.
 */
export function captureCommentEvidence(ref: PrRef, comments: readonly PrComment[]): void {
  const existing = getConventionEvidence();
  const knownCommentIds = new Set(existing.map((entry) => entry.commentId));

  const capturedAt = new Date().toISOString();
  const added = comments
    .filter((comment) => !knownCommentIds.has(comment.id))
    .map((comment) => toEvidence(comment, ref, capturedAt));

  // The store rewrites its whole file per write and ingestion runs on every refresh of a
  // PR, so a batch with nothing new writes nothing.
  if (added.length === NO_ENTRIES) return;

  setConventionsState([...existing, ...added], getConventionRules());
}

const LIST_BULLET = '- ';
const BODY_FENCE = '"""';
const JSON_FENCE_OPEN = '```json';
const FENCE_CLOSE = '```';
const AUTHOR_PREFIX = '@';
const PR_NUMBER_PREFIX = '#';
const UNANCHORED_PATH_LABEL = 'not anchored to a file';

/**
 * A `Record` keyed by the union gives the same exhaustiveness guarantee as a switch with
 * a `never` binding: adding a category fails to compile until the prompt explains it.
 */
const CONVENTION_CATEGORY_LABEL: Record<ConventionCategory, string> = {
  [CONVENTION_CATEGORY.NAMING]: 'what things are called',
  [CONVENTION_CATEGORY.STRUCTURE]: 'how code is laid out, split up and organised',
  [CONVENTION_CATEGORY.TYPING]: 'types, contracts and how illegal states are prevented',
  [CONVENTION_CATEGORY.TESTING]: 'what is tested and how',
  [CONVENTION_CATEGORY.STYLING]: 'formatting, UI and presentation habits',
  [CONVENTION_CATEGORY.PROCESS]: 'review, commits, dependencies and workflow',
  [CONVENTION_CATEGORY.SECURITY]: 'secrets, input validation and unsafe operations',
};

/** The export file's section headings, keyed by the same union for the same reason. */
const CONVENTION_CATEGORY_HEADING: Record<ConventionCategory, string> = {
  [CONVENTION_CATEGORY.NAMING]: 'Naming',
  [CONVENTION_CATEGORY.STRUCTURE]: 'Structure',
  [CONVENTION_CATEGORY.TYPING]: 'Types',
  [CONVENTION_CATEGORY.TESTING]: 'Testing',
  [CONVENTION_CATEGORY.STYLING]: 'Styling',
  [CONVENTION_CATEGORY.PROCESS]: 'Process',
  [CONVENTION_CATEGORY.SECURITY]: 'Security',
};

const CATEGORY_CHOICE_LINES = Object.entries(CONVENTION_CATEGORY_LABEL)
  .map(([category, label]) => `${LIST_BULLET}\`${category}\` — ${label}`)
  .join(LINE_SEPARATOR);

const DISTILLATION_ROLE_SECTION = `You are distilling a corpus of GitHub pull request review comments into a small set of durable, reusable engineering conventions.

Each comment below is something a reviewer actually said about someone's code. Your output is not a summary of them: it is the set of rules a future coding agent could be handed as project context, so that it writes code these reviewers would not have had to comment on.

You are being shown the whole corpus at once on purpose. That is what lets you notice that eleven comments are one rule stated eleven times, and emit it once.`;

const DURABLE_RULE_SECTION = `A convention is a rule about code that has not been written yet. A one-off fix is not one, however many words it took to ask for.

- "Rename \`foo\` to \`bar\`" is a one-off. Do not propose it.
- "Prefer descriptive names over abbreviations" is a convention, if reviewers keep asking for it.
- "This needs a null check on line 40" is a one-off. "Validate external input at the boundary rather than defensively throughout" is the convention behind it — but only if the corpus actually supports it.

Most of this corpus is noise and you are expected to discard most of it: "LGTM", "nit", "can you rebase", approvals, questions, thanks, discussion that went nowhere, and instructions that were later reversed. Proposing nothing at all is a valid answer. Twenty confident rules extracted from noise are worse than three real ones, because a future agent will follow all twenty.

Where two comments contradict each other, propose neither unless the corpus makes clear which one won.`;

const DEDUPLICATION_SECTION = `One rule per idea, across the entire corpus.

If several comments say the same thing in different words, that is **one** proposal citing all of them — never one proposal per comment. How many comments back a rule is what makes it credible later, so splitting one rule into near-duplicates destroys the signal it should be building.

State each rule in the imperative, as an instruction ("Prefer …", "Never …", "Put …"), in one sentence.`;

const EVIDENCE_CITATION_SECTION = `Every proposal must cite the comments it came from, by the exact ids given in the corpus, in \`evidenceCommentIds\`.

- Cite only ids that appear in this corpus. An id you invented is checked and dropped, and a proposal left with no valid citation is discarded whole.
- Cite every comment that supports the rule, not only the clearest one.`;

const CATEGORY_SECTION = `\`category\` is exactly one of these, and nothing else:

${CATEGORY_CHOICE_LINES}`;

const PROPOSALS_OUTPUT_SECTION = `Write your proposals to \`${PROPOSALS_FILE_PATH}\` (the \`${PUNCHLIST_SCRATCH_DIR}\` directory already exists):

${JSON_FENCE_OPEN}
{
  "proposals": [
    {
      "category": "${CONVENTION_CATEGORY.NAMING}",
      "rule": "the rule, in the imperative, one sentence",
      "rationale": "why reviewers keep asking for it",
      "evidenceCommentIds": ["the comment ids it came from"],
      "existingRuleId": null
    }
  ]
}
${FENCE_CLOSE}

Write the file. Rules stated only in your final message are the same as no rules at all. If the corpus contains nothing durable, write the file with an empty \`proposals\` array — that is a complete answer.`;

const READ_ONLY_SECTION = `The one file you write is \`${PROPOSALS_FILE_PATH}\`.

There is no repository here and no network: this working directory is scratch space, and the corpus is the entire context. No \`gh\`, no \`curl\`, no package installs, no fetching anything — the comments quote code you cannot open, and a rule you cannot support from the text in front of you is a rule you should not propose.`;

function formatExistingRulesSection(rules: readonly ConventionRule[]): string {
  if (rules.length === NO_ENTRIES) return '';

  const lines = rules.map((rule) => `${LIST_BULLET}\`${rule.id}\` (${rule.category}) ${rule.rule}`);
  return `Rules already recorded. If a proposal restates one of these, do not reword it into a second record: put that rule's id in \`existingRuleId\` and cite the new comments backing it in \`evidenceCommentIds\`. Use \`null\` for anything genuinely new.

${lines.join(LINE_SEPARATOR)}`;
}

/**
 * Rejection is persisted rather than deleted precisely so it can be fed back in here —
 * otherwise every batch would cheerfully re-propose the noise the user just dismissed.
 * This is a request rather than a guarantee, so `mergeProposals` filters again.
 */
function formatRejectedRulesSection(rules: readonly ConventionRule[]): string {
  if (rules.length === NO_ENTRIES) return '';

  const lines = rules.map((rule) => `${LIST_BULLET}${rule.rule}`);
  return `Rules a human has already looked at and rejected. Do not propose these again, in any wording:

${lines.join(LINE_SEPARATOR)}`;
}

function truncateBody(body: string): string {
  if (body.length <= MAX_EVIDENCE_BODY_LENGTH) return body;
  return `${body.slice(FIRST_INDEX, MAX_EVIDENCE_BODY_LENGTH)}${BODY_TRUNCATION_SUFFIX}`;
}

function formatEvidence(entry: ConventionEvidence): string {
  const location = entry.path ?? UNANCHORED_PATH_LABEL;
  return `Comment \`${entry.commentId}\` — ${entry.repoKey} ${PR_NUMBER_PREFIX}${entry.prNumber}, ${location}, by ${AUTHOR_PREFIX}${entry.author}:
${BODY_FENCE}
${truncateBody(entry.body)}
${BODY_FENCE}`;
}

function formatCorpusSection(evidence: readonly ConventionEvidence[]): string {
  const comments = evidence.map(formatEvidence);
  return [`The corpus: ${evidence.length} review comment(s), oldest first.`, ...comments].join(
    SECTION_SEPARATOR,
  );
}

function buildDistillationPrompt(
  evidence: readonly ConventionEvidence[],
  existingRules: readonly ConventionRule[],
  rejectedRules: readonly ConventionRule[],
): string {
  const sections = [
    DISTILLATION_ROLE_SECTION,
    DURABLE_RULE_SECTION,
    DEDUPLICATION_SECTION,
    formatCorpusSection(evidence),
    formatExistingRulesSection(existingRules),
    formatRejectedRulesSection(rejectedRules),
    EVIDENCE_CITATION_SECTION,
    CATEGORY_SECTION,
    PROPOSALS_OUTPUT_SECTION,
    READ_ONLY_SECTION,
  ];

  return sections.filter((section) => section.length > NO_ENTRIES).join(SECTION_SEPARATOR);
}

/** An LLM wrote this file, so it is parsed rather than trusted, exactly like decision.json. */
const conventionProposalSchema = z.object({
  category: z.enum(CONVENTION_CATEGORY),
  rule: z.string().min(MIN_RULE_TEXT_LENGTH),
  rationale: z.string(),
  evidenceCommentIds: z.array(z.string()).default([]),
  /** The agent's own clustering: which recorded rule this proposal restates. */
  existingRuleId: z.string().nullable().default(null),
});

type ConventionProposal = z.infer<typeof conventionProposalSchema>;

/**
 * Proposals are parsed one at a time rather than as a typed array, so a single malformed
 * entry costs one rule instead of the whole batch — the cheap version of degrading
 * cleanly rather than crashing on the least trustworthy input in the system.
 */
const proposalsFileSchema = z.object({ proposals: z.array(z.unknown()).default([]) });

/** execFile-style errors carry `code` bolted on rather than typed, so it is parsed. */
const systemErrorSchema = z.object({ code: z.string().nullish() });

function isMissingFileError(error: unknown): boolean {
  const parsed = systemErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === SYSTEM_ERROR_ENOENT;
}

function describeErrorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function summarizeIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join(ISSUE_PATH_SEPARATOR)}: ${issue.message}`)
    .join(ISSUE_SEPARATOR);
}

function resolveWorkingDirectory(): string {
  return join(app.getPath('userData'), CONVENTIONS_DIRECTORY_NAME);
}

function resolveProposalsFilePath(workingDirectory: string): string {
  return join(workingDirectory, PUNCHLIST_SCRATCH_DIR, PROPOSALS_FILE_NAME);
}

async function disposeAgent(agent: SDKAgent): Promise<void> {
  // The agent holds a child process, so disposal is unconditional. A failed disposal must
  // not mask the outcome of the distillation itself, so it is logged rather than thrown.
  try {
    await agent[Symbol.asyncDispose]();
  } catch (error: unknown) {
    console.warn(CONVENTIONS_LOG_SCOPE, 'Disposing the agent failed.', describeErrorKind(error));
  }
}

async function cancelRunIfSupported(run: Run): Promise<void> {
  // Cancellation is optional per run shape, so it is asked about rather than assumed.
  if (!run.supports(RUN_OPERATION_CANCEL)) return;

  try {
    await run.cancel();
  } catch (error: unknown) {
    console.warn(CONVENTIONS_LOG_SCOPE, 'Cancelling the run failed.', describeErrorKind(error));
  }
}

async function driveDistillationRun(run: Run): Promise<void> {
  // A timeout is enforced by cancelling, so the run comes back cancelled either way; this
  // flag is what keeps the two apart. The bound is the per-run limit agent.ts already
  // owns rather than a second number restated here.
  let isTimedOut = false;
  const timeoutTimer = setTimeout(() => {
    isTimedOut = true;
    void cancelRunIfSupported(run);
  }, RUN_TIMEOUT_MS);

  try {
    // The stream is deliberately not consumed. There is no UI streaming this, and a
    // transcript would quote the corpus, which is exactly as sensitive as the comments in
    // it — the proposals file is this run's only output.
    const result = await run.wait();
    if (isTimedOut) {
      throw new AppError(APP_ERROR_KIND.UNKNOWN, AGENT_TIMED_OUT_MESSAGE, AGENT_FAILED_REMEDIATION);
    }

    if (result.status !== RUN_STATUS_FINISHED) {
      // The SDK's own error text is deliberately not repeated: it can quote the credential
      // it rejected, and this message is surfaced in the UI. The status is the actionable
      // part of it anyway.
      throw new AppError(
        APP_ERROR_KIND.UNKNOWN,
        `${AGENT_FAILED_MESSAGE} (status: ${result.status})`,
        AGENT_FAILED_REMEDIATION,
      );
    }
  } finally {
    clearTimeout(timeoutTimer);
  }
}

/**
 * Not `executeAgentRun`: that runner is bound to a `RunRecord` — it writes the agent id
 * onto one before the agent does any work — and distillation has no run, no worktree and
 * no comment. A placeholder record would be visible to the queue, the watcher, the landing
 * preview and sandbox cleanup, all of which read every run in the store, so the SDK is
 * driven directly here instead. Containment still applies unchanged: the environment every
 * subprocess inherits was stripped of its tokens by `applyProcessContainment` at startup.
 */
async function runDistillationAgent(prompt: string, workingDirectory: string): Promise<void> {
  const apiKey = getCursorApiKey();
  if (apiKey === null) {
    throw new AppError(
      APP_ERROR_KIND.CURSOR_KEY_MISSING,
      MISSING_API_KEY_MESSAGE,
      MISSING_API_KEY_REMEDIATION,
    );
  }

  // Phrasing and clustering is mechanical work, and the mechanical tier is the one that
  // resolves into Cursor's unlimited lane by default — distilling a comment backlog must
  // not quietly spend the included pool.
  const model = await resolveTierModel(MODEL_TIER.MECHANICAL);

  const options: AgentOptions = {
    apiKey,
    model: toModelSelection(model),
    name: DISTILLATION_AGENT_NAME,
    mode: AGENT_MODE_AGENT,
    // An empty `settingSources` keeps ambient user, project and team settings out of the
    // run, exactly as a resolution run does.
    local: { cwd: workingDirectory, settingSources: [] },
  };

  const agent = await Agent.create(options).catch((error: unknown): never => {
    // An SDK start failure can quote the key it rejected, so only the error's class name
    // is logged and a fixed message is what reaches the UI.
    console.warn(CONVENTIONS_LOG_SCOPE, 'The agent never started.', describeErrorKind(error));
    throw new AppError(
      APP_ERROR_KIND.AGENT_START_FAILED,
      AGENT_START_FAILED_MESSAGE,
      MISSING_API_KEY_REMEDIATION,
    );
  });

  try {
    // Agent.create + agent.send, never Agent.prompt: prompt disposes the agent on return.
    const run = await agent.send(prompt);
    await driveDistillationRun(run);
  } finally {
    await disposeAgent(agent);
  }
}

async function readProposalsFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, FILE_ENCODING);
  } catch (error: unknown) {
    if (!isMissingFileError(error)) {
      // The path is logged, never the contents: an agent-written file quotes the corpus.
      console.warn(CONVENTIONS_LOG_SCOPE, `${PROPOSALS_FILE_NAME} could not be read.`, error);
    }
    return null;
  }
}

function decodeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function readProposals(workingDirectory: string): Promise<ConventionProposal[]> {
  const raw = await readProposalsFile(resolveProposalsFilePath(workingDirectory));
  if (raw === null) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      MISSING_PROPOSALS_MESSAGE,
      AGENT_FAILED_REMEDIATION,
    );
  }

  const parsed = proposalsFileSchema.safeParse(decodeJson(raw));
  if (!parsed.success) {
    // Zod issues name paths and expected types, never the offending values, so this
    // message is safe to surface and safe to log.
    throw new AppError(
      APP_ERROR_KIND.UNKNOWN,
      `${MALFORMED_PROPOSALS_MESSAGE} ${summarizeIssues(parsed.error.issues)}`,
      AGENT_FAILED_REMEDIATION,
    );
  }

  const proposals: ConventionProposal[] = [];
  let skippedCount = NO_ENTRIES;
  for (const candidate of parsed.data.proposals) {
    const proposal = conventionProposalSchema.safeParse(candidate);
    if (!proposal.success) {
      // Counted rather than collected: the rejected value is agent output quoting the
      // corpus, so it is not held on to and never reaches the log.
      skippedCount += SKIPPED_PROPOSAL_INCREMENT;
      continue;
    }
    proposals.push(proposal.data);
  }

  if (skippedCount > NO_ENTRIES) {
    console.warn(CONVENTIONS_LOG_SCOPE, `${skippedCount} proposal(s) had an unexpected shape.`);
  }

  return proposals;
}

function normalizeRuleText(text: string): string {
  return text.toLowerCase().replace(NON_ALPHANUMERIC_PATTERN, SINGLE_SPACE).trim();
}

/**
 * Matching is category plus normalized rule text. Casing, punctuation and spacing are the
 * differences a model produces between two statements of the same rule; a genuinely
 * different rule differs in words, not only in commas.
 */
function toMatchKey(category: ConventionCategory, rule: string): string {
  return `${category}${MATCH_KEY_SEPARATOR}${normalizeRuleText(rule)}`;
}

function findMatchingRule(
  rules: readonly ConventionRule[],
  proposal: ConventionProposal,
): ConventionRule | null {
  // The agent's own clustering first, validated by lookup rather than trusted: an id it
  // invented simply fails to resolve and falls through to text matching.
  if (proposal.existingRuleId !== null) {
    const named = rules.find((rule) => rule.id === proposal.existingRuleId);
    if (named !== undefined) return named;
  }

  const key = toMatchKey(proposal.category, proposal.rule);
  return rules.find((rule) => toMatchKey(rule.category, rule.rule) === key) ?? null;
}

/**
 * The promote-on-second-consumer rule, applied to knowledge instead of code. The threshold
 * itself lives in `@shared/conventions`; this only acts on it.
 */
function applyPromotion(rule: ConventionRule): ConventionRule {
  if (rule.scope === CONVENTION_SCOPE.GLOBAL || !shouldPromoteToGlobal(rule)) return rule;
  // A global rule belongs to no single repository, so its repoKey goes with the scope.
  return { ...rule, scope: CONVENTION_SCOPE.GLOBAL, repoKey: null };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function mergeEvidence(
  rule: ConventionRule,
  commentIds: readonly string[],
  repoKeys: readonly string[],
  updatedAt: string,
): ConventionRule {
  return applyPromotion({
    ...rule,
    // The recorded wording wins over the proposal's: the user may have edited it, and
    // rewriting a rule on every batch would be churn rather than an update.
    evidenceCommentIds: unique([...rule.evidenceCommentIds, ...commentIds]),
    evidenceRepoKeys: unique([...rule.evidenceRepoKeys, ...repoKeys]),
    updatedAt,
  });
}

function createRule(
  proposal: ConventionProposal,
  commentIds: readonly string[],
  repoKeys: readonly string[],
  createdAt: string,
): ConventionRule {
  return applyPromotion({
    id: randomUUID(),
    // Nothing is born global and nothing is born confirmed: a second repo promotes the
    // scope, and a human promotes the state.
    scope: CONVENTION_SCOPE.REPO,
    repoKey: repoKeys.at(FIRST_INDEX) ?? null,
    category: proposal.category,
    rule: proposal.rule,
    rationale: proposal.rationale,
    evidenceCommentIds: [...commentIds],
    evidenceRepoKeys: [...repoKeys],
    state: CONVENTION_STATE.CANDIDATE,
    createdAt,
    updatedAt: createdAt,
  });
}

function mergeProposals(
  rules: readonly ConventionRule[],
  proposals: readonly ConventionProposal[],
  batch: readonly ConventionEvidence[],
): ConventionRule[] {
  const evidenceById = new Map(batch.map((entry) => [entry.commentId, entry]));
  const merged = [...rules];
  const mergedAt = new Date().toISOString();

  for (const proposal of proposals) {
    // Citations are resolved against the batch rather than trusted. A hallucinated id
    // would inflate the evidence count, which is the one number every threshold reads.
    const cited = unique(proposal.evidenceCommentIds)
      .map((commentId) => evidenceById.get(commentId))
      .filter((entry): entry is ConventionEvidence => entry !== undefined);
    if (cited.length === NO_ENTRIES) continue;

    const commentIds = cited.map((entry) => entry.commentId);
    const repoKeys = unique(cited.map((entry) => entry.repoKey));

    const match = findMatchingRule(merged, proposal);
    // The prompt already asked for this, but a prompt is a request: a rejected rule is
    // never revived, not even as new evidence on the record that was dismissed.
    if (match !== null && match.state === CONVENTION_STATE.REJECTED) continue;

    if (match === null) {
      merged.push(createRule(proposal, commentIds, repoKeys, mergedAt));
      continue;
    }

    const updated = mergeEvidence(match, commentIds, repoKeys, mergedAt);
    merged[merged.indexOf(match)] = updated;
  }

  return merged;
}

/**
 * One free-lane agent over the whole undistilled batch, never one per comment. Batching is
 * what makes deduplication possible at all: a call that sees a single comment cannot know
 * that eleven others said the same thing, so it would emit eleven near-identical naming
 * rules — and it would cost eleven agent calls to do it.
 */
export async function distillConventions(): Promise<ConventionRule[]> {
  const evidence = getConventionEvidence();
  const rules = getConventionRules();

  const batch = evidence
    .filter((entry) => !entry.isDistilled)
    .slice(FIRST_INDEX, MAX_EVIDENCE_PER_BATCH);
  if (batch.length === NO_ENTRIES) return rules;

  const rejectedRules = rules.filter((rule) => rule.state === CONVENTION_STATE.REJECTED);
  const proposableRules = rules.filter((rule) => rule.state !== CONVENTION_STATE.REJECTED);

  const workingDirectory = resolveWorkingDirectory();
  const proposalsFilePath = resolveProposalsFilePath(workingDirectory);
  await mkdir(dirname(proposalsFilePath), { recursive: true });
  // The working directory is reused across batches, so the previous batch's proposals
  // would otherwise be read back as this batch's output if the agent wrote nothing.
  await rm(proposalsFilePath, { force: true });

  await runDistillationAgent(
    buildDistillationPrompt(batch, proposableRules, rejectedRules),
    workingDirectory,
  );

  const proposals = await readProposals(workingDirectory);
  const merged = mergeProposals(rules, proposals, batch);

  // Marked only once the proposals parsed: evidence recorded as read by a run that failed
  // would never be looked at again.
  const batchIds = new Set(batch.map((entry) => entry.commentId));
  const nextEvidence = evidence.map((entry) =>
    batchIds.has(entry.commentId) ? { ...entry, isDistilled: true } : entry,
  );

  setConventionsState(nextEvidence, merged);
  return merged;
}

/**
 * Confirm or reject a distilled rule. `exported` is not settable from here: it records
 * that a file was written, so only `exportConventions` may claim it.
 *
 * Confirming below the recurrence threshold is refused rather than left to the UI to hide,
 * because the threshold is the whole reason a rule is worth anything — something one
 * reviewer said once is an opinion, and confirming it would hand a future agent an opinion
 * labelled as a convention.
 */
export function setConventionRuleState(ruleId: string, state: ConventionState): ConventionRule[] {
  const rules = getConventionRules();
  const target = rules.find((rule) => rule.id === ruleId);
  if (target === undefined) {
    throw new AppError(APP_ERROR_KIND.NOT_FOUND, `Convention rule ${ruleId} is not in the store.`);
  }

  if (state === CONVENTION_STATE.EXPORTED) {
    throw new AppError(
      APP_ERROR_KIND.CONFIRMATION_REQUIRED,
      'A rule is marked exported by exporting it, not by hand.',
      EXPORTED_STATE_REMEDIATION,
    );
  }

  if (state === CONVENTION_STATE.CONFIRMED && !isConfirmable(target)) {
    throw new AppError(
      APP_ERROR_KIND.CONFIRMATION_REQUIRED,
      `That rule is backed by ${target.evidenceCommentIds.length} comment(s), which is below the recurrence threshold.`,
      NOT_CONFIRMABLE_REMEDIATION,
    );
  }

  const updatedAt = new Date().toISOString();
  const next = rules.map((rule) => (rule.id === ruleId ? { ...rule, state, updatedAt } : rule));
  setConventionsState(getConventionEvidence(), next);
  return next;
}

const CURSOR_DIRECTORY_NAME = '.cursor';
const RULES_DIRECTORY_NAME = 'rules';
const REPO_RULES_FILE_NAME = 'learned-conventions.mdc';
/**
 * Global rules go to a standalone file the user references themselves. The app never edits
 * `~/.claude/CLAUDE.md` or any other instruction file the user wrote — that file is theirs
 * — and it does not invent a dotfile in their home directory either, so this sits beside
 * the rest of the app's own state.
 */
const GLOBAL_RULES_FILE_NAME = 'learned-conventions.md';

const FRONTMATTER_FENCE = '---';
const FRONTMATTER_ALWAYS_APPLY = 'alwaysApply: true';
const HEADING_PREFIX = '# ';
const SUBHEADING_PREFIX = '## ';
const RULE_BULLET = '- ';
const RATIONALE_INDENT = '  ';

const REPO_FILE_TITLE = 'Learned conventions';
const GLOBAL_FILE_TITLE = 'Learned conventions (global)';

const REPO_FILE_PREAMBLE = `Distilled by Punchlist from review comments left on this repository's pull requests, and confirmed by hand before being written here. Each rule was said often enough in review to be a convention rather than a one-off.

Edit or delete anything that no longer holds. Punchlist rewrites this file only when you export again.`;

const GLOBAL_FILE_PREAMBLE = `Distilled by Punchlist from review comments across your repositories, and confirmed by hand before being written here. These held in more than one repository, which is what promoted them out of any single one.

Reference this file from your own agent instructions if you want it applied — Punchlist writes this file and never edits the instruction files you wrote yourself.`;

/**
 * Rule and rationale only. Source URLs are left out: they need repository access to read
 * anyway, and the rule is the part a future agent acts on.
 */
function formatRuleEntry(rule: ConventionRule): string {
  return `${RULE_BULLET}**${rule.rule}**${LINE_SEPARATOR}${RATIONALE_INDENT}${rule.rationale}`;
}

function formatCategorySections(rules: readonly ConventionRule[]): string[] {
  const sections: string[] = [];
  // Iterating the category constant rather than the rules keeps the section order stable
  // between exports, so the file diffs as content changing rather than as a reordering.
  for (const category of Object.values(CONVENTION_CATEGORY)) {
    const inCategory = rules.filter((rule) => rule.category === category);
    if (inCategory.length === NO_ENTRIES) continue;

    const entries = inCategory.map(formatRuleEntry).join(SECTION_SEPARATOR);
    sections.push(
      `${SUBHEADING_PREFIX}${CONVENTION_CATEGORY_HEADING[category]}${SECTION_SEPARATOR}${entries}`,
    );
  }

  return sections;
}

function buildRepoFileContent(repoKey: string, rules: readonly ConventionRule[]): string {
  const frontmatter = [
    FRONTMATTER_FENCE,
    `description: Conventions distilled from review comments on ${repoKey}`,
    FRONTMATTER_ALWAYS_APPLY,
    FRONTMATTER_FENCE,
  ].join(LINE_SEPARATOR);

  // Trailing newline: this lands in a git repository, and a file without one shows up as
  // a "\ No newline at end of file" marker in every diff that ever touches it.
  return `${[
    frontmatter,
    `${HEADING_PREFIX}${REPO_FILE_TITLE}`,
    REPO_FILE_PREAMBLE,
    ...formatCategorySections(rules),
  ].join(SECTION_SEPARATOR)}${LINE_SEPARATOR}`;
}

function buildGlobalFileContent(rules: readonly ConventionRule[]): string {
  return `${[
    `${HEADING_PREFIX}${GLOBAL_FILE_TITLE}`,
    GLOBAL_FILE_PREAMBLE,
    ...formatCategorySections(rules),
  ].join(SECTION_SEPARATOR)}${LINE_SEPARATOR}`;
}

/**
 * Rules already exported are written again alongside newly confirmed ones, because the
 * file is rewritten whole: exporting only the confirmed ones would silently delete
 * everything a previous export put there.
 */
function isExportable(rule: ConventionRule): boolean {
  return rule.state === CONVENTION_STATE.CONFIRMED || rule.state === CONVENTION_STATE.EXPORTED;
}

interface ExportSelection {
  repoRules: ConventionRule[];
  globalRules: ConventionRule[];
}

function selectExportRules(repoKey: string): ExportSelection {
  const rules = getConventionRules().filter(isExportable);
  return {
    repoRules: rules.filter(
      (rule) => rule.scope === CONVENTION_SCOPE.REPO && rule.repoKey === repoKey,
    ),
    globalRules: rules.filter((rule) => rule.scope === CONVENTION_SCOPE.GLOBAL),
  };
}

function requireRepoPath(repoKey: string): string {
  const repoPath = resolveLocalRepoPath(repoKey);
  if (repoPath === null) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      `${repoKey} has no local clone, so there is nowhere to write its conventions.`,
      REPO_NOT_CLONED_REMEDIATION,
    );
  }

  return repoPath;
}

/**
 * Exactly what an export would write, so the gate shows the files rather than a promise
 * about them. Pure: nothing is written and no state moves.
 */
export function previewConventionExport(repoKey: string): ConventionExportPreview {
  const { repoRules, globalRules } = selectExportRules(repoKey);
  const repoPath = requireRepoPath(repoKey);

  return {
    repoFilePath: join(repoPath, CURSOR_DIRECTORY_NAME, RULES_DIRECTORY_NAME, REPO_RULES_FILE_NAME),
    repoFileContent: buildRepoFileContent(repoKey, repoRules),
    globalFilePath: join(app.getPath('userData'), GLOBAL_RULES_FILE_NAME),
    globalFileContent: buildGlobalFileContent(globalRules),
    ruleCount: repoRules.length + globalRules.length,
  };
}

/**
 * Writes the confirmed rules into the user's real repository, which puts it outside the
 * punchlist: it takes a `SandboxConfirmation` at the type level, and it is audited.
 *
 * `.cursor/rules/**` is on the guardrails' protected-path list and this writes there on
 * purpose. That entry exists to stop an *agent resolving a comment* from rewriting its own
 * guardrails; this is a user-confirmed action initiated from the app, with the exact file
 * content shown beforehand. It is a deliberate exception rather than a quiet bypass, which
 * is why the audit entry says so.
 */
export async function exportConventions(
  request: ExportConventionsRequest,
  confirmation: SandboxConfirmation,
): Promise<ConventionRule[]> {
  // Checked rather than assumed: a confirmation never crosses IPC, and confirming one
  // action does not authorise another.
  assertSandboxConfirmation(confirmation, SANDBOX_EXIT_ACTION.EXPORT_CONVENTIONS);

  const preview = previewConventionExport(request.repoKey);
  if (preview.ruleCount === NO_ENTRIES) {
    throw new AppError(
      APP_ERROR_KIND.NOT_FOUND,
      `${request.repoKey} has no confirmed conventions to export.`,
      NOTHING_TO_EXPORT_REMEDIATION,
    );
  }

  const { repoRules, globalRules } = selectExportRules(request.repoKey);

  // A file is written only where there is something to say: an empty rules file dropped
  // into a repository is noise the user then has to delete.
  if (repoRules.length > NO_ENTRIES) {
    await mkdir(dirname(preview.repoFilePath), { recursive: true });
    await writeFile(preview.repoFilePath, preview.repoFileContent, FILE_ENCODING);
  }
  if (globalRules.length > NO_ENTRIES) {
    await writeFile(preview.globalFilePath, preview.globalFileContent, FILE_ENCODING);
  }

  // Audited after the write succeeds, like every other action that leaves the sandbox, and
  // it records counts and the repository only — never a rule body, never a comment body.
  await appendAuditEntry({
    action: AUDIT_ACTION.CONVENTIONS_EXPORTED,
    summary: `Exported ${repoRules.length} repo and ${globalRules.length} global convention rule(s) to ${request.repoKey}; confirmed exception to the .cursor/rules protected path`,
  });

  const exportedIds = new Set([...repoRules, ...globalRules].map((rule) => rule.id));
  const updatedAt = new Date().toISOString();
  const next = getConventionRules().map((rule) =>
    exportedIds.has(rule.id) ? { ...rule, state: CONVENTION_STATE.EXPORTED, updatedAt } : rule,
  );

  setConventionsState(getConventionEvidence(), next);
  return next;
}
