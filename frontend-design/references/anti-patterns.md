# Anti-patterns to avoid

These produce the generic "AI-generated" look. Reject them.

## Visual

- Centered everything with identical card grids
- Purple/indigo gradient buttons on every primary action
- Soft pastel backgrounds with no contrast hierarchy
- Excessive border-radius (20px+) on every surface
- Drop shadows that look like Bootstrap defaults
- Decorative SVG blobs or abstract shapes with no purpose
- Stock-illustration style icons that don't match the product

## Theme

- Shipping only dark (or only light)
- Invert-filter or brightness hack instead of a second palette
- Light-mode shadows copied onto dark surfaces
- Hardcoded hex in components instead of semantic tokens
- No theme control, or a control that does not persist
- Flash of the wrong theme on load
- Contrast that passes in one mode and fails in the other

## Typography

- Single system font for everything (especially Inter alone with no scale)
- Headings with positive or zero letter-spacing
- Body text wider than 75ch or cramped under 50ch
- Inconsistent heading sizes that ignore modular scale

## Layout

- Every section max-width and centered with the same padding
- No visual tension or asymmetry
- Equal-height card rows that force awkward content
- Hero that is just a big centered headline + two buttons

## Interaction

- No hover/focus states, or only color change
- Instant transitions or overly long (500ms+) animations
- Hover-dependent interactions on mobile without touch alternatives

## Content

- Lorem ipsum or "Feature title goes here"
- Placeholder images without real crop or treatment
- Generic feature lists that could belong to any product

## Fix approach

When you catch one of these, replace with a deliberate alternative from the main skill: editorial split, real copy, disciplined palette, dual light/dark tokens, signature detail, proper type scale.
