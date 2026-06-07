// ── Artist pigment set ────────────────────────────────────────────────────────
//
// Real pigments, each with the physical traits that make them behave
// differently on the palette and the paper:
//
//   tint        tinting strength — how hard it pushes a mix (Phthalo bullies
//               everything; earth colours are gentle).
//   opacity     0 transparent glaze … 1 opaque cover.
//   granulation 0 smooth … 1 grainy/settling (texture in the wet sim).
//   staining    0 lifts/wipes off clean … 1 stains the paper (resists smudge).
//
// `hex` is the approximate masstone. The spectral engine turns it into a
// reflectance curve; the traits drive scattering, mix weighting and the sim.

// Masstone hexes and traits tuned to how each paint actually looks straight
// from the tube and behaves on paper. tint = relative tinting strength,
// opacity 0 transparent…1 opaque, granulation 0 smooth…1 grainy, staining
// 0 lifts clean…1 stains.
export const PIGMENTS = [
  { id: 'tiwhite',  name: 'Titanium White',   hex: '#f4f4ef', tint: 1.4, opacity: 1.00, granulation: 0.00, staining: 0.05 },
  { id: 'cadyellow',name: 'Cadmium Yellow',   hex: '#ffb000', tint: 1.7, opacity: 0.92, granulation: 0.05, staining: 0.15 },
  { id: 'hansa',    name: 'Hansa Yellow',     hex: '#f7d000', tint: 1.9, opacity: 0.40, granulation: 0.00, staining: 0.45 },
  { id: 'yochre',   name: 'Yellow Ochre',     hex: '#c08a25', tint: 1.3, opacity: 0.82, granulation: 0.30, staining: 0.25 },
  { id: 'cadred',   name: 'Cadmium Red',      hex: '#e02e1f', tint: 1.8, opacity: 0.90, granulation: 0.05, staining: 0.25 },
  { id: 'alizarin', name: 'Alizarin Crimson', hex: '#8a1c2b', tint: 3.4, opacity: 0.20, granulation: 0.00, staining: 0.85 },
  { id: 'bsienna',  name: 'Burnt Sienna',     hex: '#7c3a1d', tint: 1.7, opacity: 0.55, granulation: 0.35, staining: 0.40 },
  { id: 'rumber',   name: 'Raw Umber',        hex: '#4d3d2b', tint: 1.4, opacity: 0.58, granulation: 0.28, staining: 0.30 },
  { id: 'ultra',    name: 'Ultramarine Blue', hex: '#26358c', tint: 2.2, opacity: 0.30, granulation: 0.65, staining: 0.25 },
  { id: 'phthaloB', name: 'Phthalo Blue',     hex: '#0e3f63', tint: 5.5, opacity: 0.25, granulation: 0.00, staining: 0.92 },
  { id: 'phthaloG', name: 'Phthalo Green',    hex: '#0c5a48', tint: 5.0, opacity: 0.25, granulation: 0.00, staining: 0.90 },
  { id: 'viridian', name: 'Viridian',         hex: '#2f8163', tint: 1.7, opacity: 0.35, granulation: 0.40, staining: 0.25 },
  { id: 'dioxazine',name: 'Dioxazine Purple', hex: '#34215c', tint: 3.4, opacity: 0.28, granulation: 0.05, staining: 0.80 },
  { id: 'lampblack',name: 'Lamp Black',       hex: '#1b1c20', tint: 3.6, opacity: 0.66, granulation: 0.05, staining: 0.50 },
]

export const PIGMENT_BY_ID = Object.fromEntries(PIGMENTS.map(p => [p.id, p]))

// Traits to pass to makePaint() for a pigment (everything but id/name/hex).
export function pigmentTraits(p) {
  return { name: p.name, tint: p.tint, opacity: p.opacity, granulation: p.granulation, staining: p.staining }
}
