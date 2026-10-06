// Swatch roles are job names (spec §6.1). Any other string is a free "Other" role; null is none.

export const ROLES = ['Background', 'Surface', 'Text', 'Muted', 'Primary', 'Accent', 'Highlight'] as const;
export type Role = (typeof ROLES)[number];

/** what everything else sits on */
export const isGround = (role: string | null): boolean => role === 'Background' || role === 'Surface';

/** a job role that sits on a ground: type, fills, marks */
export const isInk = (role: string | null): boolean => (ROLES as readonly (string | null)[]).includes(role) && !isGround(role);

/** the job a colour's name says it has ("brand-primary", "Page background", "text"), or null: pasted tokens keep their roles */
export function roleOfName(name: string | null): Role | null {
  const words = (name ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const has = (...w: string[]) => w.some((x) => words.includes(x));
  const inkWord = has('text', 'ink', 'foreground', 'fg', 'body', 'copy');
  if (has('on')) return null; // "on-primary" is a colour for type on one, not the Primary
  if (has('highlight', 'marker')) return 'Highlight';
  if (has('muted', 'subtle', 'caption') || (inkWord && has('secondary', 'tertiary'))) return 'Muted';
  if (inkWord) return 'Text';
  if (has('accent', 'secondary')) return 'Accent';
  if (has('primary', 'brand')) return 'Primary';
  if (has('surface', 'card', 'panel')) return 'Surface';
  if (has('background', 'bg', 'page', 'canvas', 'paper')) return 'Background';
  return null;
}
