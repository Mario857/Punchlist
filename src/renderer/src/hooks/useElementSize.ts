import { useCallback, useRef, useState, type RefCallback } from 'react';

interface ElementSize {
  width: number;
  height: number;
}

interface UseElementSizeResult<T extends HTMLElement> extends ElementSize {
  ref: RefCallback<T>;
}

const UNMEASURED_SIZE: ElementSize = { width: 0, height: 0 };

/**
 * An element's own size, observed rather than assumed. A ref callback rather than an
 * effect: the observer is attached at the moment the node exists and torn down when it
 * is replaced, which is exactly the lifetime it needs and one React does not have to be
 * told about twice.
 */
export function useElementSize<T extends HTMLElement>(): UseElementSizeResult<T> {
  const [size, setSize] = useState<ElementSize>(UNMEASURED_SIZE);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((element: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (element === null) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(0);
      if (entry === undefined) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  return { ref, ...size };
}
