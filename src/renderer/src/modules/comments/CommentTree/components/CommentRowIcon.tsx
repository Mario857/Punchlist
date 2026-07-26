import { assertNever } from '@renderer/lib/assertNever';
import { FileIcon } from '@renderer/components/icons/FileIcon';
import { FolderIcon } from '@renderer/components/icons/FolderIcon';
import { COMMENT_TREE_NODE_KIND, type CommentTreeNodeKind } from '../commentTreeModel';

export interface CommentRowIconProps {
  kind: CommentTreeNodeKind;
}

/** Below the 16px icon default: the glyph sits between a checkbox and small text. */
const ROW_ICON_SIZE = 13;

const ROW_ICON_CLASS = 'shrink-0 text-muted';

export function CommentRowIcon({ kind }: CommentRowIconProps) {
  const icon = (() => {
    switch (kind) {
      case COMMENT_TREE_NODE_KIND.PR_CONVERSATION:
      case COMMENT_TREE_NODE_KIND.DIRECTORY:
        return <FolderIcon size={ROW_ICON_SIZE} className={ROW_ICON_CLASS} />;
      case COMMENT_TREE_NODE_KIND.FILE:
        return <FileIcon size={ROW_ICON_SIZE} className={ROW_ICON_CLASS} />;
      case COMMENT_TREE_NODE_KIND.COMMENT:
        // A comment row is already identified by its author and its text, so a glyph
        // would only add a mark to scan past.
        return null;
      default:
        return assertNever(kind);
    }
  })();

  return icon;
}
