# Advanced Motion Design

## Timing & easing

- Duration: micro 100–150ms, UI 150–250ms, complex 300–400ms. Longer feels sluggish.
- Easing curves:
  - Standard: `cubic-bezier(0.4, 0, 0.2, 1)`
  - Expressive exit: `cubic-bezier(0.16, 1, 0.3, 1)`
  - Subtle overshoot: `cubic-bezier(0.34, 1.56, 0.64, 1)`
- Stagger siblings 30–80ms. Never uniform delays >100ms.
- Exit animations ~20–30% faster than entrances.

## Physics & continuity

- Shared-element transitions (FLIP) preserve spatial continuity.
- Momentum: exits feel like continued motion, not abrupt stop.
- Mass: heavier elements slower; lighter (icons, labels) snap faster.
- Overshoot sparingly — only deliberate delight moments.

## Hierarchy of motion

1. Primary action (button press, modal open)
2. Secondary feedback (hover lift, focus ring)
3. Ambient / decorative (parallax, subtle float)

Never animate more than 2–3 independent systems at once.

## Practical rules

- Animate only `transform` + `opacity` (GPU-friendly). Avoid layout properties.
- Respect `prefers-reduced-motion: reduce` — instant or opacity-only.
- Motion must reinforce hierarchy. If it doesn’t clarify state or relationship, remove it.

## Signature techniques

- Parallax layers at different speeds for depth
- Morphing between related shapes (icon → expanded)
- Orchestrated sequences (parent → children cascade)
- Gesture-driven (drag, swipe) with spring physics

## Spring physics parameters

Spring = mass + stiffness + damping. Force pulls toward target; damping removes energy.

| Param | Meaning | Typical range | Effect |
|-------|---------|---------------|--------|
| stiffness (k) | Spring strength | 100–500 | Higher = snappier, faster settle |
| damping | Friction / energy loss | 10–40 | Higher = less bounce, more controlled |
| mass | Inertia | 0.5–2 | Higher = slower, more weighty |
| velocity | Initial speed | 0 (default) | Non-zero for momentum handoff |

### Presets

- Snappy UI (buttons, toggles): stiffness 400–500, damping 25–30, mass 1
- Gentle / modal: stiffness 200–300, damping 20–25
- Bouncy delight: stiffness 300–400, damping 12–18 (under-damped)
- Heavy / page: stiffness 100–150, damping 20, mass 1.5–2

### Damping ratio (ζ)

- ζ < 1 → under-damped (overshoot + oscillation)
- ζ = 1 → critically damped (fastest settle, no bounce)
- ζ > 1 → over-damped (sluggish)

Most UI aims near critically damped or lightly under-damped.

### Library mapping

- Framer Motion / Motion: `type: "spring", stiffness, damping, mass`
- React Spring: `config: { tension, friction, mass }` (tension ≈ stiffness)
- CSS: approximate with cubic-bezier or keyframes

Use stiffness + damping first; add mass only for intentional weight.
