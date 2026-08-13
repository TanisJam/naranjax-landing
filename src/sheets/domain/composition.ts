import type { Composition, SheetLayer, SheetPlacement, SheetSurface } from './types'

/**
 * A layer before its closed-stack place is known.
 *
 * Both closed fields are the running total of every thickness in the list, so
 * no single literal can state either one — they fall out of the finished set.
 * Authoring them by hand would be twenty-two numbers that silently stop
 * agreeing with the thicknesses the moment one of them is tuned.
 */
type SheetDraft = Omit<SheetLayer, 'placement'> & {
  placement: Omit<SheetPlacement, 'assembledOffset' | 'assembledThickness'>
}

/**
 * Card proportions, ISO/IEC 7810 ID-1: 85.60 x 53.98 mm, a ratio of 1.586.
 * Every layer of the stack shares them — an exploded view only reads as one
 * object taken apart if the parts keep the silhouette of the whole.
 */
const CARD_LENGTH = 2.36
const CARD_WIDTH = CARD_LENGTH / 1.586

/**
 * Corner radius as a fraction of the short side. A real card is 3.18 mm on a
 * 53.98 mm side, i.e. 0.059; the reference render is drawn a touch softer than
 * spec and the corner is what carries "card" at this size, so it stays generous.
 */
const CORNER_RADIUS = 0.075

/**
 * Thicknesses, to the same scale as everything else.
 *
 * ID-1 specifies 0.76 mm on an 85.60 mm card — 0.89% of the long side, which is
 * `CARD_THICKNESS` below. It looks impossibly thin written down and it is
 * exactly right: anything heavier turns the card into a tile. The layers
 * between the cards are thinner still, because they are what a card is made
 * OF — films, laminates and a sheet of security print, none of which is a slab.
 */
const CARD_THICKNESS = CARD_LENGTH * 0.0089
const FILM_THICKNESS = CARD_LENGTH * 0.004
const FOIL_THICKNESS = CARD_LENGTH * 0.0025

/** Vertical distance between neighbouring layers in the exploded stack. */
const LAYER_GAP = 0.31

/**
 * What the whole stack measures once it is closed: one card, to spec.
 *
 * Not the sum of its parts, which comes out around five card-thicknesses — the
 * layers are drawn at the thickness their material would have, and eleven of
 * those is a coaster. A finished card is thinner than the things it is made of
 * pressed together, because lamination is exactly that.
 */
const CLOSED_THICKNESS = CARD_THICKNESS

/**
 * Total twist across the stack, in radians. The layers do not simply float
 * apart in the reference — they rotate progressively, which is what stops the
 * stack from reading as a flat accordion seen edge-on.
 */
const STACK_TWIST = 0.5

const LAYER_COUNT = 11

/** Every layer swings around the stack's own axis, so the twist opens in place. */
const PIVOT: [number, number, number] = [0, 0, 0]

/** Height of layer `index`, counting from the top card down. */
function layerHeight(index: number): number {
  return ((LAYER_COUNT - 1) / 2 - index) * LAYER_GAP
}

/** Twist of layer `index`, spread symmetrically about the middle of the stack. */
function layerTwist(index: number): number {
  return (index / (LAYER_COUNT - 1) - 0.5) * STACK_TWIST
}

/**
 * Lateral drift per layer, on the card's own plane.
 *
 * Spacing the layers on the vertical axis alone stacks them like plates in a
 * rack, and the eye reads that as an assembly diagram. The reference slides
 * each one slightly off the last, which is what makes the stack look taken
 * apart. Authored rather than generated: the values are small enough that any
 * regular progression through them reads as a pattern instead of as drift.
 */
const DRIFT: ReadonlyArray<readonly [number, number]> = [
  [0.06, -0.05],
  [-0.05, 0.04],
  [0.09, 0.06],
  [-0.08, -0.03],
  [0.04, 0.07],
  [-0.07, -0.06],
  [0.08, 0.02],
  [-0.03, -0.04],
  [0.05, 0.06],
  [-0.06, -0.02],
  [0.03, 0.05],
]

function layerOffset(index: number): [number, number, number] {
  const [x, z] = DRIFT[index]!
  return [x, layerHeight(index), z]
}

/**
 * Shared surface defaults. Each layer overrides only what makes it distinct.
 *
 * The palette runs down the stack: steel blue under the top card, opening
 * through cyan and holographic white, closing on the mint of the bottom one. As
 * in the original piece the gradient is a hue rotation at near-constant
 * lightness — built as dark-to-pale it turns into washed-out plastic.
 */
const baseSurface: SheetSurface = {
  colorA: '#1c74ad',
  colorB: '#2f9fd0',
  gradient: { bias: -0.05, alongSweep: 0.25, alongArc: 0.45, alongY: 0.25 },
  roughness: 0.12,
  metalness: 0,
  transmission: 0,
  refractionDepth: 0.25,
  attenuationColor: '#ffffff',
  attenuationDistance: Infinity,
  coreColor: '#155a86',
  absorption: 0.35,
  specularIntensity: 1.15,
  ior: 1.46,
  // Both off for the same measured reason as the original: clearcoat cost
  // 42 ms/frame on its own and iridescence another 14, for a change that was
  // invisible side by side once roughness compensated.
  clearcoat: 0,
  clearcoatRoughness: 0.06,
  iridescence: 0,
  opacity: 1,
  // Every sheet in the stack carries some. The interior layers are pressed film
  // and laminate, and neither comes out of a roller evenly polished.
  imperfection: 0.13,
  // Off by default: the two covers are finished card and scatter nothing. Every
  // layer between them turns it on — that is what they are made of.
  frost: 0,
  frostsBackdrop: false,
  frostColor: '#eef6ff',
  dotScale: 0,
  dotDepth: 0,
  dotContrast: 0,
  dotTint: '#7f93bb',
  ribShading: 0,
  ribContrast: 0,
  decalInk: 0,
  decalRelief: 0,
  // The interior of the stack is film and foil, and film gives way. This is the
  // reference the covers below are stiff RELATIVE to.
  flex: 1,
  rimColor: '#eaf2ff',
  // Every one of these is additive in practice: a fresnel rim fires across most
  // of a plate seen this obliquely, and eleven plates stacked mean eleven of
  // them summing into the same pixels. Values tuned against a single sheet blow
  // the middle of the stack out to white. The glow has to be worth 1/11th of
  // what it would be on its own.
  rimStrength: 0.16,
  rimPower: 3.4,
  bevelGlow: 0.55,
}

/**
 * The two printed cards.
 *
 * Their albedo is the artwork outright, so every field that tints albedo has to
 * stand down: white body colour, no absorption, no dot or rib field. What is
 * left is the material response — a satin polish and the lit bullnose — which
 * is what keeps the print on a physical object instead of making it look like
 * a decal floating in space. Relief stays at zero: a card is printed, not
 * embossed, and the numbers on this design are flat.
 */
const printedCard: SheetSurface = {
  ...baseSurface,
  colorA: '#ffffff',
  colorB: '#ffffff',
  gradient: { bias: 0, alongSweep: 0, alongArc: 0, alongY: 0 },
  coreColor: '#ffffff',
  absorption: 0,
  roughness: 0.26,
  // A varnished card, and the varnish is where a real one gives itself away —
  // it pools and thins across the print, so the sheen is never one flat value.
  imperfection: 0.1,
  specularIntensity: 1.05,
  opacity: 1,
  decalInk: 1,
  decalRelief: 0,
  rimStrength: 0.12,
  bevelGlow: 0.55,
  // The two covers, and the only layers in the stack that are card rather than
  // laminate. `CARD_THICKNESS` over `FILM_THICKNESS` is 2.23, stiffness goes
  // with the cube of it, and 2.23⁻³ is this. Not a taste — the thicknesses were
  // authored above and this is what they already imply.
  //
  // It lands almost exactly on the visibility floor, and that is the answer
  // rather than an accident of it: a full-strength drag deflects a film 0.168
  // and moves these 0.015, which is the same 0.015 that was measured as
  // invisible when the whole effect was mistuned. The covers therefore read as
  // the finger passing OVER them, which is what a finger on a finished card
  // does. Left at the physical value rather than rounded to zero, so the
  // authored thicknesses stay the single source of it.
  flex: 0.09,
}

/**
 * A shape pressed into plastic changes no colour at all — only the way the
 * surface turns. So the emboss layers take nearly none of the decal's ink and
 * nearly all of its relief; painting the motif in is exactly what makes an
 * emboss read as a sticker.
 *
 * The relief number sits far above 1 on purpose. It scales a normal offset
 * built from the decal's alpha gradient, and the emboss art tops out near 0.2
 * alpha spread over a soft shoulder, so the raw gradient is tiny. What matters
 * is the tilt it ends up producing, not that the number look like a 0..1 weight.
 */
const embossed = { decalInk: 0.05, decalRelief: 11 }

/** Security print is the opposite trade: it is ink, with the barest impression. */
const printed = { decalInk: 0.55, decalRelief: 3 }

/**
 * Flat-plate defaults for the shape.
 *
 * A card is the degenerate case of the loft: the arc angle goes to nothing and
 * the section straightens into a line. It is not zero, though — a real card in
 * mid-air always holds a slight bow, and a perfectly planar one reads as a
 * cardboard cutout the moment the light sweeps across it.
 */
const flatPlate = {
  length: CARD_LENGTH,
  width: CARD_WIDTH,
  tipScale: 1,
  crownStart: 0.5,
  crownEnd: 0.5,
  rollStart: 0,
  rollEnd: 0,
  lift: 0,
  bow: 0,
  cornerRadius: CORNER_RADIUS,
  ribFrequency: 0,
  ribAmplitude: 0,
  // Both axes now have to resolve the corner arc, which spans roughly 5% of the
  // long side and 8% of the short one. The original could run u at 10 because a
  // constant section along a straight spine has nothing to resolve; a rounded
  // corner does, and an under-sampled one shows up as a cut-off diagonal.
  tessellation: { u: 72, v: 48 },
}

/**
 * A wave breaking across the tail of a sheet: the crown migrates off the plate
 * while the arc opens. That pairing is what lifts one edge into a crest without
 * twisting the whole body into a blade, which is all a roll on its own can do.
 */
const waveFold = {
  angleStart: 0.16,
  angleEnd: 0.66,
  crownEnd: 0.22,
  rollEnd: 0.26,
  lift: 0.07,
}

/**
 * Top to bottom, following the supplied layer breakdown. The two outer layers
 * are finished cards; the nine between them are the material they are built
 * from, which is the whole subject of an exploded view.
 */
const layers: SheetDraft[] = [
  {
    id: 'card-front',
    decal: 'card-front',
    animationPhase: 0,
    shape: {
      ...flatPlate,
      angleStart: 0.1,
      angleEnd: 0.17,
      thickness: CARD_THICKNESS,
    },
    surface: printedCard,
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(0), 0],
      offset: layerOffset(0),
      scale: 1,      // The only caster in the stack. Every caster re-runs the full vertex
      // shader in the shadow pass, and this is the only layer with ten others
      // beneath it to darken.
      castsShadow: true,
    },
  },
  {
    id: 'transparent-blue',
    decal: 'embossed-circles',
    animationPhase: 0.09,
    shape: {
      ...flatPlate,
      angleStart: 0.16,
      angleEnd: 0.7,
      // Crown pushed off the sheet and a roll only on the tail: one corner
      // peels up, the rest of the plate stays calm.
      crownEnd: 0.12,
      rollEnd: 0.44,
      lift: 0.09,
      thickness: FILM_THICKNESS,
    },
    surface: {
      ...baseSurface,
      ...embossed,
      colorA: '#2f9ad8',
      colorB: '#4fb8ee',
      coreColor: '#1d70a8',
      roughness: 0.2,
      opacity: 0.92,
      frost: 0.5,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(1), 0],
      offset: layerOffset(1),
      scale: 0.995,      castsShadow: false,
    },
  },
  {
    id: 'glossy-light',
    decal: 'none',
    animationPhase: 0.18,
    shape: {
      ...flatPlate,
      angleStart: 0.14,
      angleEnd: 0.58,
      crownEnd: 0.2,
      rollEnd: 0.34,
      lift: 0.06,
      thickness: FILM_THICKNESS,
    },
    surface: {
      ...baseSurface,
      colorA: '#4fbcea',
      colorB: '#86d6f4',
      coreColor: '#3492c4',
      // The glossiest layer of the stack. Nothing is pressed into it, so the
      // only thing it has to show is the light sweeping across it — which is
      // also why it takes the least frost: scattering is what kills a mirror.
      //
      // And the most imperfection, which is not a contradiction. A surface whose
      // whole job is a specular sweep is the one where a single roughness value
      // is most obvious: the sweep comes out as one clean unbroken shape that no
      // manufactured plastic has ever produced.
      imperfection: 0.2,
      roughness: 0.07,
      opacity: 0.9,
      frost: 0.28,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(2), 0],
      offset: layerOffset(2),
      scale: 0.99,      castsShadow: false,
    },
  },
  {
    id: 'mesh',
    decal: 'none',
    animationPhase: 0.27,
    shape: {
      ...flatPlate,
      angleStart: 0.12,
      angleEnd: 0.26,
      thickness: FILM_THICKNESS,
      // Shading-only corrugation: the amplitude stays at zero so nothing
      // displaces. Geometric ribs at this frequency need hundreds of samples
      // across the section and still alias into a zipper at grazing angles.
      ribFrequency: 96,
    },
    surface: {
      ...baseSurface,
      colorA: '#3d7fbe',
      colorB: '#5a9ad2',
      coreColor: '#2b5f92',
      // The woven core: fine threads one way, a dot grid the other. Two fields
      // crossing is what reads as cloth rather than corduroy, and it is why
      // this layer needs no decal — the weave is procedural all the way down.
      // Already the roughest surface in the stack and already carrying a weave,
      // so it needs the least of this — the cloth is doing the work.
      imperfection: 0.07,
      roughness: 0.36,
      ribShading: 0.42,
      ribContrast: 0.28,
      dotScale: 200,
      dotDepth: 1.5,
      dotContrast: 0.24,
      dotTint: '#23507e',
      opacity: 1,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(3), 0],
      offset: layerOffset(3),
      scale: 0.985,      castsShadow: false,
    },
  },
  {
    id: 'holo-currency',
    decal: 'currency-frame',
    animationPhase: 0.36,
    shape: {
      ...flatPlate,
      angleStart: 0.1,
      angleEnd: 0.24,
      thickness: FOIL_THICKNESS,
    },
    surface: {
      ...baseSurface,
      ...printed,
      // Tinted, not white. A near-white body is what made this layer read as a
      // grey slab where nothing sits behind it and as a white wash where two of
      // them overlap — the fix is a colour, not more alpha.
      //
      // Saturated further once the foil stopped being a ghost. The old values
      // were pale because at 0.16 alpha almost nothing of the body reached the
      // frame and the colour was carrying the layer on its own; a sheet with a
      // real body has to hold a real dye or the frost turns it into fog.
      colorA: '#5cc3dd',
      colorB: '#8fdcea',
      coreColor: '#3f9fbb',
      absorption: 0.14,
      roughness: 0.18,
      // The one place iridescence earns its cost: on a holographic foil it is
      // the subject rather than a garnish.
      iridescence: 0.7,
      // A frosted foil, not a clear one. At 0.16 this layer had no body at all
      // — it read as the engraving floating in the gap where a sheet should be,
      // which is the one thing the reference never does: its foils are present,
      // milky, and you can see them turn. Most of what closes the sheet now
      // comes from `frost` rather than from the alpha, so it stays open in the
      // middle where you are looking through the least material and shuts
      // toward the edges where you are looking through the most.
      opacity: 0.56,
      frost: 0.8,
      frostsBackdrop: true,
      rimColor: '#eafaff',
      rimStrength: 0.3,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(4), 0],
      offset: layerOffset(4),
      scale: 0.98,      castsShadow: false,
    },
  },
  {
    id: 'border-light',
    decal: 'border-frame',
    animationPhase: 0.45,
    shape: {
      ...flatPlate,
      angleStart: 0.12,
      angleEnd: 0.3,
      thickness: FILM_THICKNESS,
    },
    surface: {
      ...baseSurface,
      ...printed,
      colorA: '#79d2dd',
      colorB: '#a6e6ea',
      coreColor: '#4fb0bc',
      roughness: 0.22,
      opacity: 0.74,
      frost: 0.62,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(5), 0],
      offset: layerOffset(5),
      scale: 0.99,      castsShadow: false,
    },
  },
  {
    id: 'embossed-wave',
    decal: 'embossed-circles',
    animationPhase: 0.54,
    shape: {
      ...flatPlate,
      ...waveFold,
      thickness: FILM_THICKNESS,
    },
    surface: {
      ...baseSurface,
      ...embossed,
      colorA: '#2fa6e6',
      colorB: '#4fc0f2',
      coreColor: '#1d7ab0',
      roughness: 0.18,
      opacity: 0.93,
      frost: 0.48,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(6), 0],
      offset: layerOffset(6),
      scale: 0.985,      castsShadow: false,
    },
  },
  {
    id: 'holo-wave',
    decal: 'currency-frame',
    animationPhase: 0.63,
    shape: {
      ...flatPlate,
      ...waveFold,
      thickness: FOIL_THICKNESS,
    },
    surface: {
      ...baseSurface,
      ...printed,
      colorA: '#63c8e0',
      colorB: '#95dfec',
      coreColor: '#4aa8c2',
      absorption: 0.14,
      roughness: 0.26,
      iridescence: 0.7,
      // The same frosted foil as `holo-currency`, folded into a wave.
      opacity: 0.56,
      frost: 0.8,
      frostsBackdrop: true,
      rimColor: '#eafaff',
      rimStrength: 0.3,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(7), 0],
      offset: layerOffset(7),
      scale: 0.98,      castsShadow: false,
    },
  },
  {
    id: 'translucent-emboss',
    decal: 'embossed-circles',
    animationPhase: 0.72,
    shape: {
      ...flatPlate,
      ...waveFold,
      angleEnd: 0.58,
      thickness: FILM_THICKNESS,
    },
    surface: {
      ...baseSurface,
      ...embossed,
      colorA: '#40bde6',
      colorB: '#6ed4ee',
      coreColor: '#2892b8',
      roughness: 0.21,
      opacity: 0.82,
      frost: 0.66,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(8), 0],
      offset: layerOffset(8),
      scale: 0.99,      castsShadow: false,
    },
  },
  {
    id: 'solid-base',
    decal: 'border-frame',
    animationPhase: 0.81,
    shape: {
      ...flatPlate,
      angleStart: 0.1,
      angleEnd: 0.2,
      thickness: FILM_THICKNESS,
    },
    surface: {
      ...baseSurface,
      ...printed,
      colorA: '#2b9ade',
      colorB: '#44b2ea',
      coreColor: '#1a6fa8',
      roughness: 0.14,
      opacity: 1,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(9), 0],
      offset: layerOffset(9),
      scale: 0.995,      castsShadow: false,
    },
  },
  {
    id: 'card-back',
    decal: 'card-back',
    animationPhase: 0.9,
    shape: {
      ...flatPlate,
      angleStart: 0.08,
      angleEnd: 0.14,
      thickness: CARD_THICKNESS,
    },
    surface: printedCard,
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(10), 0],
      offset: layerOffset(10),
      scale: 1,      castsShadow: false,
    },
  },
]

/**
 * Closes the stack: gives every layer the place it holds inside a finished
 * card, centred on the same origin the exploded layout is centred on.
 *
 * The whole stack is compressed by one factor so it lands at `CLOSED_THICKNESS`
 * exactly, and that factor has to reach the plates themselves as well as their
 * positions. Compressing the layout alone would drive eleven solid plates
 * through each other; thinning them by the same amount is what makes the
 * closed stack a lamination instead of a collision.
 *
 * Thicknesses are read through `scale` for the layout, because that is what the
 * mesh is drawn at, but not for `assembledThickness` — that one is a uniform in
 * the mesh's own space, and the scale is applied to it afterwards anyway.
 *
 * Layers touch rather than clear each other: a gap would read as eleven cards
 * resting on one another. Touching is safe here for the same reason the
 * exploded draw order is — near-flat plates, back-face culled, so the seam
 * between two layers is one surface over another and never an intersection.
 */
function assemble(drafts: readonly SheetDraft[]): SheetLayer[] {
  const drawn = drafts.map((draft) => draft.shape.thickness * draft.placement.scale)
  const compression = CLOSED_THICKNESS / drawn.reduce((sum, t) => sum + t, 0)

  let top = CLOSED_THICKNESS / 2
  return drafts.map((draft, index) => {
    const thickness = drawn[index]! * compression
    const centre = top - thickness / 2
    top -= thickness
    return {
      ...draft,
      placement: {
        ...draft.placement,
        assembledOffset: [0, centre, 0],
        assembledThickness: draft.shape.thickness * compression,
      },
    }
  })
}

export const composition: Composition = {
  background: '#1e293b',
  sheets: assemble(layers),
}
