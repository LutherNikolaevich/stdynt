
const STIFFNESS = 60;
const COUPLING = 150;
const DAMPING = 3.5;
const SUBSTEP = 1 / 120;
const MAX_FRAME = 1 / 30;
const POKE_WIDTH = 0.06;

export const createLiquid = (n = 40) => ({
  n,
  h: new Float64Array(n),
  v: new Float64Array(n),
  push: Infinity
});

const removeMean = (h) => {
  let sum = 0;
  for (let i = 0; i < h.length; i++) sum += h[i];
  const mean = sum / h.length;
  for (let i = 0; i < h.length; i++) h[i] -= mean;
};

export const stepLiquid = (state, dt) => {
  const { n, h, v } = state;
  let left = Math.min(Math.max(dt, 0), MAX_FRAME);
  while (left > 1e-6) {
    const step = Math.min(SUBSTEP, left);
    left -= step;
    let push = 0;
    for (let i = 0; i < n; i++) {
      const prev = h[i > 0 ? i - 1 : i];
      const next = h[i < n - 1 ? i + 1 : i];
      const a = -STIFFNESS * h[i] + COUPLING * (prev + next - 2 * h[i]) - DAMPING * v[i];
      v[i] += a * step;
      push = Math.max(push, Math.abs(a));
    }
    for (let i = 0; i < n; i++) h[i] += v[i] * step;
    removeMean(h);
    state.push = push;
  }
};

export const pokeLiquid = (state, x, strength) => {
  if (!Number.isFinite(x) || !Number.isFinite(strength)) return;
  const { n, v } = state;
  for (let i = 0; i < n; i++) {
    const d = ((i + 0.5) / n - x) / POKE_WIDTH;
    v[i] -= strength * Math.exp(-d * d);
  }
  let sum = 0;
  for (let i = 0; i < n; i++) sum += v[i];
  for (let i = 0; i < n; i++) v[i] -= sum / n;
  state.push = Infinity;
};

export const isAtRest = (state) => {
  if (state.push > 0.01) return false;
  for (let i = 0; i < state.n; i++) if (Math.abs(state.v[i]) > 0.001 || Math.abs(state.h[i]) > 0.0005) return false;
  return true;
};
