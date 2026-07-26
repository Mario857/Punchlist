import { Notification } from 'electron';
import { enqueueRuns } from '@main/queue';
import { resolveTierModel } from '@main/router';
import { listRunsForPr } from '@main/run';
import { getSettings, getWatcherState, updateWatcherState } from '@main/store';
import type { PrComment } from '@shared/comments';
import { prRefKey, type PrRef } from '@shared/discovery';
import { APP_ERROR_KIND, AppError } from '@shared/errors';
import { isPoolSpending } from '@shared/models';
import { RUN_TRIGGER } from '@shared/runState';
import type { StartRunRequest } from '@shared/runs';
import { classifyCommentTier } from '@shared/tier';

// Automation decides *when* a run starts; auto mode decides what gets answered while it
// runs. Both stop at the same place: an auto-triggered cycle runs entirely in the sandbox
// and parks at `ready`, so there is no helper here for approving a diff, committing to the
// integration branch, pushing, resolving a thread or posting a reply. The landing gate is
// untouched, which is the only reason starting work without being asked is safe at all.

const AUTOMATION_LOG_SCOPE = '[automation]';

/**
 * The ceiling is a rate, not a total, so timestamps age out of the window instead of
 * accumulating in the store for the lifetime of the PR.
 */
const AUTO_RUN_WINDOW_MS = 3_600_000;

/**
 * A head that has just moved is either the author pushing new commits or Punchlist's own
 * landing push arriving back from GitHub. Both mean the comments in this poll were written
 * against code that no longer exists, so automation sits out until the branch settles —
 * the same reason it pauses during a landing, one poll cycle later. Two default poll
 * intervals, so a single slow push cannot slip a batch through behind it.
 */
const HEAD_MOVE_QUIET_PERIOD_MS = 120_000;

const NO_AUTO_RUNS = 0;
const NO_ALLOWLISTED_AUTHORS = 0;
const REQUEST_LIST_START = 0;
const SINGLE_RUN = 1;

const AUTO_RUNS_FINISHED_TITLE = 'Punchlist';
const BATCH_FAILED_MESSAGE = 'An auto-triggered batch did not start.';
const POOL_SPENDING_SKIPPED_MESSAGE =
  'Skipped auto-triggered comments whose tier resolves to a pool-spending model.';

/**
 * Session state rather than a persisted flag: it tracks a landing that is happening right
 * now, and a landing cannot survive a restart. The setter is called by the landing gate's
 * caller rather than from landing.ts itself, because queue.ts already imports landing.ts
 * and this module imports queue.ts — wiring it the other way would close that cycle.
 */
let isLandingInProgress = false;

/** Keyed by prRefKey, because a head moves per PR and only that PR sits out. */
const headMovedAtByPr = new Map<string, number>();

/**
 * The persisted dedupe is the run records themselves, but a record only exists once its
 * worktree has been created. This closes the window between deciding to start a comment
 * and that record appearing, which a poll landing mid-batch would otherwise walk into.
 * Comment ids are GitHub node ids and unique across PRs, so no PR key is needed.
 */
const startingCommentIds = new Set<string>();

export function isAutomationPaused(): boolean {
  return isLandingInProgress;
}

export function setLandingInProgress(isInProgress: boolean): void {
  isLandingInProgress = isInProgress;
}

export function handleHeadMoved(ref: PrRef): void {
  headMovedAtByPr.set(prRefKey(ref), Date.now());
}

function isWithinHeadMoveQuietPeriod(ref: PrRef): boolean {
  const movedAt = headMovedAtByPr.get(prRefKey(ref));
  if (movedAt === undefined) return false;
  return Date.now() - movedAt < HEAD_MOVE_QUIET_PERIOD_MS;
}

/**
 * Only listed authors trigger a run, so automation reacts to the people you nominated
 * rather than to everyone who can type into the PR — including bots, which post
 * constantly. GitHub logins are case-insensitive, so a differently-cased entry names the
 * same person and must not silently fail to match.
 */
function isAllowlistedAuthor(comment: PrComment, allowlist: readonly string[]): boolean {
  const login = comment.author.login.toLowerCase();
  return allowlist.some((author) => author.toLowerCase() === login);
}

/**
 * Claims up to `requested` slots from the per-hour ceiling and records them, pruning the
 * timestamps that have aged out on the same write. The ceiling is a runaway guard rather
 * than a throughput setting: the concurrency cap already bounds how much runs at once, but
 * nothing else bounds how often a chatty PR can start something while you are away.
 *
 * Slots are claimed at start rather than on completion, so a batch still in flight counts
 * against the next poll's budget.
 */
function takeHourlyBudget(maxAutoRunsPerHour: number, requested: number): number {
  const horizon = Date.now() - AUTO_RUN_WINDOW_MS;
  // Date.parse yields NaN for a value an older version of the app wrote in another shape,
  // and NaN fails this comparison, so a malformed timestamp is pruned rather than kept
  // forever or counted against the ceiling.
  const recent = getWatcherState().autoRunStartedAt.filter((at) => Date.parse(at) >= horizon);

  const granted = Math.max(NO_AUTO_RUNS, Math.min(requested, maxAutoRunsPerHour - recent.length));
  const startedAt = new Date().toISOString();
  const claimed = Array.from({ length: granted }, () => startedAt);
  updateWatcherState({ autoRunStartedAt: [...recent, ...claimed] });

  return granted;
}

/**
 * Automation never selects a pool-spending model: auto-spending while you are away
 * contradicts the whole cost model, and a frontier model stays an explicit opt-in. The
 * lane is resolved and checked rather than assumed, because the tier-to-model map is a
 * user setting and any tier can be pointed at a billable model.
 *
 * The tier travels with the request so the queue resolves the model whose lane was
 * checked here, instead of reclassifying and possibly landing somewhere else.
 */
async function toFreeLaneRequest(comment: PrComment): Promise<StartRunRequest | null> {
  const { tier } = classifyCommentTier(comment);
  const model = await resolveTierModel(tier);
  if (isPoolSpending(model.lane)) return null;
  return { commentId: comment.id, tier };
}

async function selectAutoRunRequests(
  ref: PrRef,
  comments: readonly PrComment[],
): Promise<StartRunRequest[]> {
  const { automation } = getSettings();
  if (!automation.isEnabled) return [];
  // An empty allowlist triggers nothing on purpose: enabling automation without naming
  // anyone does nothing rather than reacting to every author on the PR.
  if (automation.authorAllowlist.length === NO_ALLOWLISTED_AUTHORS) return [];
  // Paused while a landing is in progress, so an auto run cannot race the integration
  // branch that landing is assembling, merging into and pushing.
  if (isAutomationPaused()) return [];
  if (isWithinHeadMoveQuietPeriod(ref)) return [];

  // Deduped against the persisted run records rather than an in-memory set, so a restart
  // cannot auto-run a comment an earlier session already ran. Manual runs count too: a
  // comment the user has already worked on is handled, whoever started it.
  const startedCommentIds = new Set(listRunsForPr(ref).map((run) => run.commentId));
  const eligible = comments.filter(
    (comment) =>
      isAllowlistedAuthor(comment, automation.authorAllowlist) &&
      !startedCommentIds.has(comment.id) &&
      !startingCommentIds.has(comment.id),
  );

  // Filtered by lane before the budget is claimed, so a comment automation refuses to pay
  // for does not also burn one of the hour's slots.
  const affordable: StartRunRequest[] = [];
  let poolSpendingSkippedCount = NO_AUTO_RUNS;
  for (const comment of eligible) {
    const request = await toFreeLaneRequest(comment);
    if (request === null) {
      poolSpendingSkippedCount += SINGLE_RUN;
      continue;
    }
    affordable.push(request);
  }
  if (poolSpendingSkippedCount > NO_AUTO_RUNS) {
    console.warn(AUTOMATION_LOG_SCOPE, POOL_SPENDING_SKIPPED_MESSAGE, poolSpendingSkippedCount);
  }

  const granted = takeHourlyBudget(automation.maxAutoRunsPerHour, affordable.length);
  return affordable.slice(REQUEST_LIST_START, granted);
}

/**
 * The point of automation is that results are waiting when you come back, which only works
 * if something says so. Counts and the PR they belong to are the whole payload — never a
 * comment body, a diff or a transcript, all of which can quote repository contents.
 */
function notifyAutoRunsFinished(ref: PrRef, finishedCount: number): void {
  if (finishedCount === NO_AUTO_RUNS) return;
  // Degrades silently where the OS has no notification centre: the runs are in the app
  // either way, and a missing notification must not fail the batch that earned it.
  if (!Notification.isSupported()) return;

  const runLabel = finishedCount === SINGLE_RUN ? 'run' : 'runs';
  new Notification({
    title: AUTO_RUNS_FINISHED_TITLE,
    body: `${finishedCount} automated ${runLabel} finished on ${prRefKey(ref)}. Waiting for review.`,
  }).show();
}

/**
 * What the watcher's new comments are for. Every guard lives in `selectAutoRunRequests`, so
 * this is only the start-and-report half: the runs go through the same queue as a manual
 * batch, which is what keeps the concurrency cap, tier routing, the guardrail pass and the
 * escalation rules from being restated on a second execution path.
 */
export async function handleNewComments(ref: PrRef, comments: readonly PrComment[]): Promise<void> {
  const requests = await selectAutoRunRequests(ref, comments);
  if (requests.length === NO_AUTO_RUNS) return;

  const commentIds = requests.map((request) => request.commentId);
  for (const commentId of commentIds) startingCommentIds.add(commentId);

  try {
    const runs = await enqueueRuns(ref, requests, RUN_TRIGGER.AUTO);
    notifyAutoRunsFinished(ref, runs.length);
  } catch (error: unknown) {
    // Nobody asked for this batch, so a failure is reported to the console and dropped
    // rather than thrown at a caller that has no user behind it. Only the error kind is
    // logged: an agent-facing message can quote repository contents.
    const kind = error instanceof AppError ? error.kind : APP_ERROR_KIND.UNKNOWN;
    console.warn(AUTOMATION_LOG_SCOPE, BATCH_FAILED_MESSAGE, kind);
  } finally {
    for (const commentId of commentIds) startingCommentIds.delete(commentId);
  }
}
