import { joinClassNames } from '@renderer/lib/classNames';
import {
  usePaneDivider,
  type PaneEdge,
} from '@renderer/screens/Workspace/components/PaneDivider/usePaneDivider';

export interface PaneDividerProps {
  /** Names the pane being resized, since a bare separator says nothing aloud. */
  label: string;
  edge: PaneEdge;
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
}

/** Reachable by Tab, because a mouse-only affordance is not an affordance for everyone. */
const DIVIDER_TAB_INDEX = 0;

const DIVIDER_CLASS = joinClassNames(
  'bg-border w-1 shrink-0 cursor-col-resize touch-none',
  'transition-colors hover:bg-border-strong focus-visible:bg-focus focus-visible:outline-none',
);
const DRAGGING_CLASS = 'bg-accent';

/**
 * The window-splitter pattern: a focusable `separator` that arrow keys move, so the
 * layout is adjustable without a pointer.
 */
export function PaneDivider({
  label,
  edge,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
}: PaneDividerProps) {
  const { isDragging, onPointerDown, onPointerMove, onPointerUp, onKeyDown } = usePaneDivider({
    edge,
    width,
    minWidth,
    maxWidth,
    onWidthChange,
  });

  const className = isDragging ? joinClassNames(DIVIDER_CLASS, DRAGGING_CLASS) : DIVIDER_CLASS;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
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
