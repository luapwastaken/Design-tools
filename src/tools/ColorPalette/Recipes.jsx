import { useState, useMemo } from 'react'
import { oklchToHex, contrast, toOklch, parseColor } from '../../lib/color.js'
import { addSwatch, usePalette } from './store.js'
import Icon from '../../components/Icon.jsx'
import { Section, ACCENT } from './panelUi.jsx'

// ── Grounded colour strategy, not guesswork ───────────────────────────────────
//
// Each industry maps to documented colour conventions (the hue psychology real
// brands in the space converge on); each style maps to chroma / lightness /
// neutral-temperature decisions; keyword tags layer extra modifiers; an optional
// brand-colour anchors the whole system to a hue you choose. We compose all of
// that into a role-based system (primary / secondary / accent / neutrals) and
// render it as matched LIGHT and DARK themes, with the reason behind each role.
//
// Hues are OKLCH degrees: red≈25 orange≈55 gold≈85 yellow≈100 lime≈125
// green≈150 emerald≈160 teal≈185 cyan≈205 sky≈225 blue≈255 indigo≈272
// violet≈292 purple≈305 magenta≈332 pink≈350.

const INDUSTRIES = [
  { id: 'fintech',     group: 'Finance & Business', label: 'Fintech',          primary: 255, secondary: 275, accent: 150, why: 'Blue signals trust and security — banking\'s default. A green accent reads as growth and money.' },
  { id: 'banking',     group: 'Finance & Business', label: 'Banking',          primary: 250, secondary: 225, accent: 85,  why: 'Deep navy projects stability and heritage; muted gold adds an established, premium feel.' },
  { id: 'insurance',   group: 'Finance & Business', label: 'Insurance',        primary: 250, secondary: 195, accent: 150, why: 'Blue and teal together feel secure and reassuring — protection without coldness.' },
  { id: 'consulting',  group: 'Finance & Business', label: 'Consulting',       primary: 255, secondary: 205, accent: 85,  why: 'Authoritative navy with a restrained gold accent reads as expertise and confidence.' },
  { id: 'crypto',      group: 'Finance & Business', label: 'Crypto / Web3',    primary: 272, secondary: 45,  accent: 205, why: 'Indigo + Bitcoin-orange feels futuristic and decentralised.' },
  { id: 'accounting',  group: 'Finance & Business', label: 'Accounting',       primary: 192, secondary: 250, accent: 150, why: 'Teal and blue read as precise and trustworthy; green hints at balanced books.' },

  { id: 'saas',        group: 'Tech & Software', label: 'SaaS',                primary: 272, secondary: 292, accent: 205, why: 'Indigo–violet conveys innovation and intelligence; electric cyan keeps it modern.' },
  { id: 'ai',          group: 'Tech & Software', label: 'AI / ML',             primary: 292, secondary: 272, accent: 332, why: 'Violet and magenta signal intelligence and the futuristic.' },
  { id: 'cyber',       group: 'Tech & Software', label: 'Cybersecurity',       primary: 255, secondary: 150, accent: 25,  why: 'Deep blue = protection; green = "secure"; a red accent flags threats.' },
  { id: 'devtools',    group: 'Tech & Software', label: 'Developer Tools',     primary: 272, secondary: 205, accent: 125, why: 'Indigo with a terminal-green accent — built by and for engineers.' },
  { id: 'cloud',       group: 'Tech & Software', label: 'Cloud / Infra',       primary: 205, secondary: 225, accent: 255, why: 'Light, airy blues evoke the sky and scalable infrastructure.' },
  { id: 'hardware',    group: 'Tech & Software', label: 'Hardware',            primary: 225, secondary: 250, accent: 25,  why: 'Cool steel-blue feels precise and engineered; a red accent adds power.' },

  { id: 'healthcare',  group: 'Health & Wellness', label: 'Healthcare',        primary: 192, secondary: 222, accent: 150, why: 'Teal/cyan is clean and clinical yet calming; green suggests vitality.' },
  { id: 'mentalhealth',group: 'Health & Wellness', label: 'Mental Health',     primary: 150, secondary: 185, accent: 85,  why: 'Soft greens and teals soothe; a warm accent keeps it human and hopeful.' },
  { id: 'pharma',      group: 'Health & Wellness', label: 'Pharma',            primary: 250, secondary: 192, accent: 150, why: 'Clinical blue + teal communicate science, safety and trust.' },
  { id: 'fitness',     group: 'Health & Wellness', label: 'Fitness',           primary: 28,  secondary: 50,  accent: 125, why: 'Energetic reds and oranges drive intensity; a lime accent injects momentum.' },
  { id: 'wellness',    group: 'Health & Wellness', label: 'Wellness / Spa',    primary: 150, secondary: 85,  accent: 350, why: 'Sage green with warm blush reads as serene, natural and restorative.' },
  { id: 'dental',      group: 'Health & Wellness', label: 'Dental',            primary: 205, secondary: 225, accent: 150, why: 'Fresh cyan and blue feel hygienic and clean; green reinforces health.' },

  { id: 'restaurant',  group: 'Food & Drink', label: 'Restaurant',            primary: 30,  secondary: 58,  accent: 150, why: 'Warm red and orange stimulate appetite; a green accent signals fresh.' },
  { id: 'coffee',      group: 'Food & Drink', label: 'Coffee',                primary: 50,  secondary: 30,  accent: 85,  why: 'Roasted browns and amber feel warm, artisanal and cosy.' },
  { id: 'bakery',      group: 'Food & Drink', label: 'Bakery',                primary: 55,  secondary: 30,  accent: 350, why: 'Warm cream and caramel with a soft pink read as sweet and inviting.' },
  { id: 'organic',     group: 'Food & Drink', label: 'Organic / Healthy',     primary: 125, secondary: 150, accent: 85,  why: 'Earthy greens with amber signal natural, wholesome ingredients.' },
  { id: 'brewery',     group: 'Food & Drink', label: 'Brewery',               primary: 55,  secondary: 30,  accent: 85,  why: 'Copper and amber feel craft, hoppy and characterful.' },
  { id: 'fastfood',    group: 'Food & Drink', label: 'Fast Food',             primary: 25,  secondary: 100, accent: 55,  why: 'Red + yellow is the appetite-and-urgency combo of the category.' },

  { id: 'fashion',     group: 'Retail & Lifestyle', label: 'Fashion',         primary: 332, secondary: 305, accent: 25,  why: 'Chic magenta and purple feel current and expressive; a red accent adds edge.' },
  { id: 'luxury',      group: 'Retail & Lifestyle', label: 'Luxury',          primary: 305, secondary: 320, accent: 85,  why: 'Deep purple carries prestige; muted gold reads as quiet wealth.' },
  { id: 'beauty',      group: 'Retail & Lifestyle', label: 'Beauty',          primary: 350, secondary: 332, accent: 305, why: 'Soft pinks and magentas read as indulgent; a violet accent adds romance.' },
  { id: 'jewelry',     group: 'Retail & Lifestyle', label: 'Jewelry',         primary: 305, secondary: 85,  accent: 350, why: 'Regal purple with gold feels opulent and precious.' },
  { id: 'home',        group: 'Retail & Lifestyle', label: 'Home / Interior', primary: 55,  secondary: 150, accent: 85,  why: 'Warm neutrals with sage and amber read as cosy, lived-in and tasteful.' },
  { id: 'ecommerce',   group: 'Retail & Lifestyle', label: 'E-commerce',      primary: 255, secondary: 225, accent: 28,  why: 'Trustworthy blue base with a high-energy orange CTA that drives conversion.' },

  { id: 'gaming',      group: 'Media & Entertainment', label: 'Gaming',       primary: 292, secondary: 205, accent: 332, why: 'Neon violet and cyan feel immersive and competitive.' },
  { id: 'music',       group: 'Media & Entertainment', label: 'Music',        primary: 332, secondary: 272, accent: 55,  why: 'Vivid magenta and violet feel expressive and energetic.' },
  { id: 'film',        group: 'Media & Entertainment', label: 'Film / Video', primary: 25,  secondary: 255, accent: 85,  why: 'Cinematic red and gold evoke the theatre and the red carpet.' },
  { id: 'podcast',     group: 'Media & Entertainment', label: 'Podcast',      primary: 292, secondary: 332, accent: 55,  why: 'Purple with a warm accent feels intimate, modern and on-air.' },
  { id: 'social',      group: 'Media & Entertainment', label: 'Social Media', primary: 255, secondary: 332, accent: 55,  why: 'Friendly blue with pink and warm accents feels vibrant and approachable.' },
  { id: 'news',        group: 'Media & Entertainment', label: 'News',         primary: 255, secondary: 25,  accent: 85,  why: 'Authoritative navy with a red accent reads as serious and credible.' },

  { id: 'eco',         group: 'Nature & Sustainability', label: 'Eco',         primary: 150, secondary: 125, accent: 85,  why: 'Green is the universal cue for nature; an earthy amber grounds it.' },
  { id: 'agriculture', group: 'Nature & Sustainability', label: 'Agriculture', primary: 125, secondary: 85,  accent: 55,  why: 'Crop-green with wheat and soil tones reads as growth from the land.' },
  { id: 'outdoor',     group: 'Nature & Sustainability', label: 'Outdoor',     primary: 160, secondary: 185, accent: 55,  why: 'Forest and sky with a sunset accent feel adventurous and rugged.' },
  { id: 'renewable',   group: 'Nature & Sustainability', label: 'Renewable',   primary: 150, secondary: 205, accent: 100, why: 'Green + sky-blue + sun-yellow communicate clean, optimistic energy.' },
  { id: 'pets',        group: 'Nature & Sustainability', label: 'Pets / Vet',  primary: 55,  secondary: 205, accent: 125, why: 'Warm friendly tones with caring blue feel playful and trustworthy.' },
  { id: 'gardening',   group: 'Nature & Sustainability', label: 'Gardening',   primary: 150, secondary: 125, accent: 350, why: 'Leaf-green with a bloom-pink accent celebrates growth and flowering.' },

  { id: 'travel',      group: 'Travel & Hospitality', label: 'Travel',         primary: 190, secondary: 222, accent: 58,  why: 'Sea-teal and sky-blue evoke escape; a sunset-orange accent adds adventure.' },
  { id: 'hotel',       group: 'Travel & Hospitality', label: 'Hotel / Resort', primary: 225, secondary: 85,  accent: 305, why: 'Calm blue with gold reads as refined, comfortable hospitality.' },
  { id: 'realestate',  group: 'Travel & Hospitality', label: 'Real Estate',    primary: 255, secondary: 185, accent: 85,  why: 'Navy with teal and gold projects reliability and aspirational value.' },
  { id: 'automotive',  group: 'Travel & Hospitality', label: 'Automotive',     primary: 225, secondary: 250, accent: 25,  why: 'Steel-blue feels engineered; a red accent signals performance.' },
  { id: 'logistics',   group: 'Travel & Hospitality', label: 'Logistics',      primary: 255, secondary: 55,  accent: 150, why: 'Dependable blue with an orange accent reads as fast and reliable.' },
  { id: 'aviation',    group: 'Travel & Hospitality', label: 'Aviation',       primary: 255, secondary: 205, accent: 25,  why: 'Sky-blue conveys trust and motion; a red accent adds speed and alert.' },

  { id: 'education',   group: 'Education & Society', label: 'Education',        primary: 250, secondary: 55,  accent: 332, why: 'Friendly blue with warm and playful accents feels open and encouraging.' },
  { id: 'kids',        group: 'Education & Society', label: 'Kids / Toys',      primary: 205, secondary: 55,  accent: 350, why: 'Bright primaries across the wheel feel playful and stimulating for kids.' },
  { id: 'university',  group: 'Education & Society', label: 'University',        primary: 255, secondary: 25,  accent: 85,  why: 'Navy with crimson and gold reads as traditional, prestigious and academic.' },
  { id: 'nonprofit',   group: 'Education & Society', label: 'Nonprofit',        primary: 150, secondary: 205, accent: 55,  why: 'Hopeful green and blue with a warm accent feel caring and trustworthy.' },
  { id: 'science',     group: 'Education & Society', label: 'Science',          primary: 272, secondary: 205, accent: 150, why: 'Indigo and cyan with green suggest discovery, data and the lab.' },
  { id: 'books',       group: 'Education & Society', label: 'Books / Library',  primary: 30,  secondary: 255, accent: 150, why: 'Warm paper tones with ink-blue feel literary, calm and considered.' },

  { id: 'agency',      group: 'Creative & Services', label: 'Design Agency',   primary: 292, secondary: 332, accent: 55,  why: 'Bold violet and magenta signal creativity and confidence.' },
  { id: 'photography', group: 'Creative & Services', label: 'Photography',     primary: 250, secondary: 250, accent: 25,  why: 'Near-monochrome neutrals let the imagery lead; one warm accent for life.' },
  { id: 'architecture',group: 'Creative & Services', label: 'Architecture',    primary: 250, secondary: 85,  accent: 25,  why: 'Slate with warm stone tones reads as structural, minimal and crafted.' },
  { id: 'legal',       group: 'Creative & Services', label: 'Legal',           primary: 250, secondary: 85,  accent: 185, why: 'Navy with gold projects authority, tradition and discretion.' },
  { id: 'wedding',     group: 'Creative & Services', label: 'Wedding / Events',primary: 350, secondary: 305, accent: 85,  why: 'Blush and soft purple with gold read as romantic and celebratory.' },
  { id: 'construction',group: 'Creative & Services', label: 'Construction',    primary: 55,  secondary: 225, accent: 25,  why: 'Safety-orange with steel-blue feels industrial, sturdy and high-visibility.' },
]

const STYLES = [
  // Foundational
  { id: 'minimal',   group: 'Foundational', label: 'Minimal',   chromaMul: 0.55, accentBoost: 1.5, neutralC: 0.004, neutralH: 250, lBias: 0,     why: 'Low saturation, one decisive accent.' },
  { id: 'corporate', group: 'Foundational', label: 'Trust',     chromaMul: 0.8,  accentBoost: 1.1, neutralC: 0.012, neutralH: 250, lBias: 0,     why: 'Confident mid-saturation, cool greys.' },
  { id: 'playful',   group: 'Foundational', label: 'Playful',   chromaMul: 1.3,  accentBoost: 1.1, neutralC: 0.02,  neutralH: 60,  lBias: 0.05,  why: 'High chroma, lighter, upbeat.' },
  { id: 'bold',      group: 'Foundational', label: 'Bold',      chromaMul: 1.55, accentBoost: 1.2, neutralC: 0.01,  neutralH: 250, lBias: -0.02, why: 'Max saturation, strong contrast.' },
  { id: 'elegant',   group: 'Foundational', label: 'Elegant',   chromaMul: 0.7,  accentBoost: 1.2, neutralC: 0.01,  neutralH: 60,  lBias: 0,     why: 'Restrained chroma, warm neutrals.' },
  { id: 'earthy',    group: 'Foundational', label: 'Earthy',    chromaMul: 0.7,  accentBoost: 1.0, neutralC: 0.018, neutralH: 70,  lBias: 0,     why: 'Muted, organic, warm greys.' },
  { id: 'pastel',    group: 'Foundational', label: 'Pastel',    chromaMul: 0.5,  accentBoost: 1.0, neutralC: 0.008, neutralH: 320, lBias: 0.12,  why: 'Soft, light tints.' },
  { id: 'mono',      group: 'Foundational', label: 'Mono',      chromaMul: 0.85, accentBoost: 1.3, neutralC: 0.01,  neutralH: 250, lBias: 0,     mono: true, why: 'One hue across the whole system.' },

  // Design era
  { id: 'y2k',       group: 'Design era', label: 'Y2K',         chromaMul: 1.4,  accentBoost: 1.2, neutralC: 0.012, neutralH: 205, lBias: 0.05,  why: 'Glossy cyan/silver 2000s optimism.' },
  { id: 'memphis',   group: 'Design era', label: '80s Memphis', chromaMul: 1.45, accentBoost: 1.15,neutralC: 0.02,  neutralH: 60,  lBias: 0.04,  why: 'Bright, clashing 80s playfulness.' },
  { id: 'grunge',    group: 'Design era', label: '90s Grunge',  chromaMul: 0.65, accentBoost: 1.0, neutralC: 0.022, neutralH: 70,  lBias: -0.04, why: 'Muted, gritty, washed-out 90s.' },
  { id: 'midcentury',group: 'Design era', label: 'Mid-century', chromaMul: 0.85, accentBoost: 1.0, neutralC: 0.018, neutralH: 65,  lBias: -0.02, why: 'Mustard/teal/rust warmth.' },
  { id: 'vaporwave', group: 'Design era', label: 'Vaporwave',   chromaMul: 1.35, accentBoost: 1.2, neutralC: 0.012, neutralH: 320, lBias: 0.04,  why: 'Pink/cyan retro-futurist haze.' },
  { id: 'artdeco',   group: 'Design era', label: 'Art Deco',    chromaMul: 0.8,  accentBoost: 1.2, neutralC: 0.01,  neutralH: 60,  lBias: -0.02, why: 'Gold-leaning 1920s opulence.' },

  // UI trend
  { id: 'glass',     group: 'UI trend', label: 'Glassmorphism', chromaMul: 0.7,  accentBoost: 1.1, neutralC: 0.006, neutralH: 250, lBias: 0.1,   why: 'Light, translucent, airy.' },
  { id: 'neumorph',  group: 'UI trend', label: 'Neumorphism',   chromaMul: 0.4,  accentBoost: 1.0, neutralC: 0.006, neutralH: 250, lBias: 0.08,  why: 'Soft monochrome, low contrast.' },
  { id: 'brutalist', group: 'UI trend', label: 'Brutalist',     chromaMul: 1.5,  accentBoost: 1.3, neutralC: 0.0,   neutralH: 250, lBias: 0,     why: 'Raw, max contrast, pure neutrals.' },
  { id: 'flat',      group: 'UI trend', label: 'Flat',          chromaMul: 1.1,  accentBoost: 1.1, neutralC: 0.01,  neutralH: 250, lBias: 0.02,  why: 'Clean, flat-design colour.' },
  { id: 'material',  group: 'UI trend', label: 'Material',      chromaMul: 1.0,  accentBoost: 1.1, neutralC: 0.012, neutralH: 250, lBias: 0,     why: 'Defined, layered Material tones.' },
  { id: 'clay',      group: 'UI trend', label: 'Claymorphism',  chromaMul: 1.05, accentBoost: 1.0, neutralC: 0.01,  neutralH: 320, lBias: 0.06,  why: 'Soft, rounded, pastel clay.' },

  // Tonal / finish
  { id: 'muted',     group: 'Tonal', label: 'Muted',           chromaMul: 0.6,  accentBoost: 1.0, neutralC: 0.014, neutralH: 70,  lBias: 0,     why: 'Dialled-back saturation throughout.' },
  { id: 'washed',    group: 'Tonal', label: 'Washed',          chromaMul: 0.45, accentBoost: 1.0, neutralC: 0.01,  neutralH: 250, lBias: 0.1,   why: 'Faded, sun-washed light tones.' },
  { id: 'highcon',   group: 'Tonal', label: 'High contrast',   chromaMul: 1.25, accentBoost: 1.2, neutralC: 0.0,   neutralH: 250, lBias: 0,     why: 'Punchy, accessible contrast.' },
  { id: 'monopop',   group: 'Tonal', label: 'Mono + pop',      chromaMul: 0.5,  accentBoost: 1.9, neutralC: 0.008, neutralH: 250, lBias: 0,     why: 'Greyscale system with one vivid pop.' },
  { id: 'neon',      group: 'Tonal', label: 'Neon',            chromaMul: 1.6,  accentBoost: 1.3, neutralC: 0.012, neutralH: 272, lBias: 0.05,  why: 'Glowing high-chroma hues.' },
  { id: 'retro',     group: 'Tonal', label: 'Retro 70s',       chromaMul: 0.95, accentBoost: 1.0, neutralC: 0.022, neutralH: 70,  lBias: -0.02, why: 'Warm, slightly muted 70s.' },
]

const TAGS = [
  { id: 'trustworthy', label: 'Trustworthy', cMul: 0.9,  neutralH: 250 },
  { id: 'luxurious',   label: 'Luxurious',   cMul: 0.85, lBias: -0.02, neutralH: 60 },
  { id: 'playful',     label: 'Playful',     cMul: 1.2,  lBias: 0.04 },
  { id: 'energetic',   label: 'Energetic',   cMul: 1.25, accentBoost: 1.15 },
  { id: 'calm',        label: 'Calm',        cMul: 0.8,  lBias: 0.03 },
  { id: 'bold',        label: 'Bold',        cMul: 1.3 },
  { id: 'soft',        label: 'Soft',        cMul: 0.7,  lBias: 0.05 },
  { id: 'organic',     label: 'Organic',     cMul: 0.8,  hueShift: 8, neutralH: 70 },
  { id: 'vintage',     label: 'Vintage',     cMul: 0.85, hueShift: 6, neutralH: 70 },
  { id: 'vibrant',     label: 'Vibrant',     cMul: 1.3,  accentBoost: 1.1 },
  { id: 'premium',     label: 'Premium',     cMul: 0.8,  lBias: -0.02, neutralH: 60 },
  { id: 'friendly',    label: 'Friendly',    cMul: 1.1,  lBias: 0.03, neutralH: 60 },
  { id: 'techy',       label: 'Techy',       cMul: 1.1,  neutralH: 250 },
  { id: 'minimal',     label: 'Minimal',     cMul: 0.6,  accentBoost: 1.3 },
]

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const normH = h => ((h % 360) + 360) % 360
const clampC = v => clamp(v, 0, 0.34)

function combineTags(style, tagIds) {
  const m = { cMul: style.chromaMul, lBias: style.lBias, accentBoost: style.accentBoost, neutralH: style.neutralH, neutralC: style.neutralC, hueShift: 0 }
  for (const id of tagIds) {
    const t = TAGS.find(x => x.id === id); if (!t) continue
    if (t.cMul) m.cMul *= t.cMul
    if (t.lBias) m.lBias += t.lBias
    if (t.accentBoost) m.accentBoost *= t.accentBoost
    if (t.hueShift) m.hueShift += t.hueShift
    if (t.neutralH != null) m.neutralH = t.neutralH
    if (t.neutralC != null) m.neutralC = t.neutralC
  }
  return m
}

// The colour *identity* of the system: hue/chroma/base-lightness for the three
// chromatic roles. Locked roles are pinned; everything else follows the seed.
function computeIdentities({ industry, style, tags, brand, seed, variance, locks }) {
  const rng = mulberry32(seed * 2654435761 + (variance === 'wild' ? 99173 : 0))
  const m = combineTags(style, tags)
  const range = variance === 'wild'
    ? { h: 110, c: 0.5, l: 0.12 }
    : { h: 36, c: 0.22, l: 0.05 }
  const jH = () => (rng() - 0.5) * range.h
  const jC = () => 1 + (rng() - 0.5) * range.c
  const jL = () => (rng() - 0.5) * range.l
  const C = base => clampC(base * m.cMul)

  let pH = industry.primary, sH = industry.secondary, aH = industry.accent
  if (style.mono) { sH = pH; aH = pH }
  if (brand) { const os = sH - pH, oa = aH - pH; pH = brand.h; sH = brand.h + os; aH = brand.h + oa }
  pH += m.hueShift; sH += m.hueShift; aH += m.hueShift

  const ids = {
    primary:   { name: 'Primary',   h: pH + jH(), c: clampC(C(0.15) * jC()),                        baseL: clamp(0.55 + m.lBias + jL(), 0.25, 0.7) },
    secondary: { name: 'Secondary', h: sH + jH(), c: clampC(C(style.mono ? 0.1 : 0.12) * jC()),     baseL: clamp((style.mono ? 0.7 : 0.6) + m.lBias + jL(), 0.3, 0.78) },
    accent:    { name: 'Accent',    h: aH + jH(), c: clampC(C(0.16) * m.accentBoost * jC()),         baseL: clamp(0.62 + m.lBias + jL(), 0.35, 0.8) },
  }
  if (brand) ids.primary = { ...ids.primary, h: brand.h, c: brand.c, baseL: clamp(brand.l, 0.25, 0.72) }
  for (const k of ['primary', 'secondary', 'accent']) if (locks[k]) ids[k] = { ...ids[k], ...locks[k] }
  return { ids, m }
}

const CHROMA_REASON = {
  primary:   'Brand anchor — headers, primary buttons, key surfaces.',
  secondary: 'Supports the primary — secondary actions, section fills.',
  accent:    'High-energy highlight — CTAs, links, focus. Use sparingly.',
}

// Render the identity onto a light or dark neutral set → 7 role swatches.
function renderTheme(ids, m, dark) {
  const chroma = ['primary', 'secondary', 'accent'].map(key => {
    const id = ids[key]
    const L = dark ? clamp(id.baseL + 0.1, 0.3, 0.85) : id.baseL
    return { key, name: id.name, chromatic: true, hex: oklchToHex(L, id.c, normH(id.h)), reason: CHROMA_REASON[key] }
  })
  const N = (l, c) => oklchToHex(l, c, normH(m.neutralH))
  const neutrals = [
    { key: 'text',       name: 'Text',       chromatic: false, hex: N(dark ? 0.93 : 0.22, m.neutralC),        reason: 'Body copy — tuned for contrast on the background.' },
    { key: 'muted',      name: 'Muted',      chromatic: false, hex: N(dark ? 0.55 : 0.6,  m.neutralC),        reason: 'Borders, dividers, placeholder & disabled states.' },
    { key: 'surface',    name: 'Surface',    chromatic: false, hex: N(dark ? 0.21 : 0.965, m.neutralC * 0.7), reason: 'Cards and raised panels above the background.' },
    { key: 'background', name: 'Background', chromatic: false, hex: N(dark ? 0.15 : 0.99,  m.neutralC * 0.5),  reason: 'Page background — the canvas everything sits on.' },
  ]
  return [...chroma, ...neutrals]
}

const GROUPS = INDUSTRIES.reduce((mp, i) => { (mp[i.group] ||= []).push(i); return mp }, {})
const STYLE_GROUPS = STYLES.reduce((mp, s) => { (mp[s.group] ||= []).push(s); return mp }, {})

function isLightHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55
}

export default function Recipes() {
  const { swatches, active } = usePalette()
  const activeHex = swatches.find(s => s.id === active)?.hex

  const [indId, setIndId] = useState('fintech')
  const [styleId, setStyleId] = useState('corporate')
  const [tags, setTags] = useState([])
  const [brandHex, setBrandHex] = useState('')
  const [locks, setLocks] = useState({})
  const [seed, setSeed] = useState(1)
  const [variance, setVariance] = useState('subtle')
  const [preview, setPreview] = useState('light')

  const industry = INDUSTRIES.find(i => i.id === indId)
  const style = STYLES.find(s => s.id === styleId)
  const indIdx = INDUSTRIES.findIndex(i => i.id === indId)
  const styleIdx = STYLES.findIndex(s => s.id === styleId)

  const brand = useMemo(() => {
    if (!brandHex || !parseColor(brandHex)) return null
    const o = toOklch(brandHex)
    return { h: o.h, c: o.c, l: o.l }
  }, [brandHex])

  const { ids, m } = useMemo(
    () => computeIdentities({ industry, style, tags, brand, seed, variance, locks }),
    [industry, style, tags, brand, seed, variance, locks]
  )
  const light = useMemo(() => renderTheme(ids, m, false), [ids, m])
  const dark  = useMemo(() => renderTheme(ids, m, true),  [ids, m])
  const themeRoles = preview === 'light' ? light : dark
  const role = k => themeRoles.find(r => r.key === k)
  const bg = role('background').hex
  const textHex = role('text').hex
  const textContrast = contrast(textHex, bg)

  function stepIndustry(d) { setIndId(INDUSTRIES[(indIdx + d + INDUSTRIES.length) % INDUSTRIES.length].id) }
  function stepStyleSel(d) { setStyleId(STYLES[(styleIdx + d + STYLES.length) % STYLES.length].id) }
  function toggleTag(id) { setTags(t => t.includes(id) ? t.filter(x => x !== id) : [...t, id]) }
  function vary(v) { setVariance(v); setSeed(s => s + 1) }
  function toggleLock(key) {
    setLocks(prev => {
      const n = { ...prev }
      if (n[key]) delete n[key]
      else n[key] = { h: ids[key].h, c: ids[key].c, baseL: ids[key].baseL }
      return n
    })
  }
  function useActive() { if (activeHex) setBrandHex(activeHex) }
  function addSystem(roles, suffix) {
    for (const r of roles) {
      const role = r.key === 'primary' ? 'main'
        : r.key === 'accent' ? 'accent'
        : r.key === 'background' ? (suffix === 'Dark' ? 'black' : 'white')
        : r.key === 'text' ? (suffix === 'Dark' ? 'white' : 'black')
        : 'freeform'
      addSwatch(r.hex, role, { name: `${r.name} ${suffix}` })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Pickers ──────────────────────────────────────────────────────────── */}
      <Picker label="Industry" hint={`${indIdx + 1} / ${INDUSTRIES.length} · ${industry.group}`}>
        <button onClick={() => stepIndustry(-1)} style={stepStyle} title="Previous">‹</button>
        <select value={indId} onChange={e => setIndId(e.target.value)} onWheel={e => stepIndustry(e.deltaY > 0 ? 1 : -1)} style={{ ...selectStyle, flex: 1 }}>
          {Object.entries(GROUPS).map(([g, items]) => (
            <optgroup key={g} label={g}>{items.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}</optgroup>
          ))}
        </select>
        <button onClick={() => stepIndustry(1)} style={stepStyle} title="Next">›</button>
      </Picker>

      <Picker label="Style" hint={`${style.group}`}>
        <button onClick={() => stepStyleSel(-1)} style={stepStyle} title="Previous">‹</button>
        <select value={styleId} onChange={e => setStyleId(e.target.value)} onWheel={e => stepStyleSel(e.deltaY > 0 ? 1 : -1)} style={{ ...selectStyle, flex: 1 }}>
          {Object.entries(STYLE_GROUPS).map(([g, items]) => (
            <optgroup key={g} label={g}>{items.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>
          ))}
        </select>
        <button onClick={() => stepStyleSel(1)} style={stepStyle} title="Next">›</button>
      </Picker>

      {/* ── Brand-colour seed ────────────────────────────────────────────────── */}
      <div>
        <div style={labelRow}>Brand color <span style={{ color: '#3d3d4a' }}>{brand ? 'anchored' : 'optional'}</span></div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'stretch' }}>
          <span style={{ width: 28, borderRadius: 5, border: '1px solid #2a2a38', background: brand ? brandHex : 'transparent', flexShrink: 0 }} />
          <input value={brandHex} onChange={e => setBrandHex(e.target.value)} placeholder="#3a7bff" style={{ ...selectStyle, flex: 1, fontFamily: 'monospace' }} />
          <button onClick={useActive} disabled={!activeHex} style={{ ...stepStyle, width: 'auto', padding: '0 8px', fontSize: 10, color: activeHex ? '#9d7dea' : '#444' }} title="Use active swatch">Active</button>
          {brandHex && <button onClick={() => setBrandHex('')} style={{ ...stepStyle, width: 28 }} title="Clear"><Icon name="close" size={12} /></button>}
        </div>
      </div>

      {/* ── Keyword tags ─────────────────────────────────────────────────────── */}
      <div>
        <div style={labelRow}>Keywords {tags.length > 0 && <span style={{ color: '#3d3d4a' }}>{tags.length} active</span>}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {TAGS.map(t => {
            const on = tags.includes(t.id)
            return (
              <button key={t.id} onClick={() => toggleTag(t.id)} style={{
                background: on ? '#2d1a5e' : '#131318', border: `1px solid ${on ? '#6d3fbe' : '#222230'}`,
                borderRadius: 12, color: on ? '#c4b5fd' : '#666', padding: '3px 9px', fontSize: 10, cursor: 'pointer',
              }}>{t.label}</button>
            )
          })}
        </div>
      </div>

      <div style={{ fontSize: 10, color: '#7a7a8a', lineHeight: 1.5 }}>{industry.why} <span style={{ color: '#555' }}>· {style.why}</span></div>

      {/* ── Variation buttons ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6 }}>
        <VaryBtn onClick={() => vary('subtle')} primary>⚄ Vary</VaryBtn>
        <VaryBtn onClick={() => vary('wild')}>✦ Surprise me</VaryBtn>
      </div>

      {/* ── Matched light + dark palettes (colours are the focus) ─────────────── */}
      <ThemeStrip title="Light" roles={light} locks={locks} onLock={toggleLock} />
      <ThemeStrip title="Dark"  roles={dark}  locks={locks} onLock={toggleLock} />
      <div style={{ fontSize: 9, color: '#3d3d4a' }}>Click Primary / Secondary / Accent to lock — Vary keeps locked colors.</div>

      <div style={{ display: 'flex', gap: 6 }}>
        <AddBtn onClick={() => addSystem(light, 'Light')}>+ Add light</AddBtn>
        <AddBtn onClick={() => addSystem(dark, 'Dark')}>+ Add dark</AddBtn>
      </div>

      {/* ── Live mockup with light/dark toggle ───────────────────────────────── */}
      <Section label="In context" hint={`text ${textContrast.toFixed(1)}:1`}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 2 }}>
          {['light', 'dark'].map(p => (
            <button key={p} onClick={() => setPreview(p)} style={{
              flex: 1, background: preview === p ? '#2d1a5e' : '#131318', border: `1px solid ${preview === p ? '#6d3fbe' : '#222230'}`,
              borderRadius: 5, color: preview === p ? '#c4b5fd' : '#666', padding: '4px 0', fontSize: 10, cursor: 'pointer', textTransform: 'capitalize',
            }}>{p}</button>
          ))}
        </div>
        <div style={{ background: bg, borderRadius: 8, padding: 16, border: '1px solid #222230' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: role('primary').hex }} />
            <span style={{ color: textHex, fontSize: 14, fontWeight: 700, flex: 1 }}>Aa Brand</span>
            <span style={{ color: role('muted').hex, fontSize: 11 }}>Home</span>
            <span style={{ color: role('muted').hex, fontSize: 11 }}>Pricing</span>
          </div>
          <div style={{ background: role('surface').hex, borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ color: textHex, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Card title</div>
            <div style={{ color: role('muted').hex, fontSize: 11, lineHeight: 1.5 }}>Supporting copy sits on a raised surface above the page background.</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ background: role('primary').hex, color: bg, fontSize: 11, fontWeight: 600, padding: '6px 14px', borderRadius: 6 }}>Primary</span>
            <span style={{ background: role('accent').hex, color: bg, fontSize: 11, fontWeight: 600, padding: '6px 14px', borderRadius: 6 }}>Get started</span>
            <span style={{ border: `1px solid ${role('secondary').hex}`, color: role('secondary').hex, fontSize: 11, fontWeight: 600, padding: '5px 13px', borderRadius: 6 }}>Learn more</span>
          </div>
        </div>
      </Section>
    </div>
  )
}

function ThemeStrip({ title, roles, locks, onLock }) {
  return (
    <div>
      <div style={labelRow}>{title}</div>
      <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', height: 84, border: '1px solid #222230' }}>
        {roles.map(r => {
          const light = isLightHex(r.hex)
          const fg = light ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)'
          const locked = r.chromatic && locks[r.key]
          return (
            <div key={r.key} title={r.reason} onClick={r.chromatic ? () => onLock(r.key) : undefined}
              style={{ flex: 1, background: r.hex, position: 'relative', cursor: r.chromatic ? 'pointer' : 'default' }}>
              {locked && <div style={{ position: 'absolute', top: 5, left: '50%', transform: 'translateX(-50%)' }}><Icon name="lock" size={11} color={fg} /></div>}
              <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, textAlign: 'center', color: fg }}>
                <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.3 }}>{r.name}</div>
                <div style={{ fontSize: 7.5, fontFamily: 'monospace', opacity: 0.85 }}>{r.hex}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Picker({ label, hint, children }) {
  return (
    <div>
      <div style={labelRow}>{label}{hint && <span style={{ color: '#3d3d4a' }}>{hint}</span>}</div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'stretch' }}>{children}</div>
    </div>
  )
}

function VaryBtn({ onClick, children, primary }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, background: primary ? '#1a1030' : '#131318', border: `1px solid ${primary ? '#3d2a7a' : '#222230'}`,
      borderRadius: 6, color: primary ? '#9d7dea' : '#888', padding: '7px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#6d3fbe'; e.currentTarget.style.color = '#c4b5fd' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = primary ? '#3d2a7a' : '#222230'; e.currentTarget.style.color = primary ? '#9d7dea' : '#888' }}
    >{children}</button>
  )
}

function AddBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, background: '#1a1030', border: '1px solid #3d2a7a', borderRadius: 6,
      color: '#9d7dea', padding: '8px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = '#2d1a5e'; e.currentTarget.style.color = '#c4b5fd' }}
      onMouseLeave={e => { e.currentTarget.style.background = '#1a1030'; e.currentTarget.style.color = '#9d7dea' }}
    >{children}</button>
  )
}

const labelRow = { display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }
const selectStyle = { background: '#111118', border: '1px solid #2a2a38', borderRadius: 5, color: '#b0a8d8', padding: '6px 8px', fontSize: 11, outline: 'none', cursor: 'pointer', minWidth: 0 }
const stepStyle = { width: 30, background: '#131318', border: '1px solid #222230', borderRadius: 5, color: '#888', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
