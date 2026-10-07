"use client";

import { type RefObject, useEffect, useState } from "react";

import { containSize } from "@/lib/studio/pins";

/** Space to keep clear around the work, for the controls that float over it. */
export type Inset = { t: number; r: number; b: number; l: number };

const NONE: Inset = { t: 0, r: 0, b: 0, l: 0 };

/**
 * The largest box of the given aspect ratio that fits the element less `inset`, kept current as it
 * resizes, with the offset that centres it in the space left. Sizing in JS keeps the pin layer
 * exactly over the picture. `inset` may depend on the element's width (smaller on a phone).
 */
export function useFit(frame: RefObject<HTMLElement | null>, aspect: number, inset: (w: number) => Inset = () => NONE): { w: number; h: number; dx: number; dy: number } {
  const [size, setSize] = useState({ w: 0, h: 0, dx: 0, dy: 0 });
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      const i = inset(el.clientWidth);
      const box = containSize(aspect, { w: Math.max(0, el.clientWidth - i.l - i.r), h: Math.max(0, el.clientHeight - i.t - i.b) });
      setSize({ ...box, dx: (i.l - i.r) / 2, dy: (i.t - i.b) / 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, aspect]);
  return size;
}
