import { useLayoutEffect, useMemo, useRef, useState } from 'react';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// How far below the viewport's bottom edge a section may sit and still mount.
const NEAR_MARGIN = 600;

// Below-the-fold sections mount when they come within NEAR_MARGIN of the
// viewport, so the first commit carries only what the first screen paints.
// A section already on screen is mounted in the layout effect — before the
// browser paints — so deferral never causes a flash where the content would
// have been rendered anyway.
//
// The returned ref is a callback ref, not a ref object, so a section that is
// mounted later (another view, a closed fold) is still observed.
export const useNearViewport = (margin = NEAR_MARGIN) => {
  const [node, setNode] = useState(null);
  const [near, setNear] = useState(false);

  useLayoutEffect(() => {
    if (near || !node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    if (node.getBoundingClientRect().top < window.innerHeight + margin) {
      setNear(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: `0px 0px ${margin}px 0px` }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, near, margin]);

  return [setNode, near];
};

// Windowed rows: only the rows a visitor can see (plus a screen of overscan)
// are in the document. The rest of the list is two empty spacers, so heights,
// scroll position and native scrolling stay identical to the full list.
const ROW_ESTIMATE = 48;
const ROW_OVERSCAN = 900;
const ROW_INITIAL = 40;

// Index of the row that contains offset y (offsets is ascending, length count+1).
const rowAt = (offsets, y) => {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
};

export const useWindowedRows = (count, { estimate = ROW_ESTIMATE, overscan = ROW_OVERSCAN, resetKey = '' } = {}) => {
  const [listEl, setListEl] = useState(null);
  const heightsRef = useRef(new Map());
  const [measured, setMeasured] = useState(0);
  const [win, setWin] = useState({ start: 0, end: Math.min(count, ROW_INITIAL) });

  // A different list (other sort, other filter) starts from the estimate again.
  useLayoutEffect(() => {
    heightsRef.current.clear();
    setMeasured((v) => v + 1);
    setWin({ start: 0, end: Math.min(count, ROW_INITIAL) });
  }, [resetKey]);

  const offsets = useMemo(() => {
    const acc = new Float64Array(count + 1);
    for (let i = 0; i < count; i += 1) acc[i + 1] = acc[i] + (heightsRef.current.get(i) ?? estimate);
    return acc;
    // `measured` bumps when a rendered row reports a height that differs.
  }, [count, estimate, measured]);

  useLayoutEffect(() => {
    if (!listEl || count === 0) return undefined;
    let frame = 0;
    // A list can live inside its own scroll region (the desktop history table).
    // Its window then follows that region, not the page.
    const scroller = listEl.closest('[data-scroll-region]');

    const update = () => {
      const scrollTop = scroller ? scroller.scrollTop : window.scrollY;
      const viewH = scroller ? scroller.clientHeight : window.innerHeight;
      const top = scroller
        ? listEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
        : listEl.getBoundingClientRect().top + window.scrollY;
      const from = Math.max(0, scrollTop - top - overscan);
      const to = scrollTop + viewH - top + overscan;
      const start = rowAt(offsets, from);
      const end = Math.min(count, rowAt(offsets, Math.max(from, to)) + 1);
      setWin((w) => (w.start === start && w.end === end ? w : { start, end }));

      let changed = false;
      for (const row of listEl.children) {
        const i = Number(row.dataset.vindex);
        if (!Number.isInteger(i)) continue;
        const h = row.getBoundingClientRect().height;
        if (h > 0 && Math.abs((heightsRef.current.get(i) ?? estimate) - h) > 0.5) {
          heightsRef.current.set(i, h);
          changed = true;
        }
      }
      if (changed) setMeasured((v) => v + 1);
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    update();
    const scrollTarget = scroller || window;
    scrollTarget.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const ro = scroller && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (scroller) ro.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      scrollTarget.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, [listEl, offsets, count, overscan, estimate]);

  const start = Math.min(win.start, count);
  const end = Math.min(win.end, count);
  return {
    setListEl,
    start,
    end,
    padTop: offsets[start] ?? 0,
    padBottom: Math.max(0, (offsets[count] ?? 0) - (offsets[end] ?? 0))
  };
};
