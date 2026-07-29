import { isTerminalRunState } from '@shared/runState';
import { assertNever } from '@renderer/lib/assertNever';
import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { StateBadge } from '@renderer/components/StateBadge';
import { ClockIcon } from '@renderer/components/icons/ClockIcon';
import { FlagIcon } from '@renderer/components/icons/FlagIcon';
import { selectRunForComment, useRunStore, type RunsById } from '@renderer/stores/runStore';
import { COMMENT_TREE_NODE_KIND, type CommentTreeRow } from '../commentTreeModel';
import { CommentAttributeBadges } from './CommentAttributeBadges';
import { CommentTierBadge } from './CommentTierBadge/CommentTierBadge';
import { RowGlyph } from './RowGlyph';

export interface CommentRowBadgesProps {
  row: CommentTreeRow;
}

const SINGLE_COMMENT_COUNT = 1;
const SINGLE_COMMENT_TITLE = '1 comment in here';
const COMMENT_COUNT_TITLE_SUFFIX = ' comments in here';

const GUARDRAIL_TITLE = 'Flagged: this patch carries guardrail findings worth reading it with';

const STALE_TITLE =
  'Stale: the PR head moved after this run started, so its patch is against code that is no longer current';

/** Matches the other row glyphs, so every small mark on a row agrees in weight. */
const NO_FLAGS = 0;
const ROW_GLYPH_SIZE = 12;

const BADGE_LIST_CLASS = 'flex shrink-0 items-center gap-1';

const NO_COMMENT_IDS: readonly string[] = [];

export function CommentRowBadges({ row }: CommentRowBadgesProps) {
  // Subscribing to a boolean rather than the record keeps a transcript chunk on one run
  // from re-rendering every row's badges.
  const hasFlaggedRun = useRunStore((state) => selectHasFlaggedRun(state.runsById, row));
  const hasStaleRun = useRunStore((state) => selectHasStaleRun(state.runsById, row));

  // Colour carries the warning, the tooltip carries the words: a flag is worth a
  // mark on the row, not a second text badge crowding the comment out.
  const guardrailGlyph = hasFlaggedRun ? (
    <RowGlyph
      title={GUARDRAIL_TITLE}
      icon={<FlagIcon size={ROW_GLYPH_SIZE} />}
      className="text-warning"
    />
  ) : null;

  // A stale run still reads as landable — StateBadge says "Ready" — while its patch is
  // against a head that has since moved, so this stays visible until the run is
  // terminal; a landed or rejected run is history rather than a warning.
  const staleGlyph = hasStaleRun ? (
    <RowGlyph
      title={STALE_TITLE}
      icon={<ClockIcon size={ROW_GLYPH_SIZE} />}
      className="text-warning"
    />
  ) : null;

  const stateBadge = (() => {
    if (row.runState === null) return null;
    // An expanded group's children carry their own badges, so rolling up there would
    // double every signal; the roll-up exists to keep a collapsed subtree informative.
    if (row.isExpanded) return null;
    return <StateBadge state={row.runState} />;
  })();

  const tierBadge = (() => {
    if (row.node.kind !== COMMENT_TREE_NODE_KIND.COMMENT) return null;
    // Tier answers "what will this cost to run", which stops being the question the
    // moment a run exists: from then on StateBadge supersedes it.
    if (row.runState !== null) return null;
    return <CommentTierBadge comment={row.node.comment} />;
  })();

  const attributeBadges = (() => {
    switch (row.node.kind) {
      case COMMENT_TREE_NODE_KIND.COMMENT:
        return <CommentAttributeBadges comment={row.node.comment} />;
      case COMMENT_TREE_NODE_KIND.PR_CONVERSATION:
      case COMMENT_TREE_NODE_KIND.DIRECTORY:
      case COMMENT_TREE_NODE_KIND.FILE: {
        const count = row.node.descendantCommentIds.length;
        return (
          <Badge tone={BADGE_TONE.NEUTRAL} isMuted title={buildCountTitle(count)}>
            {count}
          </Badge>
        );
      }
      default:
        return assertNever(row.node);
    }
  })();

  return (
    <span className={BADGE_LIST_CLASS}>
      {guardrailGlyph}
      {staleGlyph}
      {stateBadge}
      {tierBadge}
      {attributeBadges}
    </span>
  );
}

function buildCountTitle(count: number): string {
  if (count === SINGLE_COMMENT_COUNT) return SINGLE_COMMENT_TITLE;
  return `${count}${COMMENT_COUNT_TITLE_SUFFIX}`;
}

/**
 * Which comments a row answers for. An expanded group's children carry their own
 * badges, so rolling up there would double the signal — the same rule StateBadge
 * follows one badge to the right.
 */
function rolledUpCommentIdsOf(row: CommentTreeRow): readonly string[] {
  if (row.node.kind === COMMENT_TREE_NODE_KIND.COMMENT) return [row.node.comment.id];
  if (row.isExpanded) return NO_COMMENT_IDS;
  return row.node.descendantCommentIds;
}

function selectHasFlaggedRun(runsById: RunsById, row: CommentTreeRow): boolean {
  return rolledUpCommentIdsOf(row).some((commentId) => {
    const run = selectRunForComment(runsById, commentId);
    if (run === null) return false;
    return run.guardrailFlags.length > NO_FLAGS;
  });
}

function selectHasStaleRun(runsById: RunsById, row: CommentTreeRow): boolean {
  return rolledUpCommentIdsOf(row).some((commentId) => {
    const run = selectRunForComment(runsById, commentId);
    if (run === null) return false;
    // The watcher only marks non-terminal runs stale, and this agrees with it: a
    // landed or rejected run is history rather than something to warn about, so the
    // flag it kept on the way there stops being shown.
    return run.isStale && !isTerminalRunState(run.state);
  });
}
