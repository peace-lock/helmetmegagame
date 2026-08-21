# CRT terminal — a parked visual direction

**Status: not implemented, and deliberately not on any branch.** This is a
design option written down so it survives, not a description of the app. The
app currently ships "Ravenheart Underground" — see `ARCHITECTURE.md` §7 and the
token block at the top of `web/app/globals.css`.

## Why this file exists

The CRT idea has now been half-built and half-deleted twice, and each time the
reasoning went with it:

1. An early build had the full treatment — an animated SVG warp filter
   (`feTurbulence` + `feDisplacementMap`), 40s/26s infinite gradient-drift
   animations on `.crt-screen`/`.crt-heading`, and a flicker-animated scanline
   overlay. It was removed wholesale (`ARCHITECTURE.md` §7) as too slow and too
   much flavour, against the explicit "must feel fast, not laggy" constraint.
2. What survived was `.scanlines`: a 1px `repeating-linear-gradient` at **0.06
   opacity**, i.e. not actually visible on any display, still paying for a
   full-viewport composited layer. The Ravenheart pass deleted it and replaced
   it with the grain + vignette layers now in `globals.css`.

So the honest summary is: the *loud* version was rejected on performance, and
the *timid* version was invisible. Neither outcome tells you the middle version
is a bad idea — nobody has built it. If it gets picked up again, start here
rather than rediscovering the above.

## What the direction actually is

A CRT terminal look is not the scanlines. Scanlines are the cheapest and least
convincing part of it, which is why both previous attempts reached for them
first and neither landed. The things that actually read as a phosphor terminal,
roughly in order of payoff per unit of risk:

| Element | What it means | Cost |
|---|---|---|
| **Monochrome phosphor palette** | One hue, several intensities — amber or green — instead of a full colour system. Text, borders and fills are all the same hue at different luminance. | Token-only |
| **Text glow** | A tight `text-shadow` in the phosphor hue on headings and active elements. Sells "emissive" more than any overlay. | Cheap, static |
| **Mono everywhere** | The face carries most of the impression on its own. | Free, but see below |
| **Block cursor / caret** | A solid block caret on inputs, optionally blinking. | Cheap |
| **Scanlines** | The horizontal line texture. | Cheap, weak on its own |
| **Bloom / halation** | A soft outer glow bleeding past bright elements. | Needs a blurred duplicate layer |
| **Barrel distortion** | Screen curvature. This is the one that actually looks like a CRT — and the one that cost the most last time. | Expensive |

The first four together get most of the effect for almost nothing. The last two
are where the previous implementation died.

## What it would touch

Almost entirely `web/app/globals.css`, because the token discipline holds: there
is exactly one hardcoded colour left in the app (now none — the old `#9a9a9a`
avatar placeholder was fixed during the Ravenheart pass) and shared classes
cover the surface area (`.field`×156, `.btn`×73, `.panel`×68).

Concretely:

- **A fourth theme block.** `[data-theme="crt"]` alongside dusk/dawn/limestone.
  It needs the same token set — including the `--accent` / `--accent-text`
  split, which matters *more* in a monochrome palette, not less: with only one
  hue to spend, the legible-text value and the fill value diverge further apart
  than they do in a two-colour scheme.
- **`web/lib/turnFormat.js`.** Add `"crt"` to `THEMES`. It should not be
  reachable from `themeForPhase` — like limestone, it is an override theme, set
  via `LIFEWEB_THEME=crt` (see `web/app/layout.js`).
- **The atmosphere layers.** `.grain` and `.vignette` in `globals.css` are the
  seam to work at. A CRT variant swaps grain for scanlines and turns the
  vignette up; both are already single fixed `pointer-events: none` layers at
  `z-index: 0`, so nothing structural has to move.
- **Fonts.** `--font-mono` (IBM Plex Mono) is still loaded and is now scoped to
  data via `.mono`. A CRT theme would re-promote it to the body face — one rule
  in `body`, since Ravenheart made that a token rather than a hardcoded stack.

## Constraints any attempt has to meet

These are the reasons the first version was deleted, so treat them as the
acceptance criteria rather than as advice:

- **No `backdrop-filter`, anywhere.** It is the single most expensive thing you
  can put over a scrolling list, and `/gm/turns` is a long table by design.
- **No per-frame animation.** The 40s gradient drift and the flicker overlay
  both animated forever, on every page, whether or not anything was happening.
  A blink on a single focused caret is fine; a full-viewport animated layer is
  not.
- **The long table is the benchmark.** `/gm/turns` with `.table-scroll` is the
  worst case. If scrolling it is not smooth with the effect composited, the
  effect is wrong — this is what CLAUDE.md means by "must not feel like a
  laggy Discord bot dashboard".
- **Contrast still gates.** `npm run audit:contrast --workspace=web` parses the
  theme blocks straight out of `globals.css`, so a new `[data-theme="crt"]`
  block is picked up automatically and has to clear the same AA thresholds. A
  monochrome palette is where this is easiest to get wrong: it is very easy to
  build something that looks like a terminal and fails every text ratio.

## How to try it

Because themes are pure token blocks plus an override env var, this needs no
branch to experiment with:

1. Add a `[data-theme="crt"]` block to `web/app/globals.css`.
2. Add `"crt"` to `THEMES` in `web/lib/turnFormat.js`.
3. Set `LIFEWEB_THEME=crt` in `.env` and run `npm run dev:web`.
4. Run `npm run audit:contrast --workspace=web` before deciding you like it.

If it turns out well it can graduate to a real option; if not, deleting the
theme block is the whole revert.
