# Liquid Well Implementation Plan

> **Superseded, 2026-11-15.** This plan describes the tilt version (`deviceorientation`, `devicemotion`, the iOS motion permission, the `stdynt-tilt` key, `slopeFromTilt`, `MAX_SLOPE`). The owner asked for the liquid to respond to touch instead, and all of that was removed. What was built: `src/liquid.js` exports `createLiquid`, `stepLiquid(state, dt)`, `pokeLiquid` and `isAtRest(state)`; `LiquidWell` handles pointer events (a tap dents the surface, a sideways drag stirs it). See the "Revision, 2026-11-15" section of the spec. The tasks below are kept as history and are not to be followed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The tan fill in the day card's well tilts and sloshes like a liquid as the phone moves.

**Architecture:** A pure physics module (`src/liquid.js`) models the surface as spring-linked columns pulled toward a slope set by the phone's tilt. A `LiquidWell` component in `src/App.jsx` draws it on a canvas inside `.well` and takes over from the CSS pseudo-elements only once real tilt data arrives.

**Tech Stack:** React 19, Canvas 2D, `deviceorientation` / `devicemotion`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-15-liquid-well-design.md`

## Global Constraints

- No new dependencies.
- CSP `style-src 'self'`: no `<style>` tags or style attributes in markup; CSSOM and canvas only.
- Reduced motion, no sensor, or declined permission: the well looks exactly as it does today.
- The project is not a git repository: no commit steps.

## Review Focus

- Phone lying flat on a table: the surface is level, not pinned to one side. (Task 1 test)
- Tilt values that are null or NaN (desktop Chrome fires one such event): the well stays in CSS mode. (Task 1 test for `slopeFromTilt`, Task 2 guard)
- Level 0 or debt: nothing is drawn, no stray surface line. (Task 2 check)
- Long frame gap after the tab was hidden: the simulation does not blow up. (Task 1 test)
- Phone held still in the hand: sensor noise does not keep the loop running forever. (Task 2 threshold)

---

### Task 1: Physics module

**Files:**
- Create: `src/liquid.js`
- Test: `test/liquid.test.js`

**Interfaces:**
- Produces:
  - `MAX_SLOPE = 0.35`
  - `createLiquid(n = 40) -> { n, h: Float64Array, v: Float64Array }`: `h` is each column's surface offset from the mean, as a fraction of the well's width.
  - `stepLiquid(state, slope, dt) -> void`: advances by `dt` seconds (clamped to 1/30, sub-stepped at 1/120). Each column is sprung toward `slope * (x - 0.5)`, coupled to its neighbours, damped, and the mean of `h` is removed so volume is conserved.
  - `isAtRest(state, slope) -> boolean`
  - `slopeFromTilt(beta, gamma) -> number | null`: degrees in, slope out, clamped to ±`MAX_SLOPE`; `null` for non-finite input. Down in screen axes is `dx = cos β · sin γ`, `dy = -sin β`; slope is `dx / max(-dy, 0.35)`.

- [ ] **Step 1: Write failing tests** in `test/liquid.test.js`:
  - `settles to the tilt`: after 5 s of steps at slope 0.2, right-most `h` minus left-most `h` is within 0.02 of `0.2 * (n-1)/n`, and `isAtRest` is true.
  - `sloshes past level`: starting settled at 0.3, stepping at slope 0, the right-most `h` goes negative before it settles.
  - `conserves volume`: the mean of `h` stays below 1e-9 in magnitude throughout.
  - `survives a long frame`: `stepLiquid(state, 0.35, 5)` leaves every `h` finite and within ±1.
  - `slopeFromTilt`: upright (90, 0) is 0; flat (0, 0) is 0; (90, 20) is positive; (90, -20) is negative; (10, 80) equals `MAX_SLOPE`; `(null, null)` and `(NaN, 0)` are `null`.
- [ ] **Step 2:** Run `npm test`; the new file fails on the missing module.
- [ ] **Step 3:** Implement `src/liquid.js`.
- [ ] **Step 4:** Run `npm test`; everything passes.

### Task 2: Canvas, sensors and styles

**Files:**
- Modify: `src/App.jsx` (new `LiquidWell` component near `useTweened`; rendered inside `.well` at line ~2603)
- Modify: `src/index.css` (after `.well.debt::after`, line ~418)
- Modify: `DESIGN.md` (intro paragraph and Motion list)

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: `<LiquidWell level={number} />`, rendered as the first child of `.well` when `hasDaily`. It renders `<canvas className="well-liquid" aria-hidden="true" />` and toggles the class `live` on its parent `.well`.

- [ ] **Step 1: `LiquidWell`.**
  - Does nothing under `prefersReducedMotion()`.
  - Listens to `deviceorientation`. The first event with a non-null slope adds `live` to the well and starts the loop. Where `DeviceOrientationEvent.requestPermission` exists, listeners are attached only after it resolves `'granted'`: it is called on the first click on the well, and, if `localStorage['stdynt-tilt'] === '1'` from an earlier grant, on the first `pointerup` anywhere.
  - Listens to `devicemotion` and adds `acceleration.x * 0.04` to the slope for that frame, so a sideways shake sloshes.
  - Loop: eases the drawn level toward `level` (starting from 0 when it goes live within 150 ms of mount, else from `level`), calls `stepLiquid`, draws. It stops when `isAtRest` and the level has arrived, and restarts when the slope moves by more than 0.004, `level` changes, or the well re-enters the viewport (IntersectionObserver pauses it off screen).
  - Draw: canvas covers the whole well, sized by ResizeObserver at `min(devicePixelRatio, 2)`. Surface y at column x is `H - level * (H - 56) - h * W`. Fill below it in the canvas's computed `color` at alpha 0.13; stroke the surface 2px at full alpha. Draw nothing when the drawn level is below 0.001.
- [ ] **Step 2: CSS.** `.well-liquid { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; color: var(--sun); pointer-events: none; display: none; }`, `.well.live .well-liquid { display: block; }`, `.well.live::before, .well.live::after { display: none; }`.
- [ ] **Step 3: DESIGN.md.** One sentence in the intro and one Motion bullet: with tilt data the level is a liquid that stays level with the ground and sloshes; without it, or with reduced motion, it is the flat level.
- [ ] **Step 4: Verify.** `npm test` and `npm run build` pass. In the dev server at phone width, dispatching `new DeviceOrientationEvent('deviceorientation', { beta: 80, gamma: 25 })` on `window` makes the well go live with a sloped surface; with no event the well is unchanged; with `beta: null` it stays unchanged.
