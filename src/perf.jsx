import { useLayoutEffect, useState } from 'react';

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
