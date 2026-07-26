import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp } from '@renderer/lib/numbers';

/** Which side of the handle the pane being resized is on. */
export const PANE_EDGE = {
  /** To the left of the handle, so dragging right widens it. */
  LEADING: 'leading',
  /** To the right of the handle, so dragging right narrows it. */
  TRAILING: 'trailing',
} as const;

export type PaneEdge = (typeof PANE_EDGE)[keyof typeof PANE_EDGE];

export interface UsePaneDividerParams {
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
  clientX: number;
  size: number;
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
      dragOriginRef.current = { pointerId: event.pointerId, clientX: event.clientX, size };
      setIsDragging(true);
    },
    [size],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const origin = dragOriginRef.current;
      if (origin === null) return;
      applyDelta(origin.size, event.clientX - origin.clientX);
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
      applyDelta(size, event.key === ARROW_RIGHT_KEY ? step : -step);
    },
    [applyDelta, size],
  );

  return { isDragging, onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}
