// ── Built-in palettes ──────────────────────────────────────────────────────────
// Curated retro / display palettes shipped with the Dither tool. Each is a list
// of hex colours. Users can also save their own (see store.js), including colours
// sent over from the Color Palette tool.

export const BUILTIN_PALETTES = [
  { id: 'bw',        name: '1-bit B&W',    colors: ['#000000', '#ffffff'] },
  { id: 'gameboy',   name: 'Game Boy',     colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
  { id: 'handheld',  name: 'Handheld',     colors: ['#2d1b00', '#1e606e', '#5ab9a8', '#c4f0c2'] },
  { id: 'grayscale4', name: 'Gray 4',      colors: ['#000000', '#555555', '#aaaaaa', '#ffffff'] },
  { id: 'grayscale8', name: 'Gray 8',      colors: ['#000000', '#242424', '#494949', '#6d6d6d', '#929292', '#b6b6b6', '#dbdbdb', '#ffffff'] },
  { id: 'cga0',      name: 'CGA',          colors: ['#000000', '#55ffff', '#ff55ff', '#ffffff'] },
  { id: 'cga1',      name: 'CGA mode 1',   colors: ['#000000', '#55ff55', '#ff5555', '#ffff55'] },
  { id: 'nolstag',   name: 'Nolstag-OS',   colors: ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179'] },
  { id: 'cybergum',  name: 'Cybergum',     colors: ['#2b0f54', '#ab1f65', '#ff4f69', '#fff7f8', '#ff8142', '#ffda45'] },
  { id: 'pico8',     name: 'PICO-8',       colors: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'] },
  { id: 'c64',       name: 'Commodore 64', colors: ['#000000', '#ffffff', '#880000', '#aaffee', '#cc44cc', '#00cc55', '#0000aa', '#eeee77', '#dd8855', '#664400', '#ff7777', '#333333', '#777777', '#aaff66', '#0088ff', '#bbbbbb'] },
  { id: 'pastel',    name: 'Pastel',       colors: ['#ffd6e0', '#ffef9f', '#c1f7dc', '#a7c7e7', '#d7b9f7'] },
  { id: 'sepia',     name: 'Sepia',        colors: ['#2b1a0e', '#5c3b1e', '#9c6b3f', '#d2a679', '#f3e3c3'] },
]

export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const v = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ]
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('')
}

// Sort palette colours dark→light by luminance so endpoints (dark/light) are
// well-defined for Mono / Tonal modes.
export function sortByLuma(colors) {
  return [...colors].sort((a, b) => {
    const [ar, ag, ab] = hexToRgb(a), [br, bg, bb] = hexToRgb(b)
    return (0.299 * ar + 0.587 * ag + 0.114 * ab) - (0.299 * br + 0.587 * bg + 0.114 * bb)
  })
}
