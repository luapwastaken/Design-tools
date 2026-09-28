# Design Tools: design brief

**Direction:** C, "Instrument". Luap picked it on 2026-09-27 because it reads best
typographically. Dark by default; light is a choice in Settings.
**Revision 2:** after the design-critic review. Contrast fixes in the light theme, one new token
for menus, the hard rules written as checks, and the states, keyboard and layout rules the
mockup left open.

**Visual source of truth:** `docs/rewrite/directions/c-instrument.html` (boards: Colour › Design,
Image › Halftone, Primitives). Where this brief and the mockup disagree, this brief wins; §10
lists the known differences. Where the brief is silent, the mockup wins. `a-desk.html` and
`b-specimen.html` are kept only for the two ideas grafted in §9.

---

## 1. What it should feel like

A piece of lab gear for colour and print. Dark, neutral, compact. Numbers are first-class: every
value is a mono readout you can drag or type into, and scales (ticks, rulers, meters) explain
values instead of prose. Panels are docked modules with clear headers. The only colours with hue
are Luap's own work, one signal accent for "live and active", and red for real failures.

It is used for playful experiments and real brand work, often for hours. It must stay calm.

## 2. Hard rules, written as checks

A violation is a defect. Each rule says how to check it.

1. **Icons.** Icons render only through `<Icon name>` (Material Symbols Rounded, bundled).
   Non-ASCII characters allowed in UI strings: `× · ° Δ ≈ – … " " '`. No emoji. CSS `content:`
   is only ever `""`. *Check: grep the renderer for other non-ASCII characters and for `content:`.*
2. **Colour.** Colour literals appear only in `tokens.css`, always as `oklch()`. Everywhere else
   uses `var(--…)` or the user's own colour data. Both `[data-theme]` blocks define exactly the same
   token names. The only other literals allowed are the main-process hex values in §3.4.
   *Check: a script diffs the two token blocks and greps for colour literals outside tokens.css.*
3. **Destructive actions confirm and can be undone.** Delete and Move to arm the inline confirm
   (focus lands on Keep, Esc keeps) and leave an Undo toast. Rename, duplicate, reset a module and
   opening over a document are undo-only.
4. **No fades.** `transition-property`, `@keyframes` and WAAPI may name only `transform`,
   `translate`, `scale`, `rotate` and `clip-path`, at 120ms or less. `transition: all`, a bare
   duration, and any transition or animation of `opacity`, `filter`, colours, backgrounds or
   `box-shadow` never appear. No `startViewTransition`. Under `prefers-reduced-motion: reduce`
   every duration is 0 and the spinner stops. This is a motion-sickness constraint for Luap, not a
   style preference. *Check: grep CSS and TS for `transition`, `animation`, `@keyframes`,
   `.animate(`.*
5. **Every number is typable.** Every draggable handle (slider, dial, 2D plane, gradient stop,
   guide, crop edge) has a NumberField for each value it sets.
6. **No OS-drawn popups.** No `title` attribute, native `<select>`, `Menu.popup`,
   `<input type=color>` or `<input type=number>`. Use the shared Tooltip, Select, ContextMenu and
   NumberField. *Check: grep for `title=`, `<select`, `type="color"`, `type="number"`.*

## 3. Tokens

In `src/renderer/styles/tokens.css`. The theme sets `data-theme` on `<html>` (dark is the
default) and each theme block sets `color-scheme`. Switching is an instant swap with no
transition.

### 3.1 Colour, dark and light

| token | dark | light | use |
|---|---|---|---|
| `--page` | `oklch(0.12 0 0)` | `oklch(0.93 0 0)` | behind everything |
| `--ground` | `oklch(0.185 0 0)` | `oklch(0.86 0 0)` | title bar, rail, status bar, gaps between modules |
| `--module` | `oklch(0.225 0 0)` | `oklch(0.965 0 0)` | a docked module |
| `--module-head` | `oklch(0.25 0 0)` | `oklch(0.935 0 0)` | module header strip |
| `--well` | `oklch(0.19 0 0)` | `oklch(0.915 0 0)` | recessed: fields, readouts, tracks |
| `--well-hover` | `oklch(0.205 0 0)` | `oklch(0.895 0 0)` | list-row hover |
| `--raise` | `oklch(0.29 0 0)` | `oklch(0.895 0 0)` | keys: secondary buttons, active segment, selected row |
| `--raise-hover` | `oklch(0.32 0 0)` | `oklch(0.87 0 0)` | |
| `--press` | `oklch(0.35 0 0)` | `oklch(0.84 0 0)` | |
| `--line` | `oklch(0.31 0 0)` | `oklch(0.76 0 0)` | rules and dividers |
| `--tick` | `oklch(0.46 0 0)` | `oklch(0.66 0 0)` | scale ticks, scrollbar thumb |
| `--tick-strong` | `oklch(0.64 0 0)` | `oklch(0.45 0 0)` | major ticks, neutral selection ring, off-toggle knob |
| `--ink` | `oklch(0.95 0 0)` | `oklch(0.20 0 0)` | primary text and values |
| `--ink-2` | `oklch(0.80 0 0)` | `oklch(0.37 0 0)` | secondary text; any text on `--pasteboard` |
| `--ink-3` | `oklch(0.69 0 0)` | `oklch(0.45 0 0)` | labels, units, icons at rest |
| `--ink-4` | `oklch(0.50 0 0)` | `oklch(0.58 0 0)` | disabled and unlit only |
| `--signal` | `oklch(0.86 0.18 144)` | `oklch(0.45 0.14 145)` | the accent (§4) |
| `--signal-soft` | `oklch(0.86 0.18 144 / 0.13)` | `oklch(0.45 0.14 145 / 0.12)` | drag-over fill |
| `--signal-ink` | `oklch(0.18 0 0)` | `oklch(0.99 0 0)` | text on signal |
| `--danger` | `oklch(0.73 0.16 25)` | `oklch(0.51 0.18 27)` | real failures, destructive buttons |
| `--danger-soft` | `oklch(0.73 0.16 25 / 0.14)` | `oklch(0.51 0.18 27 / 0.10)` | error field fill |
| `--danger-ink` | `oklch(0.17 0 0)` | `oklch(0.99 0 0)` | text on danger |
| `--primary` | `oklch(0.95 0 0)` | `oklch(0.20 0 0)` | primary button fill |
| `--primary-hover` | `oklch(1 0 0)` | `oklch(0.30 0 0)` | |
| `--primary-ink` | `oklch(0.17 0 0)` | `oklch(0.98 0 0)` | |
| `--pasteboard` | `oklch(0.205 0 0)` | `oklch(0.80 0 0)` | around a canvas |
| `--popover` | `oklch(0.285 0 0)` | `oklch(0.99 0 0)` | menus, popovers, toasts |
| `--popover-hot` | `oklch(0.35 0 0)` | `oklch(0.895 0 0)` | current row and button hover inside a popover |
| `--tip` | `oklch(0.95 0 0)` | `oklch(0.22 0 0)` | tooltip fill |
| `--tip-ink` | `oklch(0.17 0 0)` | `oklch(0.97 0 0)` | tooltip text |
| `--shadow` | `oklch(0 0 0 / 0.55)` | `oklch(0 0 0 / 0.20)` | popovers and toasts only |
| `--edge` | `oklch(1 0 0 / 0.10)` | `oklch(0 0 0 / 0.12)` | hairline around any content colour |
| `--on-content-bg` | `oklch(0 0 0 / 0.38)` | `oklch(0 0 0 / 0.38)` | buttons drawn on top of a swatch |
| `--on-content-ink` | `oklch(1 0 0 / 0.92)` | `oklch(1 0 0 / 0.92)` | their icons |
| `--on-content-ink-2` | `oklch(1 0 0 / 0.72)` | `oklch(1 0 0 / 0.72)` | drag grips on a swatch |
| `--cross` | `oklch(1 0 0)` | `oklch(1 0 0)` | canvas crosshair |
| `--cross-halo` | `oklch(0 0 0 / 0.55)` | `oklch(0 0 0 / 0.55)` | its halo |

Changes from the mockup, for contrast: light `--ink-3` 0.47 → 0.45 (4.86:1 on ground, was 4.46),
light `--signal` 0.49 → 0.45 (4.58:1 on ground, was 3.85), light `--ink-4` 0.64 → 0.58 (3.33:1
on well, was 2.61), light `--line` 0.80 → 0.76 (1.40:1 on ground, matching dark). New:
`--popover-hot` (in dark, `--raise` on `--popover` was 1.02:1, so the current menu row was
invisible) and the three `--on-content-*` tokens. The mockup's `--sw-*` and `--ink-process-y`
are sample palette data, not tokens.

### 3.2 Geometry
```css
--row: 28px;   --ctl: 24px;   --r-ctl: 3px;   --r-mod: 5px;   --gap: 4px;
--btn-lg: 32px;   --btn-xs: 20px;   --ib: 24px;   --ib-sm: 22px;   --ib-xs: 20px;
--menu-row: 26px;   --toast-h: 38px;   --canvas-bar: 36px;   --docbar: 44px;   --lib-row: 42px;
```

### 3.3 Type

- **Sans: Archivo** at `font-stretch: 88%`, from `@fontsource-variable/archivo/wdth.css`. The
  family is named `"Archivo Variable"`. Used for tool names, titles, buttons and sentences.
- **Mono: IBM Plex Mono** 400/500/600. Used for every label, value and readout, with
  `tabular-nums`.

| token | size | face | use |
|---|---|---|---|
| `--fs-meta` | 11.5 | sans | hints, segment labels, meta lines |
| `--fs-base` | 12 | sans | body, buttons, tooltips |
| `--fs-ctl` | 12.5 | sans | text inside fields, selects, menu rows, toasts, breadcrumb |
| `--fs-row` | 13 | sans | rail tools, library rows |
| `--fs-swatch` | 14 | sans | swatch names |
| `--fs-title` | 16 | sans | document title |
| `--fs-label` | 10 | mono 500, `.08em`, uppercase, `--ink-3` | labels |
| `--fs-mod-title` | 10 | mono 600, `.1em`, uppercase, `--ink` | module header title |
| `--fs-mod-sub` | 10 | mono 400, `.06em`, uppercase, `--ink-3` | module header sub-label |
| `--fs-unit` | 11 | mono | units, small readouts |
| `--fs-value` | 13 | mono | values |
| `--fs-value-lg` | 18 | mono | big readouts |

UPPERCASE is only for mono labels and module headers. Sans copy is sentence case and plain
language, with no exclamation marks.

**Icons:** `font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20`. FILL 1 only for
the active tool and latched IconButtons. Sizes: 18 by default, 16 inside buttons, fields and
menus, 14 in xs controls. At rest `--ink-3`, active `--ink`.

### 3.4 Main-process colours (hex, generated from the tokens)

Electron's `backgroundColor` and `titleBarOverlay` take hex, not oklch. These are the only colour
literals outside tokens.css, generated by a script from the token table:

| | page (window background) | ground (overlay colour) | ink-2 (caption symbols) |
|---|---|---|---|
| dark | `#060606` | `#131313` | `#bebebe` |
| light | `#e8e8e8` | `#d1d1d1` | `#404040` |

## 4. Colour rules

- **Signal appears only on:** the active-tool LED, the active segment's underline, focus rings,
  a toggle's on track, the selected radio, the progress fill, text selection, ruler cursor lines,
  live readouts (the status bar, the canvas foot, the `OPEN` tag) and a drag-over target. Nowhere
  else. It is never the primary button and never decoration.
- The primary button is `--primary` (ink on ground). One per module at most.
- `--danger` only for real failures (a failed check, an out-of-range value) and destructive
  buttons.
- **Anything drawn around a colour being judged is neutral.** A selected or focused swatch, chip
  or thumbnail gets `box-shadow: inset 0 0 0 1px var(--tick-strong)` on its card, 4px clear of the
  colour, plus a 2px signal bar under its meta row when it has keyboard focus. Never a signal
  outline around the colour itself.
- Every content colour (swatches, inks, thumbnails) sits inside an `--edge` hairline, so a
  near-black brand colour never disappears into the dark chrome.
- Text on `--pasteboard` uses `--ink-2` or stronger.

## 5. Layout

- **Title bar 40px** on `--ground`: app mark, breadcrumb (group, tool and document name separated
  by the `chevron_right` icon at 14px in `--ink-4`), the document-state readout in mono caps, then
  the Windows caption area. Width comes from `env(titlebar-area-width)`. **No theme button:** the
  theme is chosen only in Settings.
- **Rail 184px** on `--ground`. Below a 1440px window width it collapses to a 48px icon rail with
  tooltips. Mono group labels, tool rows (icon, name, shortcut digit). Hover `--well-hover`; active
  `--module` with a signal LED, filled icon and weight 500.
- **Library 300px** (resizable 240–420), docked between the rail and the work area.
- **Work area** at least 540px. **Inspector 380px** (resizable 340–460) on the right. When space
  runs out, the rail collapses first, then the inspector shrinks to its minimum.
- **Modules** are docked with `--gap` of ground between them, radius `--r-mod`, a `--module-head`
  strip holding the mono title, a dim sub-label and right-aligned readouts and actions. Only module
  bodies scroll; headers stay.
- **Resize handles** are the `--gap` strip between modules: `col-resize` cursor, a 1px
  `--tick-strong` line on hover, fixed to the window so they never scroll away.
- **Canvas tools:** Viewport on `--pasteboard` in the work area, optional rulers, zoom controls at
  bottom left, cursor readout and counts at bottom right, inspector modules on the right.
- **Status bar 22px** on `--ground`, mono caps readouts.
- Swatch grids reflow with `repeat(auto-fill, minmax(140px, 1fr))`.

## 6. Components and behaviour

The Primitives board in `c-instrument.html` is the visual reference. What must hold:

- **NumberField:** `type=text inputmode=decimal`. The mono label on the left is the scrub handle:
  one step per 2px, Shift ×10, Alt ×0.1. The value on the right is typable, and units are dim.
  Arrow keys step ±1, with Shift ×10. Enter commits; Esc reverts. An out-of-range value typed and
  entered isn't committed: the field keeps the text with a danger edge and a message giving the
  valid range, and blur reverts it. States: rest, hover, scrubbing, typing, disabled, error.
- **Slider + number:** 4px track in `--well`, ticks at quarters and twentieths, a thin `--ink`
  needle. Always followed by its NumberField.
- **Segmented:** `--well` track, active segment on `--raise` with a signal underline. Arrow keys
  move inside.
- **Select:** a mono caps label inside the field (`ROLE  Accent`). The menu is the shared popover,
  and rows can lead with a swatch.
- **Toggle:** `--well` track with a `--tick-strong` knob when off, signal track when on. The label
  toggles it too.
- **Armed confirm:** the item turns into a small card saying what will happen and what is kept,
  using only facts the app knows ("4 swatches. Goes to the Recycle Bin when this closes." and, if
  it's open somewhere, "Open in Illustration; it stays open there, detached."). Buttons: Delete
  (danger) and Keep, with focus on Keep.
- **Toast:** bottom centre of the work column, 12px above the status bar. Icon, message, Undo,
  and `Ctrl Z` as a `kbd` only while Ctrl+Z will actually do it (spec §8). Undo toasts stay 8s,
  paused while hovered or while the window is unfocused. At most three stack, newer ones pushing
  older ones up by transform. Error toasts carry the `error` icon in `--danger` and stay until
  dismissed. Toasts never take focus.
- **Tooltip:** shows after 500ms of hover, or instantly if another tooltip closed less than 300ms
  ago. Appears in place with no transition. Hides on pointerdown, scroll, Esc or pointer leave. Sits
  below its trigger and flips before it would enter the caption area. Carries the shortcut as a
  `kbd`. Long names that end in an ellipsis show the full name in a tooltip.
- **Context menu:** Open, Send to (a submenu listing tools with what they'll use: PALETTE, INKS,
  AS SHAPE), Rename, Duplicate, Move to, Reveal in Explorer, Delete. The current row is
  `--popover-hot`, never `--raise`.
- **Buttons:** 24px. Secondary on `--raise`, ghost transparent, danger on `--danger`. Press moves
  them 1px down (transform).
- **Keyboard and focus:** Tab order runs title bar, rail, Library, work modules top to bottom,
  then inspector modules. F6 and Shift+F6 cycle between those regions. The rail, library lists,
  segmented controls, radio lists and menus are one Tab stop each, with arrow keys moving inside.
  Enter opens. Delete arms the confirm. A closed menu returns focus to its trigger. Focus ring:
  `outline: 1px solid var(--signal); outline-offset: -1px` (inside, so a module's edge can't clip
  it); fields use an inset signal ring. The mouse wheel never changes a value.

## 7. States

| State | Look |
|---|---|
| Hover | `--well-hover` on list rows, `--raise-hover` on keys, `--popover-hot` in menus |
| Selected row | `--raise` (unchanged when its panel loses focus) |
| Multi-selected | `--raise` on each row; the anchor row also gets `inset 0 0 0 1px var(--tick-strong)` |
| Drag-over target | `inset 0 0 0 1px var(--signal)` plus `--signal-soft` fill |
| Insertion point | a 2px `--signal` bar |
| Dragged source | stays in place with a dashed `--tick` outline |
| Invalid drop target | no highlight, `not-allowed` cursor |
| Accepted by the active tool | the Library row's kind label turns `--ink-2` and shows the tool's use label; other rows unchanged (never dimmed by opacity) |
| Disabled | fill `--well`, label and unit `--ink-4`, value `--ink-3` (a locked value stays readable), no hover |
| Error | inset `--danger` plus `--danger-soft` fill; the message goes under the field, or in the module's footer when the row can't grow |
| Scrollbars | 8px, transparent track, `--tick` thumb (`--tick-strong` on hover), 4px radius, no arrows, `scrollbar-gutter: stable` on the Library list and inspector |
| Empty | what to drop, paste or pick, with the one action as a button |
| Loading | Progress with counts |
| Overflow | ellipsis; the tooltip shows the full text |

## 8. Motion

- Only floating layers move: popovers and menus may scale from 0.98 at their origin; toasts enter
  by `translateY` from 100% plus 12px (120ms) and leave the same way (90ms). Easing
  `cubic-bezier(.2,.8,.2,1)`.
- **Docked panels (Library, inspector, rail collapse) snap open and closed with no animation.**
- Hover and press change colour instantly. Press moves 1px by transform.
- Nothing loops in the chrome except the busy spinner, and only while work is running.

## 9. Grafted from the other directions

1. **From A (Desk), the neutral surround for judging colour.** The colour tools' swatch area can
   switch its surround between a neutral 18% grey well (the default), the palette's own background
   colour, and plain module.
2. **From B (Specimen), the full data under a chip.** Swatches can show Hex, OKLCH, RGB and
   `≈ CMYK` rows under the chip. C shows Hex and L C H by default; the full rows are a view option
   in the colour tools.

## 10. Where the mockup differs from this brief (the brief wins)

- Status bar 22px (the mockup has 24).
- Slider track 4px (§6 of revision 1 said 2; the mockup's 4 reads better).
- Rail tool hover is `--well-hover`, active `--module` (the mockup uses `--module` for both).
- Selected swatch: the neutral inset ring in §4 (the mockup's ring is similar; use §4's CSS).
- Toast at bottom centre (the mockup puts it bottom right).
- No theme button in the title bar (the mockup's `contrast` button was a review control).
- Slider, channel and gauge needles stay `--ink`. Signal on scales means ruler cursors and live
  readouts only.
- The mockup uses the `title` attribute for tooltips; rule 6 bans it.
- The mockup draws controls on swatches with raw colours; use the `--on-content-*` tokens.
- The mockup's armed confirm says "not used elsewhere", which the app can't know; use §6's wording.
