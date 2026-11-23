# Liquid well: design

## Intent
The well on the day card shows what is left of today's money as a tan fill. Make that fill behave like a liquid that responds to how the phone is held: it stays level with the ground when the phone tilts and sloshes when it moves.

## Goals
- The surface slopes with the phone's tilt and sloshes, then settles.
- The volume always equals the money left (`--level`), so spending still drains it.
- Same look as today: tan tint, 2px tan surface line, no line in debt.

## Non-goals
- The month bar and other progress bars stay as they are.
- No particle fluid, no splashes or droplets.

## Anti-goals
- Battery drain: the loop must stop when the liquid is at rest, the tab is hidden, or the well is off screen.
- Any regression for desktop, reduced motion, or a declined permission: those keep today's flat level.

## Constraints
- iOS gives tilt data only after a tap and a system prompt, over HTTPS.
- CSP is `script-src 'self'; style-src 'self'`: no inline styles or scripts beyond CSSOM.
- No new dependencies.

## Approaches
1. **Canvas with a spring-column surface (picked).** A row of columns linked by springs; tilt sets the target slope, movement adds slosh. Cheap, looks like liquid, volume is easy to conserve.
2. **Particle fluid.** Most realistic, but too costly for a card opened many times a day.
3. **CSS-only rotate of the fill.** Simple, but cannot slosh or settle.

## Design
- A `<canvas>` inside `.well` replaces the `::before` tint and `::after` line when active; the pseudo-elements remain as the fallback.
- Physics lives in a pure module (`src/liquid.js`) so it can be tested with `node --test`.
- A `LiquidWell` component in `src/App.jsx` owns the canvas, the sensor listeners and the animation loop.
- First tap on the well asks for motion permission on iOS (my call, not requested by the owner). Declined or unsupported: flat level, as today.
- Reduced motion: no canvas, no listeners.
- `DESIGN.md` gains a line describing the liquid.

## Left to the builder
Spring constants, column count, maximum slope, and how the loop detects rest.

## Revision, 2026-11-15
The owner asked for the liquid to move where it is touched, not with the phone's tilt. Tilt, shake and the iOS motion permission are removed. A tap dents the surface under the finger and ripples spread from there; a sideways drag stirs it. Vertical drags still scroll the page. Reduced motion keeps the flat level.
