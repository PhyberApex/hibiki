---
name: Hibiki site
description: The GitHub Pages site for Hibiki, drawn as one battle map with sound sources as glowing radii.
colors:
  ink-0: "#0d0e13"
  ink-1: "#14151c"
  ink-2: "#1b1c25"
  ink-3: "#242530"
  text: "#f3efe6"
  muted: "#c9c1b3"
  dim: "#978f81"
  line: "rgba(243, 239, 230, 0.10)"
  line-strong: "rgba(243, 239, 230, 0.18)"
  grid: "rgba(243, 239, 230, 0.045)"
  grid-major: "rgba(243, 239, 230, 0.075)"
  music: "#f59e0b"
  music-bright: "#ffb21f"
  on-music: "#1a1206"
  lamp: "rgba(245, 158, 11, 0.16)"
  plate: "rgba(20, 21, 28, 0.94)"
  ambience: "#2dd4bf"
  effects: "#fb7185"
  code: "#f3c77a"
typography:
  display:
    fontFamily: "Alegreya Sans, sans-serif"
    fontSize: "clamp(2.6rem, 5.2vw, 4.4rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Alegreya Sans, sans-serif"
    fontSize: "clamp(2rem, 3.6vw, 2.9rem)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Alegreya Sans, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  lede:
    fontFamily: "Alegreya Sans, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  body:
    fontFamily: "Alegreya Sans, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Alegreya Sans SC, Alegreya Sans, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.08em"
  mono:
    fontFamily: "ui-monospace, Cascadia Code, JetBrains Mono, Source Code Pro, monospace"
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
rounded:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "16px"
  pill: "999px"
  circle: "50%"
spacing:
  square: "48px"
  stack: "2rem"
  head: "2.5rem"
  gutter: "clamp(1.25rem, 4vw, 3.5rem)"
  column: "clamp(2rem, 5vw, 5rem)"
  region-top: "clamp(4rem, 10vh, 7.5rem)"
  region-bottom: "clamp(3rem, 7vh, 5rem)"
  measure: "66ch"
  container: "84rem"
components:
  download-primary:
    backgroundColor: "{colors.music}"
    textColor: "{colors.on-music}"
    typography: "{typography.title}"
    rounded: "{rounded.pill}"
    padding: "0.95rem 1.5rem 0.95rem 1.25rem"
  download-primary-hover:
    backgroundColor: "{colors.music-bright}"
    textColor: "{colors.on-music}"
  button-ink:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0.65rem 1.2rem"
  button-ink-hover:
    backgroundColor: "rgba(245, 158, 11, 0.08)"
    textColor: "{colors.text}"
  nav-link:
    textColor: "{colors.muted}"
    padding: "0"
  nav-link-current:
    textColor: "{colors.text}"
  map-label:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
  perm-chip:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "5px"
    padding: "0.05rem 0.5rem"
  step-counter:
    backgroundColor: "rgba(13, 14, 19, 0.85)"
    textColor: "{colors.music}"
    rounded: "{rounded.circle}"
    size: "2.6rem"
  legend-icon:
    backgroundColor: "rgba(13, 14, 19, 0.7)"
    textColor: "{colors.music}"
    rounded: "{rounded.circle}"
    size: "2.75rem"
  code-block:
    backgroundColor: "rgba(9, 10, 14, 0.9)"
    textColor: "{colors.muted}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "1rem 1.2rem"
  callout:
    backgroundColor: "rgba(245, 158, 11, 0.06)"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "1.1rem 1.25rem"
---

# Design System: Hibiki site

This file describes the GitHub Pages site served from `docs/` (landing page and the Scene Sharing guide). It does not describe the Electron app's own UI; the app carries its own tokens in `frontend/src/assets/base.css`. The site borrows exactly three things from the app: the music, ambience, and effects category colours.

## Overview

**Creative North Star: "The Battle Map"**

The whole site is one charcoal dry-erase battle mat under a single lamp. A one-inch grid in warm off-white runs under everything; sound sources appear on it as translucent coloured radii, and the party token sits where they overlap. Copy never sits on raw grid: every block of reading text and every list item rests on a plate, a near-opaque ink sheet (`plate`, 1px `line` border, 16px radius, soft offset shadow) laid on the mat the way a GM lays a handout on the table. Headings and the hero stay on the mat itself. The only object that gets a ring-and-glow frame is the Download button, because it is the one thing the visitor came to pick up.

The palette is almost entirely warm neutral: five inks and three off-whites. Saturation is reserved for the three sound categories, and amber (music) doubles as the site's accent for links, focus, counters, and the token ring. Teal (ambience) and rose (effects) never appear outside their category role. Type is Alegreya Sans throughout, set large and tight at the top of the ramp and generously leaded in body, with Alegreya Sans SC used only for the small-caps map labels (radius names, table headers, section tags inside the app mock, counts on the packs list).

Density is editorial, not dashboard: a 66ch measure, two-column regions that collapse to one, and a lot of vertical air between regions so each reads as its own area of the map. Motion is restricted to the hero composition (radii light in sequence, then the ambience ring breathes and the effect ring hits) and to small ease-out lifts on the primary button; everything is removed under reduced-motion.

**Key Characteristics:**
- One continuous surface: grid, vinyl texture, and lamp glow are on `body`, never on sections.
- Three saturated fields only: amber music, teal ambience, rose effects.
- Circles mean sound: every ring, radius, counter, and token is round; chrome is pill or softly rounded.
- Reading copy and list items sit on plates (`plate` fill, `line` border, 16px radius); region headings sit directly on the grid, and regions are separated by 1px hairlines.
- One framed object per page: the amber pill Download with its double ring and glow.
- Alegreya Sans heavy at the top, Alegreya Sans SC small-caps only for labels.

## Colors

A warm charcoal ground with warm off-white ink, and three category colours that are the only saturated fields on the page.

### Primary
- **Music Amber** (`colors.music`): the music category and the site accent. Links, the Download fill, focus outline, step counters, token ring, current-nav underline, selection highlight, legend icon strokes. Its brighter hover (`colors.music-bright`) only appears on the primary button. Text set on amber uses **On-Amber Ink** (`colors.on-music`), a near-black warm brown, never white.
- **Lamp** (`colors.lamp`): amber at 16% in one 60rem x 36rem radial gradient anchored top-left of the body. It is the single light source; it is never repeated per section.

### Secondary
- **Ambience Teal** (`colors.ambience`): the ambience category only. Rings, radius fill and stroke, counts on the packs list, the ambience section marker in the app mock.

### Tertiary
- **Effects Rose** (`colors.effects`): the effects category only. Same roles as teal, plus the "hit" glow on a triggered effect.

### Neutral
- **Vinyl** (`colors.ink-0`): the page ground and `theme-color`; also the inner ring of the Download frame and the fill behind step counters and legend icons (at 70-85% so the grid shows through).
- **Ink 1, 2, 3** (`colors.ink-1`, `colors.ink-2`, `colors.ink-3`): the only lifted surfaces, used inside the app illustration (window, bars, cards) and for the scrollbar thumb and slider tracks. They are not section backgrounds.
- **Chalk** (`colors.text`): headings, strong text, nav current, pack names.
- **Muted Chalk** (`colors.muted`): body copy, ledes, descriptions, nav links at rest, map labels.
- **Dim Chalk** (`colors.dim`): captions, notes, platform list, footer, comment lines in code.
- **Line / Line Strong** (`colors.line`, `colors.line-strong`): hairlines. `line` divides regions and list rows; `line-strong` outlines chips, code blocks, the ink button, the TOC rail, and `pre` tops.
- **Grid / Grid Major** (`colors.grid`, `colors.grid-major`): the 1-inch minor grid at 5.5% and the 5-inch major grid at 9%, both drawn as 1px `linear-gradient` lines on `body`.
- **Code Amber** (`colors.code`): inline `code` text, a desaturated amber so it reads as ink, not as a link.

### Named Rules
**The Three Fields Rule.** Amber, teal, and rose are the only saturated colours on the site, and teal and rose appear only in their category role. Any new coloured element must be one of the three categories or it is neutral.

**The One Lamp Rule.** There is one radial amber glow, on `body`, top-left. Sections do not get their own glow, gradient, or tinted background; they sit on the mat.

**The Ink-on-Amber Rule.** Text on an amber fill is `on-music` (warm near-black), never white or chalk.

## Typography

**Display Font:** Alegreya Sans (with sans-serif)
**Body Font:** Alegreya Sans (with sans-serif)
**Label Font:** Alegreya Sans SC (with Alegreya Sans)
**Mono Font:** ui-monospace stack (Cascadia Code, JetBrains Mono, Source Code Pro)

**Character:** A humanist sans with calligraphic roots, set very heavy and tight at the top (800, negative tracking, line-height near 1) and comfortably at reading size (400, 1.55). The small-caps companion gives map labels the look of VTT tokens and printed legends without a second typeface. Fonts are self-hosted woff2 with `font-display: swap`; only 400, 500, 700, 800 (and 400/500 italic) are shipped.

### Hierarchy
- **Display** (800, `clamp(2.6rem, 5.2vw, 4.4rem)`, 1.02, -0.025em): hero headline only. One phrase inside it is coloured amber via `em`, no italic.
- **Headline** (800, `clamp(2rem, 3.6vw, 2.9rem)`, 1.08, -0.02em): region titles; read-page `h1` is slightly larger (`clamp(2.4rem, 4.5vw, 3.4rem)`) and read-page `h2` is a fixed 1.9rem.
- **Title** (800, 1.3-1.45rem, -0.01em): legend items, setup steps, layer names, pack names (700 at 1.15rem). `h4` in prose drops to 700 at 1.1rem.
- **Lede** (400, 1.3rem, 1.45, muted): the one-line pitch under the hero and under each region title (1.2rem there). Emphasis inside a lede is chalk at weight 500, not bold.
- **Body** (400, 1.125rem, 1.55; 1.05rem under 40rem): copy in muted chalk, strong in chalk at 700, measure 66ch.
- **Label** (Alegreya Sans SC 700, 0.95rem, 0.08em): map labels, radius names in the SVG (15px), table headers (0.9rem, 0.06em), pack counts (0.85rem, 0.05em), section titles inside the app mock (0.8rem, 0.1em).
- **Mono** (0.92rem in blocks, 0.9em inline): commands and JSON. Inline code is code-amber on a 7% chalk tint.

### Named Rules
**The Small-Caps Label Rule.** Alegreya Sans SC is for labels on the map: names on radii, legend tags, table heads, counts. It is never used for headings, buttons, or body copy, and it always carries positive tracking.

**The Heavy Top Rule.** Everything above body size is weight 800 with negative tracking; there is no 600 or 700 heading. Hierarchy comes from size and leading, not from alternating weights.

## Layout

The page is a single 84rem container with a fluid gutter (`clamp(1.25rem, 4vw, 3.5rem)`) on header, main, and footer alike. The map grid is drawn on `body` with a 48px square (40px under 40rem) and a major line every five squares, so the grid is visible beneath every region and continues under the header and footer.

Regions stack vertically with `clamp(4rem, 10vh, 7.5rem)` above and `clamp(3rem, 7vh, 5rem)` below, separated by a 1px `line` hairline. Each region opens with a head block capped at the 66ch measure (title plus lede, 2.5rem below). Inside, regions are two-column grids with a `clamp(2rem, 5vw, 5rem)` column gap:

- Hero: `minmax(0, 30rem)` copy column, fluid composition column, items centred.
- Scene board: fluid copy, `minmax(0, 36rem)` illustration.
- Setup: fluid steps, `minmax(0, 22rem)` sticky aside (`top: 5rem`).
- Read page: `14rem` sticky TOC, fluid prose at 66ch.

Lists use intrinsic grids rather than fixed columns: legend `auto-fit, minmax(17rem, 1fr)`, packs `auto-fit, minmax(15rem, 1fr)`, both capped at 70rem. Vertical rhythm inside lists is 2rem (steps, layers) or 2.25rem x 3rem (legend).

Two breakpoints. At 64rem every two-column grid collapses to one, sticky elements go static, and the TOC becomes an inline wrapped row. At 40rem the body size drops to 1.05rem, the nav wraps to a full-width row under the brand, the app mock stacks its sidebar on top, and lists go single-column.

## Elevation & Depth

Depth is drawn, not lifted. The page is flat on the mat; hierarchy comes from the lamp gradient, from translucent fills that let the grid show through, and from rings. Shadows exist in exactly two roles: the amber glow that frames the Download, and the dark drop under the one app illustration. Hover does not add shadow to anything except the Download, which brightens its own glow.

### Shadow Vocabulary
- **Download frame** (`box-shadow: 0 0 0 3px #0d0e13, 0 0 0 5px rgba(245,158,11,0.45), 0 14px 36px -10px rgba(245,158,11,0.55)`): a vinyl gap, an amber ring, and an amber pool below. On hover the ring goes to 0.7 and the pool to 0.65 with a 1px lift.
- **Token ring** (`box-shadow: 0 0 0 2px #0d0e13, 0 0 0 4px #f59e0b`): the brand token in the header; the same gap-plus-ring device as the Download at a smaller scale.
- **Window lift** (`box-shadow: 0 30px 60px -24px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.6)`): the app illustration only.
- **Playing glow** (`box-shadow: 0 0 0 1px <category>, 0 0 18px -6px <category>`): a track that is live inside the app illustration glows in its own category colour.
- **Counter shadow** (`box-shadow: 0 8px 18px -8px rgba(0,0,0,0.9)`): the setup step counters, so the amber ring sits on the grid.

### Named Rules
**The One Frame Rule.** The Download is the only object on the landing page framed by a ring-and-glow. A second framed object competes with it and is not added.

**The Ring Not Box Rule.** Emphasis is a ring around a round thing (token, counter, icon, radius), never a box around a block. Plates are containment, not emphasis: they are all the same ink and never carry colour, glow, or a thicker border.

**The Plate Rule.** Body copy, steps, legend entries, pack entries, the reading article, and the setup aside each sit on a plate so the grid and vinyl never run through letters. The hero copy instead gets a soft radial scrim (`.hero-copy::before`) and stays on the mat.

## Shapes

Round for anything that is a sound or a marker, pill for anything you press, and soft rectangles only for chrome that must contain text. Circles (`rounded.circle`): rings, radii, category dots, the brand token, step counters, legend icons. Pills (`rounded.pill`): the Download, the ink button, slider tracks, toggles. Soft chrome: code blocks and the callout at 10px, the app illustration at 16px, small chips (perm chips, inline code, `win-` elements) at 4-6px.

Borders are 1px hairlines in `line` or `line-strong`; the only 2px strokes are the category rings (inset) and the step counter in amber. The brand mark is an image clipped to a circle and zoomed 150% so the robot's face fills the token. The radii composition is inline SVG: category circle fill at 11% opacity, 2px stroke at 75%, an 8px core at 35%.

## Components

### Buttons
Buttons are pills; the primary is a solid amber field with ink text, the secondary is a hairline outline in chalk.

- **Shape:** full pill (`999px`).
- **Primary (Download):** amber on `on-music`, weight 800 at 1.2rem, padding `0.95rem 1.5rem 0.95rem 1.25rem`, a 1.3em stroke icon on the left and a version tag at weight 500 and 80% opacity inside the pill. Framed by the Download frame shadow.
- **Hover / Focus:** background to `music-bright`, `translateY(-1px)`, glow intensifies; 0.25s ease-out on transform and shadow, 0.2s on background. Active returns to rest. Focus everywhere is a 2px amber outline offset 3px.
- **Secondary (ink button):** transparent with a 1px `line-strong` border, chalk text at 700, padding `0.65rem 1.2rem`; hover borders amber and tints the fill with amber at 8%. Used for "Get the scene packs" and similar second actions.
- **Platform links:** plain text links in muted chalk under the primary, hover to chalk, no underline.

### Chips
- **Permission chip:** inline, 1px `line-strong` border, 5px radius, chalk at weight 600, 0.95em, padding `0.05rem 0.5rem`. Names a Discord permission; not interactive.
- **Category count:** small-caps label in the category colour with a 0.6rem category ring, grouped three per pack.

### Cards / Containers
The one container is the plate: `rgba(20, 21, 28, 0.94)` fill, 1px `line` border, 16px radius, shadow `0 18px 40px -28px rgba(0,0,0,0.9)`, padding about `1.35rem 1.5rem` for list items and `1.9rem 2rem` for a block of steps. Legend entries and pack entries are each one plate in an `auto-fit` grid with a 1rem gap (minimum 20rem and 15rem respectively); the layers list, the steps list, the setup aside, and the reading article are each one plate. Plates are never nested and never tinted. Other contained blocks are the code block (near-black at 90% over the grid, `line-strong` border, 10px radius, padding `1rem 1.2rem`) and the read-page callout (amber at 6% fill, amber at 40% border, 10px radius, strong text in amber). The app illustration (`.window`) is an authored mock of the Scenes tab and is not a reusable container.

### Inputs / Fields
None on the site. The sliders and toggles inside the app illustration are static drawings.

### Navigation
- **Style:** a bare strip on the map: brand token plus name at 800/1.45rem with the kanji in dim at 500, and four links at 500/1.05rem in muted chalk, gap `clamp(1rem, 2.5vw, 2rem)`.
- **Hover:** chalk, no underline. **Current page:** chalk with a 1px amber underline offset 0.35em.
- **Mobile (under 40rem):** nav drops to a full-width row under the brand, `space-between`, 0.98rem.
- **Skip link:** amber pill, hidden above the viewport until focused.
- **Read-page TOC:** small-caps "On this page" label, a `line-strong` left rail, links in muted chalk with the active one in chalk and an amber rail segment; becomes an inline wrapped row under 64rem.

### Map Label
A small-caps label with a category ring in front: Alegreya Sans SC 700 at 0.95rem, 0.08em, muted chalk, with a 0.8em circle that has a 2px inset stroke and a 25% fill in its category colour. Used wherever a category is named outside the hero SVG (layers list, counts, TOC heading, table heads).

### Sound Radii (signature)
The hero composition: an inline SVG on a 640x530 viewBox, three category circles (amber r190, teal r170, rose r120) overlapping on the party token, each with an 8px core dot, a small-caps name, and a one-line spec in muted body face. The token is the logo clipped to a circle with a 4px amber ring and a dark offset shadow. Under `prefers-reduced-motion: no-preference` the radii scale in from 8% with staggered delays (0.15s, 0.55s, 0.95s) over 1.4s ease-out, the token lands at 1.3s, the ambience ring breathes 4.5% every 7s, and the effect ring hits (scale 1.08, fill to 30%) every 9s. The caption under it is dim and centred.

### Step Counter
The setup steps: a 2.6rem circle (2.2rem under 40rem) with a 2px amber ring, vinyl fill at 85%, amber counter text at 800/1.15rem, and the counter shadow, placed in a 2.6rem first column beside a title-and-body block.

### Legend Item
A 2.75rem circle icon (1.5px `line-strong` ring, vinyl fill at 70%, 1.35rem stroke SVG in amber) spanning two rows beside a title at 800/1.3rem and a muted description. Links inside a legend description are chalk with a `line-strong` underline that turns amber on hover.

## Do's and Don'ts

### Do:
- **Do** put the grid, vinyl texture, and lamp on `body` and let every region sit directly on it.
- **Do** separate regions and list rows with a 1px `line` hairline; use `line-strong` only for outlines that must read as an object (chips, code, ink button, TOC rail).
- **Do** use amber for every accent job (links, focus, counters, current nav, token ring) and keep teal and rose for ambience and effects only.
- **Do** set anything above body size in Alegreya Sans 800 with negative tracking, and keep body at 1.125rem/1.55 within a 66ch measure.
- **Do** mark a category with a ring (2px inset stroke, 25% fill) before a small-caps label.
- **Do** use `on-music` for text on amber and `music-bright` only as the primary button's hover.
- **Do** collapse two-column regions to one at 64rem and shrink the grid square to 40px, body to 1.05rem, at 40rem.
- **Do** gate every animation behind `prefers-reduced-motion: no-preference` and keep the only motion in the hero composition and the primary button's lift.

### Don't:
- **Don't** tint plates, nest them, or give a section its own background; plates are one ink and the map stays one surface with one lamp.
- **Don't** frame a second object with the ring-and-glow treatment while the Download is on the page.
- **Don't** introduce a fourth saturated colour, or use teal or rose outside their category role.
- **Don't** set headings, buttons, or body copy in Alegreya Sans SC; small caps are for labels on the map only.
- **Don't** use white text on amber, or amber text on amber tints beyond the callout's strong text.
- **Don't** treat the app illustration (`.window`) as a card pattern to reuse; it is a drawing of the product, not a container.
- **Don't** square off a ring, counter, token, or radius; sounds and markers are circles.
