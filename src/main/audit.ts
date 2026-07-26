import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { auditEntrySchema, type AuditAction, type AuditEntry } from '@shared/audit';
import type { PrRef } from '@shared/discovery';

/**
 * The audit log is JSON Lines in its own file rather than an array inside the state
 * store, for two reasons that both come from it being a history rather than state:
 *
 * - **Appending must not rewrite the history.** The store replaces its whole file on
 *   every write, so a crash mid-write costs the newest change — acceptable for state
 *   that can be recomputed, not for the record of what was done to a real repository.
 *   One `O_APPEND` write of one line leaves every earlier line untouched by
 *   construction, so the worst case is a torn final line, which the reader skips.
 * - **A torn or older line stays isolated.** One malformed entry in an array makes the
 *   whole array fail to parse; one malformed line loses one line.
 *
 * It is separate from `airlock-state.json` for the same reason the encrypted key is:
 * a log you may want to hand to someone, or keep after clearing app state.
 */
const AUDIT_FILE_NAME = 'airlock-audit.jsonl';
const FILE_ENCODING = 'utf8';
const LINE_SEPARATOR = '\n';

/**
 * A landing id is minted here rather than by the caller so the undo path in phase 6 can
 * rely on every entry of one landing carrying the same one. The prefix is for the human
 * reading the file by hand, which is half the point of a plain-text log.
 */
const LANDING_ID_PREFIX = 'landing-';

/**
 * `summary` is the only free-text field in an entry, so it is the only place a payload
 * could ever enter the log. It is normalised to a single short line: a diff, a comment
 * body or a transcript is multi-line and long, so what makes it through is a stub, not
 * a copy. This is the second line of defence — the first is `AppendAuditEntryInput`,
 * which has no field shaped to carry one.
 */
const MAX_SUMMARY_LENGTH = 200;
const SUMMARY_TRUNCATION_SUFFIX = '…';
const SUMMARY_START_INDEX = 0;
const WHITESPACE_RUN_PATTERN = /\s+/g;
const SINGLE_SPACE = ' ';

const EMPTY_LENGTH = 0;

/**
 * What an action may record: an action name, the ids it touched, the branch and remote
 * it touched them on, and a one-line summary. There is deliberately no field for a
 * diff, a comment body, a transcript, a token or a command line — the log records
 * **what was done, never the content it was done to**, and a shape that cannot hold a
 * payload is the only version of that rule an agent cannot forget.
 *
 * `id` and `at` are absent because they are minted in `appendAuditEntry`.
 */
export interface AppendAuditEntryInput {
  action: AuditAction;
  prRef?: PrRef | null;
  /** One short line naming the action, e.g. `Resolved 3 threads on airlock/pr-42`. */
  summary: string;
  runIds?: readonly string[];
  /** Thread node ids, which is what unresolving them again needs. */
  threadIds?: readonly string[];
  branchName?: string | null;
  remoteName?: string | null;
  /** Set by every entry of one landing, so an undo can replay exactly that landing. */
  landingId?: string | null;
}

/**
 * Appends are serialised through one chain so entries within a landing land in the order
 * they happened — an undo replays a landing in reverse, so that order is load-bearing.
 */
let pendingAppend: Promise<void> = Promise.resolve();

function resolveAuditFilePath(): string {
  return join(app.getPath('userData'), AUDIT_FILE_NAME);
}

function normalizeSummary(summary: string): string {
  const singleLine = summary.replace(WHITESPACE_RUN_PATTERN, SINGLE_SPACE).trim();
  if (singleLine.length <= MAX_SUMMARY_LENGTH) return singleLine;
  // Truncation rather than a thrown error: an over-long summary is a caller bug, and
  // failing the append would leave an out-of-sandbox action with no record at all,
  // which is the one outcome the trust boundary does not tolerate.
  return `${singleLine.slice(SUMMARY_START_INDEX, MAX_SUMMARY_LENGTH)}${SUMMARY_TRUNCATION_SUFFIX}`;
}

function decodeLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    // A line written by a crash mid-append, or by a version that framed entries
    // differently. It is dropped rather than reported: the rest of the log is still
    // valid history, and echoing the line would print whatever it happens to contain.
    return undefined;
  }
}

function appendLine(line: string): Promise<void> {
  const filePath = resolveAuditFilePath();
  const write = pendingAppend.then(() =>
    appendFile(filePath, `${line}${LINE_SEPARATOR}`, FILE_ENCODING),
  );
  // The chain is kept on a settled tail so one failed append does not block every
  // later entry from ever being written.
  pendingAppend = write.catch(() => undefined);
  return write;
}

async function readAuditEntries(): Promise<AuditEntry[]> {
  const filePath = resolveAuditFilePath();
  if (!existsSync(filePath)) return [];

  // Read failures deliberately propagate. An unreadable log rendered as an empty one
  // would be a claim that nothing ever happened to the repository.
  const contents = await readFile(filePath, FILE_ENCODING);

  const entries: AuditEntry[] = [];
  for (const line of contents.split(LINE_SEPARATOR)) {
    if (line.trim().length === EMPTY_LENGTH) continue;
    // Reading is a parse boundary: the file may have been written by an older version,
    // so each line is parsed on its own and a line that will not parse is skipped
    // rather than costing the rest of the history.
    const parsed = auditEntrySchema.safeParse(decodeLine(line));
    if (!parsed.success) continue;
    entries.push(parsed.data);
  }

  // Newest first: the UI reads this as history, and an undo wants the last landing.
  return entries.reverse();
}

/**
 * The only way to write to the log, and it exposes no counterpart: an entry is never
 * edited or deleted, including by an undo — an undo is itself a new entry.
 */
export async function appendAuditEntry(input: AppendAuditEntryInput): Promise<AuditEntry> {
  // Re-parsed before it is written, like every store mutator: an entry the schema would
  // reject is one the reader would silently skip, which is a hole in the history.
  const entry = auditEntrySchema.parse({
    id: randomUUID(),
    action: input.action,
    at: new Date().toISOString(),
    prRef: input.prRef,
    summary: normalizeSummary(input.summary),
    runIds: input.runIds,
    threadIds: input.threadIds,
    branchName: input.branchName,
    remoteName: input.remoteName,
    landingId: input.landingId,
  });

  await appendLine(JSON.stringify(entry));
  return entry;
}

export async function listAuditEntries(): Promise<AuditEntry[]> {
  return readAuditEntries();
}

/** The entries of one landing, newest first, which is the order an undo replays them in. */
export async function listLandingAuditEntries(landingId: string): Promise<AuditEntry[]> {
  const entries = await readAuditEntries();
  return entries.filter((entry) => entry.landingId === landingId);
}

export function createLandingId(): string {
  return `${LANDING_ID_PREFIX}${randomUUID()}`;
}
