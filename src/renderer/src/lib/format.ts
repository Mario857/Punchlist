import { isDefined } from './guards';
import { clamp } from './numbers';

/** Nullish behaviour is decided here once, so no call site repeats a null check. */
const EMPTY_VALUE = '--';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const NO_HOURS = 0;
/** One decimal place of a second — the precision `scaledValueFormat` prints. */
const SECONDS_DISPLAY_PRECISION_MS = 100;

const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = MS_PER_HOUR * HOURS_PER_DAY;
const DAYS_PER_YEAR = 365;
const MS_PER_YEAR = MS_PER_DAY * DAYS_PER_YEAR;
const NO_ELAPSED_MS = 0;
const JUST_NOW_LABEL = 'just now';
const RELATIVE_TIME_LABEL_SUFFIX = ' ago';

/** Coarsest first, so the first match is the largest unit that fits. */
const RELATIVE_TIME_UNITS = [
  { ms: MS_PER_YEAR, suffix: 'y' },
  { ms: MS_PER_DAY, suffix: 'd' },
  { ms: MS_PER_HOUR, suffix: 'h' },
  { ms: MS_PER_MINUTE, suffix: 'm' },
] as const;

const BYTES_PER_UNIT = 1024;
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const FIRST_UNIT_EXPONENT = 0;
const LAST_UNIT_EXPONENT = BYTE_UNITS.length - 1;

const WHOLE_NUMBER_FRACTION_DIGITS = 0;
const SCALED_VALUE_FRACTION_DIGITS = 1;
const TIME_SEGMENT_INTEGER_DIGITS = 2;

// One preset per display concern, constructed once: Intl.NumberFormat is
// expensive to build and these render on every row of the comment tree.
const wholeNumberFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: WHOLE_NUMBER_FRACTION_DIGITS,
});

const scaledValueFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: SCALED_VALUE_FRACTION_DIGITS,
  maximumFractionDigits: SCALED_VALUE_FRACTION_DIGITS,
});

const timeSegmentFormat = new Intl.NumberFormat(undefined, {
  minimumIntegerDigits: TIME_SEGMENT_INTEGER_DIGITS,
  useGrouping: false,
});

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDuration(ms: number | null | undefined): string {
  if (!isDefined(ms)) return EMPTY_VALUE;
  if (ms < MS_PER_SECOND) return `${wholeNumberFormat.format(ms)}ms`;

  // Round to the precision that will actually be printed, so 59_999ms crosses into
  // 1:00 rather than rendering as the self-contradictory "60.0s".
  const rounded = Math.round(ms / SECONDS_DISPLAY_PRECISION_MS) * SECONDS_DISPLAY_PRECISION_MS;
  const totalSeconds = rounded / MS_PER_SECOND;
  if (totalSeconds < SECONDS_PER_MINUTE) return `${scaledValueFormat.format(totalSeconds)}s`;

  const wholeSeconds = Math.floor(totalSeconds);
  const hours = Math.floor(wholeSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((wholeSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = wholeSeconds % SECONDS_PER_MINUTE;
  const paddedSeconds = timeSegmentFormat.format(seconds);
  if (hours === NO_HOURS) return `${wholeNumberFormat.format(minutes)}:${paddedSeconds}`;
  return `${wholeNumberFormat.format(hours)}:${timeSegmentFormat.format(minutes)}:${paddedSeconds}`;
}

/**
 * Elapsed wall-clock age, not a stopwatch reading. `formatDuration` is the wrong
 * helper for this — it renders a run's elapsed time as a clock, so a PR last touched
 * three days ago would read "72:00:00" and thirty minutes ago would read "30:00",
 * which is indistinguishable from thirty seconds. This rolls up through days and
 * years instead, and is the single helper for "how long ago".
 */
export function formatRelativeTime(ms: number | null | undefined): string {
  if (!isDefined(ms)) return EMPTY_VALUE;

  const elapsed = Math.max(ms, NO_ELAPSED_MS);
  if (elapsed < MS_PER_MINUTE) return JUST_NOW_LABEL;

  const unit = RELATIVE_TIME_UNITS.find((candidate) => elapsed >= candidate.ms);
  // The list ends at the minute, and anything below it already returned above.
  if (unit === undefined) return JUST_NOW_LABEL;

  const count = Math.floor(elapsed / unit.ms);
  return `${wholeNumberFormat.format(count)}${unit.suffix}${RELATIVE_TIME_LABEL_SUFFIX}`;
}

/**
 * The absolute counterpart, for a timestamp that should not shift as you read it —
 * when a comment was written, rather than how stale a PR is.
 */
export function formatDateTime(isoTimestamp: string | null | undefined): string {
  if (!isDefined(isoTimestamp)) return EMPTY_VALUE;

  const parsed = new Date(isoTimestamp);
  // An unparseable date is malformed upstream data, not something to render as NaN.
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE;
  return dateTimeFormat.format(parsed);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!isDefined(bytes)) return EMPTY_VALUE;

  // clamp covers both ends of Math.log: -Infinity at zero bytes, and a worktree
  // larger than the last named unit.
  const exponent = clamp(
    Math.floor(Math.log(bytes) / Math.log(BYTES_PER_UNIT)),
    FIRST_UNIT_EXPONENT,
    LAST_UNIT_EXPONENT,
  );
  const scaled = bytes / BYTES_PER_UNIT ** exponent;
  // A raw byte count reads as noise with a decimal place; a scaled unit needs one.
  const numberFormat = exponent === FIRST_UNIT_EXPONENT ? wholeNumberFormat : scaledValueFormat;
  return `${numberFormat.format(scaled)} ${BYTE_UNITS[exponent]}`;
}
