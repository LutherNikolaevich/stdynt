import { useEffect, useRef, useState } from 'react';
import { createLiquid, stepLiquid, pokeLiquid, isAtRest } from './liquid.js';
import { prefersReducedMotion } from './perf.jsx';

const TAP_STRENGTH = 0.9;
const DRAG_STRENGTH = 6;

// Ask the canvas to resolve a token colour to sRGB. Tokens are authored in
// oklch(), so measuring their digits would read L, C and H as if they were R,
// G and B; painting one pixel gives back the real triplet.
const resolveRgb = (() => {
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  return (cssColor) => {
    if (!ctx) return null;
    ctx.fillStyle = '#ff00ff';
    ctx.fillStyle = cssColor;
    if (ctx.fillStyle === '#ff00ff') return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
})();

const LiquidWell = ({ level }) => {
  const canvasRef = useRef(null);
  const levelRef = useRef(level);
  const wakeRef = useRef(null);
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    levelRef.current = level;
    wakeRef.current?.();
  }, [level]);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const well = canvas?.parentElement;
    if (!well || reduced) return;

    const ctx = canvas.getContext('2d');
    const liquid = createLiquid();
    let visible = true;
    let raf = 0;
    let last = 0;
    // The CSS level has already painted and settled by the time this chunk
    // runs, so start where it is instead of rising from empty a second time.
    let shown = levelRef.current;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let dragX = null;
    let color = '';
    let rgb = [216, 196, 154];

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (shown < 0.001) return;
      const base = height - shown * height;
      const { n, h } = liquid;
      const surface = new Path2D();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * width;
        const y = Math.max(base - h[i] * width + 1, 1);
        if (i === 0) surface.moveTo(x, y);
        else surface.lineTo(x, y);
      }
      const body = new Path2D(surface);
      body.lineTo(width, height);
      body.lineTo(0, height);
      body.closePath();
      const [r, g, b] = rgb;
      const fill = ctx.createLinearGradient(0, base, 0, height);
      fill.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.24)`);
      fill.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.08)`);
      ctx.fillStyle = fill;
      ctx.fill(body);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.35)`;
      ctx.shadowBlur = 10;
      ctx.stroke(surface);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'oklch(96% 0.017 92deg / 30%)';
      ctx.lineWidth = 1;
      ctx.save();
      ctx.translate(0, 1);
      ctx.stroke(surface);
      ctx.restore();
    };

    const frame = (now) => {
      raf = 0;
      const dt = last ? (now - last) / 1000 : 1 / 60;
      last = now;
      const target = levelRef.current;
      shown += (target - shown) * (1 - Math.exp(-dt * 6));
      if (Math.abs(target - shown) < 0.0005) shown = target;
      stepLiquid(liquid, dt);
      draw();
      if (visible && !(shown === target && isAtRest(liquid))) raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (!visible || raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    wakeRef.current = wake;

    const resize = () => {
      width = well.clientWidth;
      height = well.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      color = getComputedStyle(canvas).color;
      rgb = resolveRgb(color) || rgb;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      draw();
    };

    const across = (e) => (e.clientX - well.getBoundingClientRect().left) / (width || 1);

    const onDown = (e) => {
      if (e.button > 0) return;
      dragX = across(e);
      well.classList.add('stirring');
      pokeLiquid(liquid, dragX, TAP_STRENGTH);
      wake();
    };

    const onMove = (e) => {
      if (dragX === null) return;
      const x = across(e);
      pokeLiquid(liquid, x, Math.min(0.5, Math.abs(x - dragX) * DRAG_STRENGTH));
      dragX = x;
      wake();
    };

    const onUp = () => {
      dragX = null;
      well.classList.remove('stirring');
    };

    well.addEventListener('pointerdown', onDown);
    well.addEventListener('pointermove', onMove);
    well.addEventListener('pointerup', onUp);
    well.addEventListener('pointercancel', onUp);
    well.addEventListener('pointerleave', onUp);

    const sizes = new ResizeObserver(resize);
    sizes.observe(well);
    const sight = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
    });
    sight.observe(well);

    well.classList.add('live');
    resize();
    wake();

    return () => {
      cancelAnimationFrame(raf);
      wakeRef.current = null;
      well.removeEventListener('pointerdown', onDown);
      well.removeEventListener('pointermove', onMove);
      well.removeEventListener('pointerup', onUp);
      well.removeEventListener('pointercancel', onUp);
      well.removeEventListener('pointerleave', onUp);
      sizes.disconnect();
      sight.disconnect();
      well.classList.remove('live', 'stirring');
    };
  }, [reduced]);

  return <canvas ref={canvasRef} className="well-liquid" aria-hidden="true" />;
};

export default LiquidWell;
