"use client";

import { type RefObject, useEffect, useState } from "react";

import { containSize } from "@/lib/studio/pins";

/** The largest box of the given aspect ratio that fits the element, kept current as it resizes. Sizing in JS keeps the pin layer exactly over the picture. */
export function useFit(frame: RefObject<HTMLElement | null>, aspect: number): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setSize(containSize(aspect, { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frame, aspect]);
  return size;
}
