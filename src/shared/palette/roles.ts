// Swatch roles are job names (spec §6.1). Any other string is a free "Other" role; null is none.

export const ROLES = ['Background', 'Surface', 'Text', 'Muted', 'Primary', 'Accent', 'Highlight'] as const;
export type Role = (typeof ROLES)[number];

/** what everything else sits on */
export const isGround = (role: string | null): boolean => role === 'Background' || role === 'Surface';

/** a job role that sits on a ground: type, fills, marks */
export const isInk = (role: string | null): boolean => (ROLES as readonly (string | null)[]).includes(role) && !isGround(role);
