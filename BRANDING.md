# Vectorizer Custom — brand guide

Everything here has a single source in code. Copy and colors live in [`src/brand.ts`](src/brand.ts),
the CSS variables mirror them in [`src/styles/tokens.css`](src/styles/tokens.css), and the mark is
[`src/components/brand/Logo.tsx`](src/components/brand/Logo.tsx) with a standalone copy at
[`public/favicon.svg`](public/favicon.svg). Change a value in both places or they drift.

## Name and voice

| | |
|---|---|
| Name | **Vectorizer Custom** |
| Short | Vectorizer |
| Tagline | raster → SVG · runs in your browser |
| Headline | Turn any image into a clean, scalable vector |

The voice is plain and specific: say what the tool does and where it falls short. The landing page
tells people outright that photos and soft gradients won't vectorize well, and the footer says the
app won't match commercial server-side vectorizers on very detailed art. Keep that honesty — it is
the difference between this product and the marketing copy it competes with.

Write in sentence case. Avoid exclamation marks, "AI-powered", and words like "magic" or
"instantly". Numbers belong in the stats row, not in prose.

## Logo

A cubic Bézier curve with its two anchor points (orange diamonds) and control handles (grey lines
ending in hollow circles) — literally what the Precision engine outputs.

- Minimum size 20 px; below that the handles stop reading and the favicon version should be used.
- Clear space: half the mark's height on every side.
- The mark uses `currentColor`-independent tokens, so it works on `--panel` and `--bg`. Don't place
  it on a mid-tone photo; put it on a solid surface.
- Don't recolor, rotate, add effects to, or stretch it. The curve is the product.

## Color

| Token | Value | Use |
|---|---|---|
| `--accent` | `#2f45d8` | Bézier blue. Primary buttons, curves, focus rings, selection outlines, links |
| `--anchor` | `#f0672a` | Anchor orange. Split divider, warnings, over-limit numbers, the busy spinner |
| `--ink` | `#161a2b` | Body text, segmented-control active fill |
| `--muted` | `#5b6178` | Secondary text, labels, hints |
| `--line` | `#dcdfe8` | Borders and dividers |
| `--bg` | `#f3f4f7` | Page background |
| `--panel` | `#ffffff` | Cards, rail, canvas, dialogs |

Accent and anchor are the only two chromatic colors; everything else is the neutral ramp. They are
never decoration — accent means *interactive*, anchor means *attention or edit point*. The
checkerboard behind artwork is `--check-a` / `--check-b`, not a brand color.

**Light theme only.** There is no dark mode, and `color-scheme: light` is pinned so native controls
stay light under a dark OS setting.

## Type

| Role | Family | Weights |
|---|---|---|
| Display | Poppins | 700 headings, 600 subheads and section titles |
| Body | Poppins | 400 prose, 500 emphasis, 600 labels |
| Mono | IBM Plex Mono | 400/500 — numbers, path data, file names, keycaps |

Both are loaded from Google Fonts with `display=swap`. Poppins is geometric and wide: headings take
tight tracking (`-.02em`) and `text-wrap: balance`. Monospace is reserved for anything a user might
compare digit by digit — stats, dimensions, hex colors, SVG source — which is why it survives the
otherwise single-family type system.

Uppercase is used only for small meta labels (`.label`, format chips) at 11 px with `.08em`
tracking. Never set a heading or a button in all caps.

## Layout and surfaces

- Centred column, `max-width: 1240px`, 20 px gutters.
- Workbench is a 300 px rail beside a fluid stage; it stacks below 860 px.
- Radii: 16 px for cards and dialogs, 12 px for panels and the canvas, 8 px for inputs and buttons,
  999 px only for format chips.
- One shadow token (`--shadow`), used on raised surfaces. Dialogs get a heavier one.
- Dashed borders mean "drop something here" and nothing else.

## Applying it

```tsx
import { BRAND } from "./brand";
<h1>{BRAND.headline}</h1>
```

```css
.thing { color: var(--accent); font-family: var(--f-display); }
```

Never hardcode `#2f45d8` or the product name in a component. If a string shows up in two places,
it belongs in `brand.ts`.
