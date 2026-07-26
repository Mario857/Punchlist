import { hasUnacknowledgedFlags } from '@shared/guardrails';
import { assertNever } from '@renderer/lib/assertNever';
import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { StateBadge } from '@renderer/components/StateBadge';
import { AlertTriangleIcon } from '@renderer/components/icons/AlertTriangleIcon';
import { selectRunForComment, useRunStore, type RunsById } from '@renderer/stores/runStore';
import { COMMENT_TREE_NODE_KIND, type CommentTreeRow } from '../commentTreeModel';
import { CommentAttributeBadges } from './CommentAttributeBadges';
import { CommentTierBadge } from './CommentTierBadge/CommentTierBadge';

export interface CommentRowBadgesProps {
  row: CommentTreeRow;
}

const SINGLE_COMMENT_COUNT = 1;
const SINGLE_COMMENT_TITLE = '1 comment in here';
const COMMENT_COUNT_TITLE_SUFFIX = ' comments in here';

const GUARDRAIL_LABEL = 'Flagged';
const GUARDRAIL_TITLE = 'This patch touched something worth acknowledging before it is approved';

/** Matches the other row glyphs, so every small mark on a row agrees in weight. */
const GUARDRAIL_BADGE_ICON_SIZE = 11;

const BADGE_LIST_CLASS = 'flex shrink-0 items-center gap-1';

const NO_COMMENT_IDS: readonly string[] = [];

export function CommentRowBadges({ row }: CommentRowBadgesProps) {
  // Subscribing to a boolean rather than the record keeps a transcript chunk on one run
  // from re-rendering every row's badges.
  const hasFlaggedRun = useRunStore((state) => selectHasFlaggedRun(state.runsById, row));

  // The one loud badge on a row, which is affordable precisely because flags are rare.
  // Acknowledged flags stop showing here: the tree answers "is anything still waiting
  // on me", and the record of what was accepted lives in the run pane.
  const guardrailBadge = hasFlaggedRun ? (
    <Badge
      tone={BADGE_TONE.DANGER}
      title={GUARDRAIL_TITLE}
      icon={<AlertTriangleIcon size={GUARDRAIL_BADGE_ICON_SIZE} />}
    >
      {GUARDRAIL_LABEL}
    </Badge>
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
      {guardrailBadge}
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
function flaggableCommentIdsOf(row: CommentTreeRow): readonly string[] {
  if (row.node.kind === COMMENT_TREE_NODE_KIND.COMMENT) return [row.node.comment.id];
  if (row.isExpanded) return NO_COMMENT_IDS;
  return row.node.descendantCommentIds;
}

function selectHasFlaggedRun(runsById: RunsById, row: CommentTreeRow): boolean {
  return flaggableCommentIdsOf(row).some((commentId) => {
    const run = selectRunForComment(runsById, commentId);
    if (run === null) return false;
    return hasUnacknowledgedFlags(run.guardrailFlags, run.acknowledgedGuardrailIds);
  });
}
