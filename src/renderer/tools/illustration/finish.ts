// How a material is lit in the Light & preview tab: its finish. Each material has one (gloss, how
// wide its terminator is, how much light it lets through, sheen, grain), and a ramp can override any
// of them (RampSpec.surface). The finish only changes how the picture is lit; the ramp's colours
// come from the material's numbers in shared/palette/ramp.ts. Pure.
import type { MaterialId, RampSpec, SurfaceSpec } from '../../../shared/types.ts';

/** every number 0..1 */
export type Finish = {
  /** 0 matte, 1 mirror-sharp: the size and strength of the highlight */
  gloss: number;
  /** how wide and soft the terminator is (skin, wax and leaves scatter light past it) */
  softness: number;
  /** light through the material: back light glows, the cast shadow thins and takes its colour */
  translucency: number;
  /** a glow at grazing angles, over a darker body (velvet, felt, peach fuzz) */
  sheen: number;
  /** the highlight stretched into a streak (satin, silk, brushed metal) */
  grain: number;
  /** sky fill and ground bounce */
  ambient: number;
  /** the highlight and the reflection take the body's colour, and there is no diffuse light (not an override) */
  metal: number;
  /** the grain's streak runs across the folds instead of along them */
  across: boolean;
};

const finish = (gloss: number, softness: number, translucency: number, sheen: number, grain = 0, metal = 0): Finish => ({ gloss, softness, translucency, sheen, grain, ambient: 0.5, metal, across: false });

// finish(gloss, softness, translucency, sheen, grain, metal)
export const FINISHES: Record<MaterialId, Finish> = {
  skin: finish(0.3, 0.8, 0.25, 0),
  cloth: finish(0.08, 0.35, 0.4, 0.25),
  velvet: finish(0.04, 0.15, 0.12, 1),
  metal: finish(0.85, 0, 0, 0, 0, 1),
  plastic: finish(0.7, 0.05, 0, 0),
  glass: finish(1, 0, 0.15, 0),
  water: finish(0.9, 0.1, 0.3, 0),
  foliage: finish(0.25, 0.55, 0.7, 0.05),
  stone: finish(0.05, 0.05, 0, 0),
  wood: finish(0.3, 0.15, 0, 0, 0.3),
  paper: finish(0.04, 0.3, 0.5, 0),
  fur: finish(0.2, 0.35, 0.1, 0.5, 0.3),
};

/** the finish of a plain ball of nothing in particular: what the preview was before materials had one */
export const DEFAULT_FINISH: Finish = finish(0.4, 0, 0, 0);

/** the finish a ramp has: its material's, with its own Surface numbers over it */
export function finishOf(material: MaterialId, surface?: SurfaceSpec): Finish {
  const base = FINISHES[material] ?? DEFAULT_FINISH;
  return { ...base, ...Object.fromEntries(Object.entries(surface ?? {}).filter(([k, v]) => k in base && typeof v === typeof base[k as keyof Finish])) };
}

/** a ramp's finish, from its spec */
export const finishOfRamp = (r: Pick<RampSpec, 'material' | 'surface'>): Finish => finishOf(r.material, r.surface);

/** the Surface numbers the sliders show, in the order they are listed */
export const SURFACE_SLIDERS = [
  { key: 'gloss', label: 'Gloss', info: 'How sharp and strong the highlight is: 0 is matte, 100 a polished mirror.' },
  { key: 'softness', label: 'Softness', info: 'How wide the edge between light and shadow is. Skin, wax and leaves scatter light past it.' },
  { key: 'translucency', label: 'Translucency', info: 'How much light goes through. Thin cloth, paper, leaves and wax glow when the light is behind them, and throw a paler, tinted shadow.' },
  { key: 'sheen', label: 'Sheen', info: 'A glow at grazing angles over a darker body, like velvet, felt and peach fuzz.' },
  { key: 'grain', label: 'Grain', info: 'Stretches the highlight into a streak, like satin, silk and brushed metal.' },
  { key: 'ambient', label: 'Ambient', info: 'Sky fill and light bounced back from the surround. The Surround colour tints the bounce.' },
] as const satisfies readonly { key: keyof SurfaceSpec & keyof Finish; label: string; info: string }[];

/** true when the ramp has any of its own Surface numbers */
export const hasOverrides = (surface?: SurfaceSpec): boolean => !!surface && Object.keys(surface).length > 0;
