import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp } from '@renderer/lib/numbers';

/** Which side of the handle the pane being resized is on. */
export const PANE_EDGE = {
  /** Above or to the left of the handle, so dragging away from the origin widens it. */
  LEADING: 'leading',
  /** Below or to the right, so dragging away from the origin narrows it. */
  TRAILING: 'trailing',
} as const;

export type PaneEdge = (typeof PANE_EDGE)[keyof typeof PANE_EDGE];

/** The axis the drag moves along, which is perpendicular to the divider itself. */
export const PANE_AXIS = {
  HORIZONTAL: 'horizontal',
  VERTICAL: 'vertical',
} as const;

export type PaneAxis = (typeof PANE_AXIS)[keyof typeof PANE_AXIS];

export interface UsePaneDividerParams {
  axis: PaneAxis;
  edge: PaneEdge;
  size: number;
  minSize: number;
  maxSize: number;
  onSizeChange: (size: number) => void;
}

interface UsePaneDividerResult {
  isDragging: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

interface DragOrigin {
  pointerId: number;
  position: number;
  size: number;
}

const ARROW_LEFT_KEY = 'ArrowLeft';
const ARROW_RIGHT_KEY = 'ArrowRight';
const ARROW_UP_KEY = 'ArrowUp';
const ARROW_DOWN_KEY = 'ArrowDown';
const KEYBOARD_STEP = 16;
/** Shift is the accelerator, so crossing a wide monitor is not forty keypresses. */
const KEYBOARD_COARSE_STEP = 64;

/** The pointer coordinate that matters; the other one is noise for this drag. */
function toPointerPosition(event: PointerEvent<HTMLDivElement>, axis: PaneAxis): number {
  return axis === PANE_AXIS.HORIZONTAL ? event.clientX : event.clientY;
}

/** The key that grows the pane, whichever axis it lives on. */
function toGrowKey(axis: PaneAxis): string {
  return axis === PANE_AXIS.HORIZONTAL ? ARROW_RIGHT_KEY : ARROW_DOWN_KEY;
}

function toShrinkKey(axis: PaneAxis): string {
  return axis === PANE_AXIS.HORIZONTAL ? ARROW_LEFT_KEY : ARROW_UP_KEY;
}

/**
 * A drag is measured from where it started rather than accumulated per move event, so
 * a pointer that runs past the clamp and comes back tracks the cursor again instead of
 * having quietly drifted out of step with it.
 */
export function usePaneDivider({
  axis,
  edge,
  size,
  minSize,
  maxSize,
  onSizeChange,
}: UsePaneDividerParams): UsePaneDividerResult {
  const dragOriginRef = useRef<DragOrigin | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const applyDelta = useCallback(
    (startSize: number, delta: number) => {
      const signedDelta = edge === PANE_EDGE.LEADING ? delta : -delta;
      onSizeChange(clamp(startSize + signedDelta, minSize, maxSize));
    },
    [edge, minSize, maxSize, onSizeChange],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      // Without this the drag selects the text of whichever pane it passes over.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragOriginRef.current = {
        pointerId: event.pointerId,
        position: toPointerPosition(event, axis),
        size,
      };
      setIsDragging(true);
    },
    [axis, size],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const origin = dragOriginRef.current;
      if (origin === null) return;
      applyDelta(origin.size, toPointerPosition(event, axis) - origin.position);
    },
    [applyDelta, axis],
  );

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current;
    if (origin === null) return;
    event.currentTarget.releasePointerCapture(origin.pointerId);
    dragOriginRef.current = null;
    setIsDragging(false);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const growKey = toGrowKey(axis);
      const shrinkKey = toShrinkKey(axis);
      if (event.key !== growKey && event.key !== shrinkKey) return;
      event.preventDefault();
      const step = event.shiftKey ? KEYBOARD_COARSE_STEP : KEYBOARD_STEP;
      applyDelta(size, event.key === growKey ? step : -step);
    },
    [applyDelta, axis, size],
  );

  return { isDragging, onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}
