// ── Pixel-dither → SVG (vector) export ──────────────────────────────────────────
//
// Turns a quantised ImageData into a compact SVG. For square edges, adjacent
// same-colour cells on a row are merged into a single <rect> (run-length), which
// keeps flat / ordered results small. For round / diamond edges each cell becomes
// a <circle> / rotated <rect> on a gap-colour background (no merging possible).
//
// Best for ordered / low-colour outputs; noisy error-diffusion produces many
// shapes (the UI gates SVG to vector-friendly modes for that reason).

function hex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

export function ditherToSvg(img, { shape = 'square', gap = '#000000' } = {}) {
  const { width: W, height: H, data } = img
  let body = ''

  if (shape === 'square') {
    // Run-length merge horizontal spans of identical colour.
    for (let y = 0; y < H; y++) {
      let x = 0
      while (x < W) {
        const o = (y * W + x) * 4
        const r = data[o], g = data[o + 1], b = data[o + 2]
        let run = 1
        while (x + run < W) {
          const oo = (y * W + x + run) * 4
          if (data[oo] !== r || data[oo + 1] !== g || data[oo + 2] !== b) break
          run++
        }
        body += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${hex(r, g, b)}"/>`
        x += run
      }
    }
    return wrap(W, H, body)
  }

  // round / diamond — one shape per cell over a gap background
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const fill = hex(data[o], data[o + 1], data[o + 2])
      if (shape === 'diamond') {
        body += `<rect x="-0.5" y="-0.5" width="1" height="1" fill="${fill}" transform="translate(${x + 0.5},${y + 0.5}) rotate(45) scale(0.72)"/>`
      } else {
        body += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.5" fill="${fill}"/>`
      }
    }
  }
  return wrap(W, H, `<rect width="${W}" height="${H}" fill="${gap}"/>` + body)
}

function wrap(W, H, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${body}</svg>`
}
