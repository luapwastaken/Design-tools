// ── Color Palette design tokens ───────────────────────────────────────────────
//
// One source of truth for the tool's surfaces, text, accent and type scale.
// Replaces the seven competing token objects that had drifted apart (index.jsx
// `C`, ExportPanel `C`, panelUi ACCENT, plus ACCENT redefined in Generators,
// Mixer, MaterialPanel and ShadowHighlight — two of which had picked up the
// Logo Maker's blue).
//
// Text colours are solved against RAISED (#16161c), the tool's worst-case
// surface, so a token that passes there passes everywhere:
//
//   text      15.4:1    textDim  10.6:1    muted  6.7:1    faint  4.3:1
//
// `faint` is the floor for anything a user has to read. Dimmer values exist
// only as `line` / `lineHi` for hairlines and are never applied to text.

export const T = {
  // ── Surfaces, dark → light ────────────────────────────────────────────────
  bg:       '#0b0b0d',   // app ground
  sidebar:  '#0e0e11',   // picker column, tab bars
  panel:    '#111114',   // panel body
  raised:   '#16161c',   // cards sitting on the panel
  control:  '#1a1a22',   // inputs, unpressed buttons

  // ── Hairlines (decoration only — never text) ──────────────────────────────
  line:     '#26262f',
  lineHi:   '#3a3a48',   // hover / focus edge

  // ── Text, brightest → dimmest ─────────────────────────────────────────────
  text:     '#f0ede7',   // primary
  textDim:  '#c6c6c6',   // secondary prose
  muted:    '#9e9e9e',   // labels, hints, inactive chips
  faint:    '#7c7c7c',   // legibility floor — nothing readable goes dimmer

  // ── Accent ────────────────────────────────────────────────────────────────
  // Split by job: fills and borders are graphics (3:1 bar), accent-coloured
  // TEXT needs 4.5:1, and #8b5cf6 only manages 4.25:1 on raised. So text and
  // icons use the lifted value.
  accent:     '#8b5cf6',  // fills, borders, selection rings
  accentText: '#a78bfa',  // accent-coloured text and icons
  accentSoft: '#2d1a5e',  // active chip / pressed background
  accentLine: '#6d3fbe',  // active chip border

  // ── Semantic ──────────────────────────────────────────────────────────────
  ok:   '#4ade80',
  warn: '#fbbf24',
  bad:  '#f87171',

  // ── Type scale ────────────────────────────────────────────────────────────
  // Was 7.5–14px with 87% of declarations at or below 11px. Floor is now 11,
  // and 11 is reserved for uppercase micro-labels where the caps height and
  // letter-spacing carry it.
  micro:   11,  // uppercase section labels, badges
  label:   12,  // field labels, hints
  body:    13,  // panel prose, button text, inputs
  title:   15,  // swatch names, card titles
  display: 20,  // stat numerals

  // ── Rhythm ────────────────────────────────────────────────────────────────
  r:    5,   // radius, controls
  rLg:  8,   // radius, cards and strips
  gap:  8,
  gapLg: 14,
}

// Numerals, hex codes and anything columnar. JetBrains Mono is already loaded
// in main.jsx; everything else uses the UI stack so prose isn't set in mono.
export const MONO = "'JetBrains Mono', ui-monospace, monospace"
export const UI   = "system-ui, -apple-system, 'Segoe UI', sans-serif"

// Back-compat: `C` and `ACCENT` were imported by name across the tool.
export const C = T
export const ACCENT = T.accent
