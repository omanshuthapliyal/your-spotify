import { useCallback, useRef, useState } from 'react';

/** Tracks an element's content width. Uses a callback ref so it works for elements mounted later. */
export function useWidth<T extends HTMLElement>(initial = 900) {
  const [width, setWidth] = useState(initial);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    setWidth(el.clientWidth);
    ro.current = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.current.observe(el);
  }, []);
  return [ref, width] as const;
}
