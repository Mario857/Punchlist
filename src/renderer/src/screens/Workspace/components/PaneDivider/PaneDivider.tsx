import { joinClassNames } from '@renderer/lib/classNames';
import {
  usePaneDivider,
  type PaneEdge,
} from '@renderer/screens/Workspace/components/PaneDivider/usePaneDivider';

export interface PaneDividerProps {
  /** Names the pane being resized, since a bare separator says nothing aloud. */
  label: string;
  edge: PaneEdge;
  size: number;
  minSize: number;
  maxSize: number;
  onSizeChange: (size: number) => void;
}

/** Reachable by Tab, because a mouse-only affordance is not an affordance for everyone. */
const DIVIDER_TAB_INDEX = 0;

const DIVIDER_CLASS = joinClassNames(
  'bg-border w-1 shrink-0 cursor-col-resize touch-none',
  'transition-colors hover:bg-border-strong focus-visible:bg-focus focus-visible:outline-none',
);
const DRAGGING_CLASS = 'bg-accent';
/** The bar itself is vertical, even though the drag it takes moves horizontally. */
const ARIA_ORIENTATION = 'vertical';

/**
 * The window-splitter pattern: a focusable `separator` that arrow keys move, so the
 * layout is adjustable without a pointer.
 */
export function PaneDivider({
  label,
  edge,
  size,
  minSize,
  maxSize,
  onSizeChange,
}: PaneDividerProps) {
  const { isDragging, onPointerDown, onPointerMove, onPointerUp, onKeyDown } = usePaneDivider({
    edge,
    size,
    minSize,
    maxSize,
    onSizeChange,
  });

  const className = joinClassNames(DIVIDER_CLASS, isDragging && DRAGGING_CLASS);

  return (
    <div
      role="separator"
      aria-orientation={ARIA_ORIENTATION}
      aria-label={label}
      aria-valuenow={size}
      aria-valuemin={minSize}
      aria-valuemax={maxSize}
      tabIndex={DIVIDER_TAB_INDEX}
      className={className}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
