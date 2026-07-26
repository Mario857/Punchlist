import { joinClassNames } from '@renderer/lib/classNames';
import {
  PANE_AXIS,
  usePaneDivider,
  type PaneAxis,
  type PaneEdge,
} from '@renderer/screens/Workspace/components/PaneDivider/usePaneDivider';

export interface PaneDividerProps {
  /** Names the pane being resized, since a bare separator says nothing aloud. */
  label: string;
  axis: PaneAxis;
  edge: PaneEdge;
  size: number;
  minSize: number;
  maxSize: number;
  onSizeChange: (size: number) => void;
}

/** Reachable by Tab, because a mouse-only affordance is not an affordance for everyone. */
const DIVIDER_TAB_INDEX = 0;

const DIVIDER_CLASS = joinClassNames(
  'bg-border shrink-0 touch-none',
  'transition-colors hover:bg-border-strong focus-visible:bg-focus focus-visible:outline-none',
);
const HORIZONTAL_AXIS_CLASS = 'w-1 cursor-col-resize';
const VERTICAL_AXIS_CLASS = 'h-1 cursor-row-resize';
const DRAGGING_CLASS = 'bg-accent';

/**
 * The separator's own orientation is perpendicular to the axis it drags along: a
 * divider between two columns is a vertical bar. ARIA names the bar, not the motion.
 */
const ARIA_ORIENTATION: Record<PaneAxis, 'horizontal' | 'vertical'> = {
  [PANE_AXIS.HORIZONTAL]: 'vertical',
  [PANE_AXIS.VERTICAL]: 'horizontal',
};

/**
 * The window-splitter pattern: a focusable `separator` that arrow keys move, so the
 * layout is adjustable without a pointer.
 */
export function PaneDivider({
  label,
  axis,
  edge,
  size,
  minSize,
  maxSize,
  onSizeChange,
}: PaneDividerProps) {
  const { isDragging, onPointerDown, onPointerMove, onPointerUp, onKeyDown } = usePaneDivider({
    axis,
    edge,
    size,
    minSize,
    maxSize,
    onSizeChange,
  });

  const axisClass = axis === PANE_AXIS.HORIZONTAL ? HORIZONTAL_AXIS_CLASS : VERTICAL_AXIS_CLASS;
  const className = joinClassNames(DIVIDER_CLASS, axisClass, isDragging && DRAGGING_CLASS);

  return (
    <div
      role="separator"
      aria-orientation={ARIA_ORIENTATION[axis]}
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
