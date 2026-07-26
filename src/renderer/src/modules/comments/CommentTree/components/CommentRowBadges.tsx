import { assertNever } from '@renderer/lib/assertNever';
import { Badge, BADGE_TONE } from '@renderer/components/Badge';
import { StateBadge } from '@renderer/components/StateBadge';
import { COMMENT_TREE_NODE_KIND, type CommentTreeRow } from '../commentTreeModel';
import { CommentAttributeBadges } from './CommentAttributeBadges';

export interface CommentRowBadgesProps {
  row: CommentTreeRow;
}

const SINGLE_COMMENT_COUNT = 1;
const SINGLE_COMMENT_TITLE = '1 comment in here';
const COMMENT_COUNT_TITLE_SUFFIX = ' comments in here';

const BADGE_LIST_CLASS = 'flex shrink-0 items-center gap-1';

export function CommentRowBadges({ row }: CommentRowBadgesProps) {
  const stateBadge = (() => {
    if (row.runState === null) return null;
    // An expanded group's children carry their own badges, so rolling up there would
    // double every signal; the roll-up exists to keep a collapsed subtree informative.
    if (row.isExpanded) return null;
    return <StateBadge state={row.runState} />;
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
      {stateBadge}
      {attributeBadges}
    </span>
  );
}

function buildCountTitle(count: number): string {
  if (count === SINGLE_COMMENT_COUNT) return SINGLE_COMMENT_TITLE;
  return `${count}${COMMENT_COUNT_TITLE_SUFFIX}`;
}
