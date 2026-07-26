/**
 * The counted noun phrases a landing and its undo both have to spell out. They live
 * here rather than in either surface because the two must agree: an undo that reads
 * "unresolve 3 threads" beside a landing that read "resolve 3 review threads" would
 * leave the reader wondering whether those are the same three.
 *
 * Phrases, not sentences — the caller supplies the verb, so "resolve 1 review thread"
 * and "1 review thread resolved" come out of one source.
 */

const EMPTY_COUNT = 0;
const SINGLE_ITEM_COUNT = 1;

const NO_THREADS_PHRASE = 'no review thread';
const SINGLE_THREAD_PHRASE = '1 review thread';
const THREADS_PHRASE_SUFFIX = ' review threads';

const NO_RUNS_PHRASE = 'no run';
const SINGLE_RUN_PHRASE = '1 run';
const RUNS_PHRASE_SUFFIX = ' runs';

export function buildThreadCountPhrase(count: number): string {
  if (count === EMPTY_COUNT) return NO_THREADS_PHRASE;
  if (count === SINGLE_ITEM_COUNT) return SINGLE_THREAD_PHRASE;
  return `${count}${THREADS_PHRASE_SUFFIX}`;
}

export function buildRunCountPhrase(count: number): string {
  if (count === EMPTY_COUNT) return NO_RUNS_PHRASE;
  if (count === SINGLE_ITEM_COUNT) return SINGLE_RUN_PHRASE;
  return `${count}${RUNS_PHRASE_SUFFIX}`;
}
