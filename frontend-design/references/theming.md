# Dual theme (light + dark)

Light and dark are both required. Never treat one as optional.

## Rules

- Semantic tokens only in components (`bg-background`, `text-foreground`, `border-border`, `bg-accent`). No raw `#0A0A0B` in JSX/CSS of UI chrome.
- Implement both palettes in the same pass. Do not “add light later.”
- Default: `system` via `prefers-color-scheme`. Persist `light` | `dark` | `system` in `localStorage`.
- Visible control in the header (Light / Dark / System, or icon toggle that cycles). Label it for screen readers.
- `color-scheme: light` / `color-scheme: dark` on `html` so native scrollbars and form controls match.
- Update `theme-color` meta to the current page background.

## Token pairs

Keep names identical; only values change.

```css
:root {
  color-scheme: light;
  --bg: #fafaf9;
  --surface: #ffffff;
  --text: #18181b;
  --muted: #71717a;
  --border: rgba(0, 0, 0, 0.08);
  --accent: #3f3f46; /* replace with product accent */
  --accent-fg: #fafaf9;
  --shadow:
    0 0 0 1px rgba(0, 0, 0, 0.06),
    0 1px 2px -1px rgba(0, 0, 0, 0.06),
    0 2px 4px 0 rgba(0, 0, 0, 0.04);
}

.dark {
  color-scheme: dark;
  --bg: #0a0a0b;
  --surface: rgba(255, 255, 255, 0.04);
  --text: #f4f4f5;
  --muted: #a1a1aa;
  --border: rgba(255, 255, 255, 0.10);
  --accent: #d4d4d8; /* same hue family, lighter */
  --accent-fg: #0a0a0b;
  --shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
}
```

Override the accent to the product (one family, two lightnesses). Neutrals stay near-neutral.

## Anti-flash (required)

Run before paint so the first frame matches the saved / system theme:

```html
<script>
  (function () {
    var key = "theme";
    var saved = localStorage.getItem(key);
    var dark = saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  })();
</script>
```

Listen to `prefers-color-scheme` changes while preference is `system`.

## Control

- Icon swap: sun ↔ moon with opacity/scale/blur cross-fade (`references/motion.md` / CSS both-icons-in-DOM pattern).
- Hit area ≥ 44px.
- Do not rely on hover to reveal the control.

## Depth by mode

| | Light | Dark |
| --- | --- | --- |
| Cards / buttons | Layered shadow (ring + lift + ambient) | 1px white ring, no drop shadow |
| Dividers | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.10)` |
| Images | `outline: 1px solid rgba(0,0,0,0.10)` inset | `outline: 1px solid rgba(255,255,255,0.10)` inset |
| Overlay / nav | White/80 + blur | Near-black/80 + blur |

## Contrast audit (both modes)

- Body text ≥ 4.5:1 on `bg` and on `surface`.
- Muted text ≥ 4.5:1 if it is readable content; otherwise it is decoration only.
- Primary button: accent vs accent-fg ≥ 4.5:1.
- Focus ring visible on both backgrounds.
- Photos/illustrations: check they are not crushed in dark or washed out in light (use overlays/scrims if needed).

## What not to do

- Invert-filter “dark mode”
- Dark-only landing pages “because it looks premium”
- Light leftover: white cards on dark with unadjusted shadows
- Different accent hues per theme (shifts brand)
- `dark:` utilities with one-off hex that drift from tokens
