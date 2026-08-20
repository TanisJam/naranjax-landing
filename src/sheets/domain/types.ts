/**
 * Pure description of the artwork. No Three.js, no WebGL, no DOM.
 *
 * The whole piece is four "sheets". A sheet is a lofted surface: an arc
 * cross-section swept along a curved spine, where the arc angle, the arc
 * length and the roll all vary along the sweep. That single model produces
 * both the tight tunnel of the front sheet and the flat, curled wing of the
 * back one — only the numbers change.
 */

/** Parametric shape of the lofted shell. Lengths are in world units. */
export interface SheetShape {
  /** Length of the spine, i.e. the sweep direction (u). */
  length: number
  /** Arc length of the cross-section at u = 0 (v spans this). */
  width: number
  /** Multiplier applied to the arc length at u = 1. Values > 1 flare the tip. */
  tipScale: number
  /** Arc sweep angle in radians at u = 0. Larger = tighter tunnel. */
  angleStart: number
  /** Arc sweep angle in radians at u = 1. Near 0 = flat plate. */
  angleEnd: number
  /**
   * Where along the arc (in v) the crown sits at u = 0. 0.5 is a symmetric
   * vault.
   */
  crownStart: number
  /**
   * Crown position at u = 1. Pushing it off the sheet (towards 0 or below) is
   * what lifts one edge into a wave crest — a roll cannot do this, it just
   * twists the whole body.
   */
  crownEnd: number
  /** Roll of the cross-section frame around the spine at u = 0, in radians. */
  rollStart: number
  /** Roll at u = 1. The difference is what produces the twisted crest. */
  rollEnd: number
  /** Vertical rise of the spine tail. Drives the wave-crest lift. */
  lift: number
  /** Lateral bow of the spine, peaking mid-sweep. */
  bow: number
  /**
   * How far the tail rolls back on itself, in radians of turn.
   *
   * The difference between a sheet that is lying there and a sheet that is
   * being LIFTED. Every other control here bends the cross-section — the arc
   * opens, the crown migrates, the frame rolls — and all of that happens across
   * the width while the spine stays straight. A peel is the spine itself
   * turning, which is the one deformation the loft could not express and the
   * one the reference render is full of: films caught mid-lift, curling off the
   * stack with a hinge partway along them.
   *
   * Bounded in practice by the gap between layers rather than by the model. The
   * turn is spread over `SHEET_PEEL_REACH` of the sweep, so the tip rises by
   * (1 - cos(peel)) * reach * length / peel — about 0.28 at a turn of 0.9 on
   * this card, against a 0.31 layer gap. Past that a peeled sheet climbs into
   * its neighbour.
   *
   * Scaled by the same curl the lift and roll answer to, so the whole stack
   * flattens into a card when it closes.
   */
  peel: number
  /** Total plate thickness. The bullnose edge radius is half of this. */
  thickness: number
  /**
   * Corner rounding, as a fraction of the SHORT side, 0..0.5.
   *
   * Measured against the short side rather than each axis independently, so a
   * card-proportioned plate gets circular corners instead of elliptical ones.
   * This is what separates a card from a slab, and nothing else in the model
   * can fake it — a bevel rounds the edge in profile, not in plan.
   */
  cornerRadius: number
  /** Number of ribs across the arc. 0 disables the corrugation. */
  ribFrequency: number
  /** Rib displacement amplitude along the surface normal. */
  ribAmplitude: number
  /**
   * Interior grid resolution.
   *
   * `v` is driven by the arc and by `ribFrequency`: geometric ribs need the
   * frequency to divide the sample count exactly, or the undersampled sinusoid
   * beats against the grid and fakes a much coarser pattern.
   *
   * `u` can stay tiny while the sheet is a pure cylinder. With `angleStart`
   * equal to `angleEnd` and no lift or bow, the sweep is a straight extrusion of
   * an unchanging section — there is nothing along it to resolve beyond the
   * bevel bands, which get their own segments. Raise `u` only when the spine
   * bends or the section varies along it.
   */
  tessellation: { u: number; v: number }
}

/**
 * The families of structure a ply can be woven or printed with.
 *
 * A set rather than a pile of independent switches, because a sheet is woven
 * ONE way — these are alternatives, and naming them as alternatives is what
 * keeps a layer from being handed two contradictory structures at once.
 *
 * They are not six arbitrary patterns either. Three are textile and read as a
 * ladder of coarseness — `plain` is the simplest cloth there is, `twill` puts
 * the same threads on a diagonal, `herringbone` reverses that diagonal into a
 * chevron. `waffle` is the pique that carries relief rather than pattern.
 * `guilloche` is the odd one out on purpose: it is not cloth at all but engine
 * turning, the ruling a banknote or a share certificate is printed with, and it
 * belongs to the foils for the same reason the engraved borders do.
 * `micro-dot` is the halftone the polyester ply already wore.
 *
 * All six are procedural. That is the point of doing this here rather than in a
 * canvas: a weave drawn into a texture is a weave with a resolution, and the
 * detail view magnifies a plate roughly six times.
 */
export type WeavePattern =
  | 'none'
  | 'micro-dot'
  | 'plain'
  | 'twill'
  | 'herringbone'
  | 'waffle'
  | 'guilloche'

/**
 * Cell aspect that comes out square, i.e. the plate's own proportion.
 *
 * ID-1 is 85.6 by 53.98 mm. A `weaveStretch` at this value gives a cell as wide
 * as it is tall; below it the cell stretches along the sweep.
 */
export const PLATE_ASPECT = 1.586

/** How the shell scatters light. Colors are hex strings in sRGB. */
export interface SheetSurface {
  colorA: string
  colorB: string
  /** Weights that build the gradient parameter t from (u, v, worldY). */
  gradient: { bias: number; alongSweep: number; alongArc: number; alongY: number }
  roughness: number
  metalness: number
  /**
   * MeshPhysicalMaterial transmission.
   *
   * At most one layer should use it. Three renders only *opaque* objects into
   * the transmission target, so a transmissive sheet can see opaque sheets
   * behind it but never another transmissive one. That constraint is also the
   * design: the frosted sheet transmits, the blue sheets stay opaque, and the
   * frost picks up their colour exactly as the reference does.
   */
  transmission: number
  /** Refraction depth, only meaningful when transmission > 0. */
  refractionDepth: number
  /**
   * Beer-Lambert tint applied to whatever is transmitted through the sheet.
   * This is what makes the frost gain saturation over the blue layers instead
   * of greying them out the way alpha blending does.
   */
  attenuationColor: string
  /** Distance at which `attenuationColor` is fully applied. */
  attenuationDistance: number
  /**
   * Colour multiplied into the albedo as the surface turns to face the camera,
   * standing in for absorption through the body. Saturated and dark; this is
   * what reads as a translucent polymer rather than painted plastic.
   */
  coreColor: string
  /** Strength of `coreColor`, 0..1. */
  absorption: number
  /**
   * Scales the dielectric specular lobe without touching the diffuse.
   *
   * At 1 the white specular veil sits over the body and caps saturation: the
   * top sheet measured saturation 59 against a reference target of 81 no matter
   * how dark the albedo went. Pulling it down lets the absorbed colour through.
   */
  specularIntensity: number
  ior: number
  clearcoat: number
  clearcoatRoughness: number
  iridescence: number
  /**
   * Alpha blending used when transmission is 0.
   *
   * Anything below 1 makes the layer transparent, which decides the rest of its
   * draw behaviour on its own: no depth writes, and a place in the stack's
   * explicit back-to-front order. See `StackOrder`.
   */
  opacity: number
  /** How this ply is woven, or `none` for a ply with no structure of its own. */
  weave: WeavePattern
  /** Cells of the weave across the arc (v). 0 disables it. */
  weaveScale: number
  /**
   * Aspect of one cell, not a second scale.
   *
   * The plate is about 1.586 long to 1 wide, so `PLATE_ASPECT` draws square
   * cells and anything under it elongates them along the sweep — which is what
   * a thread running the length of a sheet looks like.
   */
  weaveStretch: number
  /** Normal perturbation strength of the weave. */
  weaveDepth: number
  /**
   * How much the weave darkens the albedo, 0..1. Sampling the reference put the
   * polyester's dots 6 lightness points below the sheet body; with normal
   * perturbation alone that difference measured zero and the pattern
   * disappeared. Every family since answers to the same finding.
   */
  weaveContrast: number
  /** Colour the weave multiplies into. Cooler and darker than the body. */
  weaveTint: string
  /**
   * Rib normal perturbation in the fragment shader. The geometry only carries a
   * low-amplitude version of the corrugation for the silhouette; this is what
   * actually reads as fluted glass.
   */
  ribShading: number
  /** Albedo swing across each rib, 0..1. Same reasoning as `dotContrast`. */
  ribContrast: number
  /**
   * How much of the decal's ink reaches the albedo, 0..1.
   *
   * A printed card face takes 1 — the print IS the albedo. A shape pressed into
   * plastic takes almost 0: an emboss changes no colour at all, only the way
   * the surface turns, and painting it in is what makes relief read as a decal
   * stuck on top.
   */
  decalInk: number
  /**
   * How hard the decal's coverage perturbs the normal, 0..1. This is the half
   * that carries an emboss, and the half a flat print leaves at zero.
   */
  decalRelief: number
  /**
   * How much the body scatters light instead of passing it through, 0..1.
   *
   * The difference between a tinted window and frosted acrylic, and it is not a
   * matter of how much alpha the layer has. A clear sheet shows what is behind
   * it; a frosted one shows its own body, lit from within, and what is behind
   * arrives only as a diffuse glow. Alpha alone cannot express that — turned
   * down it makes a window, turned up it makes paint.
   *
   * Real transmission would model this exactly and cannot be afforded here:
   * three renders only OPAQUE objects into the transmission target, so a
   * transmissive sheet can never see another one, and this stack is seven deep
   * in film. See `transmission`. What this does instead is take the two effects
   * that actually read — the body going milky and the sheet closing up — and
   * drive both off the viewing angle, which is where a scattering medium gets
   * its whole character.
   */
  /**
   * How much the surface finish wanders across the sheet, 0..1-ish.
   *
   * A single roughness number is the most reliable tell that a surface was
   * computed. Nothing manufactured is uniformly polished: injection-moulded
   * plastic carries the texture of the mould, a laminate carries the pressure
   * pattern of the rollers that pressed it, and a card that has been handled
   * carries the handling. None of it is visible as texture — it is visible
   * because the highlight stops being one clean shape and starts breaking up.
   *
   * That is why this lives in ROUGHNESS and not in the albedo or the normal.
   * Dirt drawn into the colour reads as dirt. Roughness that varies reads as a
   * real surface, because what changes is the way the light leaves it.
   *
   * Two scales, and both are physical rather than decorative: a broad
   * unevenness across the sheet, and a fine grain stretched along its length —
   * the drag direction of the rollers a film is pressed between.
   */
  imperfection: number
  frost: number
    /**
   * What the scattered light looks like. Near-white and slightly cool: it is
   * light that has bounced inside the material rather than the material's own
   * colour, so it carries the light's tint far more than the body's.
   */
  frostColor: string
  /** Fresnel rim glow, across the whole surface at grazing angles. */
  rimColor: string
  rimStrength: number
  rimPower: number
  /**
   * Glow anchored to the bullnose itself, in `rimColor`. This is the bright
   * band that runs the length of every edge in the reference — a plain fresnel
   * cannot produce it because it is not view-dependent.
   */
  bevelGlow: number
  /**
   * How readily this layer bends under a pointer drag. 1 is a film that gives
   * way freely; 0 is rigid and never deforms at all.
   *
   * A material property and not an animation one, which is why it is authored
   * here beside the roughness and the ior rather than tuned in the timeline.
   * The stack is not eleven copies of one thing — it is two printed card covers
   * with laminate and foil between them, and those do not answer a finger the
   * same way.
   *
   * The numbers are not free choices either. Bending stiffness goes with the
   * CUBE of thickness, so deflection under a given push goes with its inverse
   * cube, and the thicknesses are already authored in `composition.ts`: a card
   * cover at 0.0089 of the long side against a film at 0.004 is
   * (0.004/0.0089)³ ≈ 0.09. That is what "a more rigid plastic" is worth, and
   * it is a much larger gap than the thickness alone suggests — which is the
   * whole reason a card feels stiff and the film inside it does not.
   */
  flex: number
}

/** Where the sheet sits in the fan, and how it swings when animated. */
export interface SheetPlacement {
  /** Hinge position, shared-ish across layers. Rotation happens around this. */
  pivot: [number, number, number]
  /** Rotation applied at full openness, in radians, around the pivot. */
  fanRotation: [number, number, number]
  /** Static offset of the mesh relative to its pivot, fully exploded. */
  offset: [number, number, number]
  /**
   * Offset of the mesh while the stack is closed, i.e. the layer's place inside
   * an assembled card: no drift, no gap, each layer resting on the one below it.
   *
   * Derived rather than authored — it is the running sum of the real
   * thicknesses, so the closed stack is exactly as thick as its parts and
   * nothing interpenetrates on the way in. See `assemble` in `composition.ts`.
   */
  assembledOffset: [number, number, number]
  /**
   * Plate thickness while the stack is closed.
   *
   * Eleven layers at their own thicknesses sum to five times what an ID-1 card
   * measures, so a closed stack built from them is a tile, not a card. The
   * layers therefore thin as they close, by the one factor that makes the total
   * come out at a card — and thinning is what compressing the layout cannot be
   * without it, since the plates have real thickness and would simply pass
   * through each other. Also derived; see `assemble` in `composition.ts`.
   */
  assembledThickness: number
  scale: number
  /**
   * Whether this layer is rendered into the shadow map.
   *
   * True on every layer now, and this is the expensive flag in the file — read
   * the measurement before turning any of them back on or off.
   *
   * It stood on the top sheet alone for a long time, on the grounds that only
   * it had anything below to darken and that every caster re-runs the whole
   * vertex shader in the shadow pass: back when the piece was four sheets,
   * letting all four cast measured 27 ms/frame for a 4.5% change in the image.
   * The first half of that reasoning was wrong — the artwork turns under the
   * pointer, so which end of the stack faces the light is not fixed and every
   * plate throws its shadow onto its neighbours at some angle. The second half
   * was right and still is.
   *
   * What changed is that the alternative stopped being "solid shadow or none".
   * Seven of the eleven layers are films, a shadow map has no channel for
   * partial coverage, and a plain depth pass would have every one of them
   * throwing the black shadow of a piece of card. The stochastic discard in
   * `FRAGMENT_DEPTH_ALPHA_CHUNK` is what makes an honest translucent caster
   * possible at all; the analytic stand-in in `stackVisibility` is what stood
   * in for it until now.
   *
   * If the shadow pass turns out to cost too much, the first thing to try is
   * NOT this flag. It is the depth vertex shader: it calls `surfaceAt`, which
   * spends five evaluations of `basePosition` on finite-difference tangents in
   * order to use exactly one of them — the shell offset direction — and the
   * loft already knows that direction analytically. That is a fivefold cut in
   * the dominant cost, and it is available before any layer has to stop
   * casting.
   */
  castsShadow: boolean
}

/**
 * Artwork laid over a layer.
 *
 * One slot, not two, because a layer only ever has one: the outer layers are
 * finished cards and carry a printed face, the ones between them are raw
 * material and carry a pressed or engraved motif. How the artwork is used —
 * as ink, as relief, or both — is a property of the surface, not of the
 * drawing, so it lives on `SheetSurface`.
 */
export type SheetDecal =
  | 'card-front'
  | 'card-back'
  | 'embossed-circles'
  | 'currency-frame'
  | 'border-frame'
  | 'facet-fold'
  | 'none'

export interface SheetLayer {
  id: string
  shape: SheetShape
  surface: SheetSurface
  placement: SheetPlacement
  decal: SheetDecal
  /** Phase offset (0..1) so the layers do not animate in lockstep. */
  animationPhase: number
}

export interface Composition {
  background: string
  sheets: SheetLayer[]
}
