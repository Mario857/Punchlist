import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp } from '@renderer/lib/numbers';

/** Which side of the handle the pane being resized is on. */
export const PANE_EDGE = {
  /** The pane is to the left, so dragging right widens it. */
  LEADING: 'leading',
  /** The pane is to the right, so dragging right narrows it. */
  TRAILING: 'trailing',
} as const;

export type PaneEdge = (typeof PANE_EDGE)[keyof typeof PANE_EDGE];

export interface UsePaneDividerParams {
  edge: PaneEdge;
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
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
  clientX: number;
  width: number;
}

const ARROW_LEFT_KEY = 'ArrowLeft';
const ARROW_RIGHT_KEY = 'ArrowRight';
const KEYBOARD_STEP = 16;
/** Shift is the accelerator, so crossing a wide monitor is not forty keypresses. */
const KEYBOARD_COARSE_STEP = 64;

/**
 * A drag is measured from where it started rather than accumulated per move event, so
 * a pointer that runs past the clamp and comes back tracks the cursor again instead of
 * having quietly drifted out of step with it.
 */
export function usePaneDivider({
  edge,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
}: UsePaneDividerParams): UsePaneDividerResult {
  const dragOriginRef = useRef<DragOrigin | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const applyDelta = useCallback(
    (startWidth: number, delta: number) => {
      const signedDelta = edge === PANE_EDGE.LEADING ? delta : -delta;
      onWidthChange(clamp(startWidth + signedDelta, minWidth, maxWidth));
    },
    [edge, minWidth, maxWidth, onWidthChange],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      // Without this the drag selects the text of whichever pane it passes over.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragOriginRef.current = { pointerId: event.pointerId, clientX: event.clientX, width };
      setIsDragging(true);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const origin = dragOriginRef.current;
      if (origin === null) return;
      applyDelta(origin.width, event.clientX - origin.clientX);
    },
    [applyDelta],
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
      if (event.key !== ARROW_LEFT_KEY && event.key !== ARROW_RIGHT_KEY) return;
      event.preventDefault();
      const step = event.shiftKey ? KEYBOARD_COARSE_STEP : KEYBOARD_STEP;
      applyDelta(width, event.key === ARROW_RIGHT_KEY ? step : -step);
    },
    [applyDelta, width],
  );

  return { isDragging, onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}
