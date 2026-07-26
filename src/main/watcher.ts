import { fetchPrComments, fetchPrStatus } from '@main/github';
import { patchRun } from '@main/runState';
import { getRuns, getSession, getSettings, getWatcherState, updateWatcherState } from '@main/store';
import type { PrComment } from '@shared/comments';
import { prRefKey, type PrRef } from '@shared/discovery';
import { toErrorPayload, type AppErrorPayload } from '@shared/errors';
import { isTerminalRunState } from '@shared/runState';

const WATCHER_LOG_SCOPE = '[watcher]';

const NO_NEW_COMMENTS = 0;

/**
 * What a pass reports. The watcher detects and nothing else: what a new comment is
 * allowed to trigger is `automation.ts`'s decision, and a watcher that started runs
 * itself would be neither testable nor reusable by anything but automation.
 */
export interface WatcherObserver {
  onNewComments(ref: PrRef, comments: PrComment[]): void;
  onHeadMoved(ref: PrRef, headSha: string): void;
  /**
   * A poll that failed. Reported rather than swallowed: a blip retries next pass on its
   * own, but a token that expired an hour ago must not look like a quiet PR.
   */
  onPollFailed(ref: PrRef, error: AppErrorPayload): void;
}

/** Null between passes; holding it is what makes stop able to cancel a pending one. */
let scheduledTimer: NodeJS.Timeout | null = null;
let isWatching = false;
let isPassInFlight = false;

/**
 * The PRs being worked on, not a global search. GitHub's search API is rate limited far
 * more tightly than the regular one, which is why discovery stays a manual refresh and
 * this watches specific PRs instead: every run record's PR, plus the one the session is
 * open on so a PR with no runs yet is still watched.
 */
function listWatchedPrs(): PrRef[] {
  const byKey = new Map<string, PrRef>();

  const { lastPr } = getSession();
  if (lastPr !== null) byKey.set(prRefKey(lastPr), lastPr);
  for (const run of getRuns()) byKey.set(prRefKey(run.prRef), run.prRef);

  return [...byKey.values()];
}

// Each write re-reads the persisted map rather than closing over one: a pass touches
// several PRs and automation appends to the same state, so writing back a snapshot
// taken earlier would drop whatever landed in between.
function rememberUpdatedAt(key: string, updatedAt: string): void {
  updateWatcherState({
    lastUpdatedAtByPr: { ...getWatcherState().lastUpdatedAtByPr, [key]: updatedAt },
  });
}

function rememberHeadSha(key: string, headSha: string): void {
  updateWatcherState({
    lastHeadShaByPr: { ...getWatcherState().lastHeadShaByPr, [key]: headSha },
  });
}

/**
 * The union, never a replacement: a comment deleted from the PR would otherwise fall out
 * of the set and re-trigger if it ever came back, and an edited comment keeps its id.
 */
function rememberSeenCommentIds(key: string, commentIds: readonly string[]): void {
  const seenByPr = getWatcherState().lastSeenCommentIdsByPr;
  const union = new Set([...(seenByPr[key] ?? []), ...commentIds]);
  updateWatcherState({ lastSeenCommentIdsByPr: { ...seenByPr, [key]: [...union] } });
}

/**
 * A moved head means every existing worktree for this PR is based on code that is no
 * longer current, so its run would silently offer a patch against the old head.
 *
 * `isStale` is a field on the record rather than a state — the run has not moved, only
 * the ground under it — so it goes through `patchRun` and not a transition. Terminal
 * runs are left alone: a landed or rejected run is history, not something to warn about.
 */
function markRunsStale(key: string): void {
  for (const run of getRuns()) {
    if (prRefKey(run.prRef) !== key) continue;
    if (isTerminalRunState(run.state) || run.isStale) continue;
    patchRun(run, { isStale: true });
  }
}

function detectHeadMove(ref: PrRef, key: string, headSha: string, observer: WatcherObserver): void {
  const previousHeadSha = getWatcherState().lastHeadShaByPr[key];
  if (previousHeadSha === headSha) return;

  // The first sighting of a PR records rather than reports: with nothing to compare
  // against, every watched PR would look like it had just been pushed to.
  if (previousHeadSha !== undefined) {
    // Marked before the new sha is persisted, so a crash in between re-marks on the next
    // pass instead of losing the staleness entirely.
    markRunsStale(key);
    observer.onHeadMoved(ref, headSha);
  }

  rememberHeadSha(key, headSha);
}

async function detectNewComments(
  ref: PrRef,
  key: string,
  updatedAt: string,
  observer: WatcherObserver,
): Promise<void> {
  const watcher = getWatcherState();
  const seenCommentIds = watcher.lastSeenCommentIdsByPr[key];
  const isFirstPoll = seenCommentIds === undefined;

  // Stage two, and the reason a sixty-second interval fits inside the GraphQL rate
  // limit: fetching comments is three paginated calls, so it runs only when the PR's own
  // updatedAt says something happened. A PR still being seeded runs it regardless,
  // because there is no last-seen set to compare against yet.
  if (!isFirstPoll && watcher.lastUpdatedAtByPr[key] === updatedAt) return;

  const comments = await fetchPrComments(ref);
  rememberSeenCommentIds(
    key,
    comments.map((comment) => comment.id),
  );
  // Persisted only once the comment stage has succeeded. Recording it up front would
  // make a failed fetch look like a handled change and skip these comments forever.
  rememberUpdatedAt(key, updatedAt);

  // The first poll of a PR records what is already there and reports nothing. Otherwise
  // enabling the watcher would fire on every comment the PR has ever had.
  if (isFirstPoll) return;

  const seen = new Set(seenCommentIds);
  const newComments = comments.filter((comment) => !seen.has(comment.id));
  if (newComments.length === NO_NEW_COMMENTS) return;

  observer.onNewComments(ref, newComments);
}

async function pollPr(ref: PrRef, observer: WatcherObserver): Promise<void> {
  const key = prRefKey(ref);
  const status = await fetchPrStatus(ref);

  detectHeadMove(ref, key, status.headSha, observer);
  await detectNewComments(ref, key, status.updatedAt, observer);
}

/**
 * One pass over every watched PR. Exported so automation can force a check without
 * waiting for the interval, and so the loop itself has nothing in it but scheduling.
 *
 * PRs are polled one at a time on purpose: the point of the two-stage check is to stay
 * well inside the rate limit, which firing every PR's queries at once would undo.
 */
export async function pollOnce(observer: WatcherObserver): Promise<void> {
  // An external call must not interleave with the loop's own pass, or both would read
  // the same last-seen set and report the same comments twice.
  if (isPassInFlight) return;
  isPassInFlight = true;

  try {
    for (const ref of listWatchedPrs()) {
      try {
        await pollPr(ref, observer);
      } catch (error: unknown) {
        // Per PR, so a deleted PR, a rate limit or a network blip costs that PR this
        // pass and nothing more. The kind is preserved so "gh is not authenticated"
        // stays distinguishable from "GitHub is unreachable"; the message is a gh
        // diagnostic, never comment content.
        const payload = toErrorPayload(error);
        console.warn(WATCHER_LOG_SCOPE, `Polling ${prRefKey(ref)} failed.`, payload.kind);
        observer.onPollFailed(ref, payload);
      }
    }
  } finally {
    isPassInFlight = false;
  }
}

function scheduleNextPass(observer: WatcherObserver): void {
  // Read per pass rather than captured at start, so changing the interval in Settings
  // takes effect on the next tick instead of the next app launch.
  const timer = setTimeout(() => {
    void runPass(observer);
  }, getSettings().automation.pollIntervalMs);
  // The poll must never be the thing keeping the process alive after the window closes.
  timer.unref();
  scheduledTimer = timer;
}

async function runPass(observer: WatcherObserver): Promise<void> {
  if (!isWatching) return;

  try {
    await pollOnce(observer);
  } catch (error: unknown) {
    // pollOnce already contains a per-PR failure, so reaching here means the observer
    // itself threw. Swallowed all the same: a caller's bug must not end the loop, and it
    // would otherwise surface as an unhandled rejection in main.
    console.warn(WATCHER_LOG_SCOPE, 'A poll pass ended early.', toErrorPayload(error).kind);
  }

  // Checked again after the await: stop may have landed while the pass was running, and
  // a stopped watcher schedules nothing.
  if (!isWatching) return;
  scheduleNextPass(observer);
}

/** A second start is a no-op rather than a second timer, which would double the poll. */
export function startWatcher(observer: WatcherObserver): void {
  if (isWatching) return;
  isWatching = true;
  scheduleNextPass(observer);
}

export function stopWatcher(): void {
  isWatching = false;
  if (scheduledTimer === null) return;
  clearTimeout(scheduledTimer);
  scheduledTimer = null;
}
