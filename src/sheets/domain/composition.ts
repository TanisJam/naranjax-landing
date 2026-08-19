import { brand } from '../../brand'
import { PLATE_ASPECT } from './types'
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
 * The stack is a BILL OF MATERIALS, not a gradient, and that is the one thing
 * to preserve when tuning it. An earlier version ran a smooth hue rotation from
 * orange down to violet, which was pretty and was a lie: the reference build
 * sheet for this card alternates pigmented orange plies with cream laminates
 * and off-white substrates, because that is what a laminated card is. Layers
 * that all differ by a few degrees of hue read as one object dissolving;
 * layers that alternate saturated and pale read as parts.
 *
 * Reading down: the pigmented PVC core, a matte protective laminate, the
 * polyester substrate, a clear security foil, the white print ply, the
 * decorative geometric print, a second foil, the printed exterior face, and the
 * solid base. Two of the eleven are the finished cards themselves.
 *
 * The brand's violet survives in exactly one place — the lower foil — and it
 * earns it there rather than being applied: a security hologram does flash
 * violet, so the second ink arrives as an optical property of a real material
 * instead of as a colour somebody wanted on screen.
 *
 * Lightness is the axis that was NOT free to move. The light rig, the rim
 * strengths and the frost were fitted against these luminances over several
 * sessions; the orange plies sit where the blue ones used to and the pale plies
 * are pale because the reference says so, not because a slot needed filling.
 */
const baseSurface: SheetSurface = {
  colorA: '#ad561c',
  colorB: '#d06f2f',
  gradient: { bias: -0.05, alongSweep: 0.25, alongArc: 0.45, alongY: 0.25 },
  roughness: 0.12,
  metalness: 0,
  transmission: 0,
  refractionDepth: 0.25,
  attenuationColor: '#ffffff',
  attenuationDistance: Infinity,
  coreColor: '#864215',
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
  // Tracks `frost` rather than being chosen per layer: anything that scatters
  // light scatters what is BEHIND it too, and a sheet that frosts its own body
  // while leaving the stack behind it razor sharp is the tell that it is a tint
  // and not a material. So every layer with frost above zero turns this on, and
  // the covers — which have no frost — leave it off.
  //
  // It is the expensive flag in the file. Each frosted layer breaks the render
  // pass to copy the framebuffer, `BackdropCapture.stride` shares one copy
  // across two of them, and seven frosted layers is four copies where four
  // frosted layers was two. `BackdropCapture` measures a copy at 0.87 gpu ms,
  // so this is roughly +1.7 ms on a 7.3 ms frame. Paid deliberately.
  frostsBackdrop: false,
  frostColor: '#fff5ee',
  // Off by default, and every ply between the two covers turns it on. The
  // covers do not: their print covers the rect edge to edge at full ink, so a
  // weave under it would be paid for per fragment and never seen.
  //
  // Which family each ply wears is not decoration picked at random — it is what
  // that ply is supposed to BE. The two holographic foils share `guilloche`
  // because engine turning is what a security foil is ruled with, and they wear
  // it at different scales so the pair reads as two sheets of one material
  // rather than one sheet twice. The films take the textile ladder. The
  // polyester keeps the halftone that was measured off the reference.
  //
  // Contrast stays between 0.08 and 0.13 across all of them against the
  // polyester's 0.24, because the polyester is the one ply that is genuinely
  // cloth. On the rest this is a substrate seen through film, and a weave you
  // NOTICE on eleven stacked plates is eleven patterns competing for the same
  // pixels.
  weave: 'none',
  weaveScale: 0,
  weaveStretch: PLATE_ASPECT,
  weaveDepth: 0,
  weaveContrast: 0,
  // Every ply below overrides this with its own `coreColor`, which is not a
  // shortcut: the trough of a weave is the body seen through more of itself,
  // and `coreColor` is already exactly that colour on every layer here. Nine
  // new hex values would have been nine chances to drift from the ply they
  // belong to.
  weaveTint: '#bb977f',
  ribShading: 0,
  ribContrast: 0,
  decalInk: 0,
  decalRelief: 0,
  // The interior of the stack is film and foil, and film gives way. This is the
  // reference the covers below are stiff RELATIVE to.
  flex: 1,
  rimColor: '#fff2ea',
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
 * a decal floating in space.
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
  /**
   * Small, and the smallest number on this surface that is not zero.
   *
   * The print itself is flat — this design's numbers are not embossed, and
   * nothing painted on the face is meant to rise off it. What the relief is
   * here for is the two things on a card that are not print: the contact plate,
   * which is milled into the plastic and stands a hair proud of it, and the
   * wear, which is the opposite sign. Both come from a height field of their
   * own rather than from the ink, so raising this lifts the hardware without
   * embossing a single glyph.
   *
   * A card is also the one object here the eye already knows by touch, which is
   * what caps the number. Push it and the chip stops reading as a part seated
   * in plastic and starts reading as a tile glued on top.
   */
  decalRelief: 0.85,
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
 * The decorative interior print sits between the two.
 *
 * Its facets are a printed tonal field AND a fold, so unlike the emboss layers
 * it needs real ink — the reference's facets differ in colour, not only in the
 * way they catch light. And unlike the security print it needs real relief,
 * because a fold that changes tone without changing slope is a photograph of a
 * fold printed flat. Both channels at once is what the material actually is.
 *
 * The relief runs high against that ink for a reason the motif explains: its
 * facet levels span about a third rather than the full range, so the gradient
 * the shader differentiates is correspondingly shallow. The tone had to come
 * down to match the reference; the fold did not, so the relief goes up to keep
 * it. Ink and relief are not two dials pointing the same way here.
 */
const faceted = { decalInk: 0.32, decalRelief: 8 }

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
  peel: 0,
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
      // No lift of its own. Raising the tail and rolling it are the same
      // gesture, and the roll is the one that says which way the sheet came
      // off; running both just spends the gap to the layer above twice.
      lift: 0,
      peel: 0.55,
      thickness: FILM_THICKNESS,
    },
    surface: {
      ...baseSurface,
      ...embossed,
      colorA: '#f0800f',
      colorB: '#f79a35',
      coreColor: '#c25f06',
      weave: 'twill',
      weaveScale: 150,
      weaveStretch: PLATE_ASPECT,
      weaveDepth: 0.55,
      weaveContrast: 0.1,
      weaveTint: '#c25f06',
      // Pigmented PVC, not a polished film: the reference's core is the same
      // matte body the printed face is, seen without its laminate.
      roughness: 0.32,
      opacity: 0.92,
      frost: 0.45,
      // The least of it in the stack, and that is the alpha talking rather than
      // the frost: at 0.92 body only 8% of the diffused capture survives the
      // composite. It reads as the edges of the plies below going soft where
      // this one covers them, not as glass. Correct for a pigmented core — it is
      // the most solid film here — and the reason to leave the alpha alone.
      frostsBackdrop: true,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(1), 0],
      offset: layerOffset(1),
      scale: 0.995,      castsShadow: true,
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
      colorA: '#f7e9dc',
      colorB: '#fdf6ee',
      coreColor: '#e3cfbc',
      weave: 'plain',
      weaveScale: 170,
      weaveStretch: PLATE_ASPECT,
      weaveDepth: 0.5,
      weaveContrast: 0.09,
      weaveTint: '#e3cfbc',
      // The matte protective laminate, and it used to be the glossiest layer in
      // the stack. The reference is explicit — "laminado protector MATE" — so
      // the roughness went from 0.07 to 0.34 and the sheet stopped being the
      // one mirror in the piece. Worth stating because it reads as a regression
      // otherwise: the layer nothing is pressed into is now also the layer with
      // no specular sweep to show, and what carries it instead is the tooth
      // below and the fact that it is the only near-white ply this high up.
      //
      // Keeps the most imperfection of any layer, which matters MORE now, not
      // less. A matte surface at one flat roughness value is the most obviously
      // synthetic thing a renderer can produce.
      imperfection: 0.2,
      roughness: 0.34,
      opacity: 0.72,
      frost: 0.35,
      // Where this pays most in the upper half of the stack: 0.72 body leaves
      // 28% of the diffused capture showing, the widest opening above the foils.
      // It also gives the matte laminate back the thing it lost when its
      // roughness went to 0.34 — a sheet with no specular sweep to show now
      // shows its depth instead, which is the more honest way for a matte ply to
      // announce itself anyway.
      frostsBackdrop: true,
      // The tooth the matte finish actually has. Faint enough to be felt rather
      // than seen, which is the difference between a matte laminate and a
      // frosted one.
      ribShading: 0.12,
      ribContrast: 0.1,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(2), 0],
      offset: layerOffset(2),
      scale: 0.99,      castsShadow: true,
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
      colorA: '#e6e0d4',
      colorB: '#f2ede3',
      coreColor: '#cdc5b6',
      // The polyester substrate, which is the one ply in the reference that is
      // literally woven — fine threads one way, a dot grid the other. Two
      // fields crossing is what reads as cloth rather than corduroy, and it is
      // why this layer needs no decal: the weave is procedural all the way
      // down. It was already built this way before the reference arrived, which
      // is the good kind of coincidence — the material it was imitating and the
      // material the build sheet names turned out to be the same one.
      // Already the roughest surface in the stack and already carrying a weave,
      // so it needs the least of this — the cloth is doing the work.
      imperfection: 0.07,
      roughness: 0.36,
      ribShading: 0.42,
      ribContrast: 0.28,
      // Untouched by the weave set, and that is the point of it being a set:
      // this ply is the one whose pattern was measured off the reference rather
      // than designed, so it keeps its own numbers while the families around it
      // are chosen. The stretch is the 0.55 it always had, which is why that is
      // a knob — a square cell would draw round dots where the reference has
      // dashes lying along the sweep.
      weave: 'micro-dot',
      weaveScale: 200,
      weaveStretch: 0.55,
      weaveDepth: 1.5,
      weaveContrast: 0.24,
      weaveTint: '#b8ad9c',
      opacity: 1,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(3), 0],
      offset: layerOffset(3),
      scale: 0.985,      castsShadow: true,
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
      colorA: '#f3c8a8',
      colorB: '#f8dcc6',
      coreColor: '#d9a37e',
      weave: 'guilloche',
      weaveScale: 64,
      weaveStretch: PLATE_ASPECT,
      weaveDepth: 0.5,
      weaveContrast: 0.1,
      weaveTint: '#d9a37e',
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
      rimColor: '#ffebea',
      rimStrength: 0.3,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(4), 0],
      offset: layerOffset(4),
      scale: 0.98,      castsShadow: true,
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
      colorA: '#f2ece2',
      colorB: '#fbf7f0',
      coreColor: '#d8d0c2',
      // The one ply whose split between depth and contrast is not a taste call.
      // A herringbone's two diagonals tilt the surface opposite ways, so the
      // normal term answers to the key light in opposite directions too: at the
      // 0.5 depth the other plies carry, one chevron caught the light and the
      // next all but vanished, and the cloth read as vertical stripes. Contrast
      // is blind to direction. Weighting this ply towards the albedo is what
      // makes the reversal — which is the whole pattern — actually visible.
      weave: 'herringbone',
      weaveScale: 130,
      weaveStretch: PLATE_ASPECT,
      weaveDepth: 0.18,
      weaveContrast: 0.22,
      weaveTint: '#d8d0c2',
      roughness: 0.22,
      opacity: 0.74,
      frost: 0.62,
      frostsBackdrop: true,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(5), 0],
      offset: layerOffset(5),
      scale: 0.99,      castsShadow: true,
    },
  },
  {
    // The decorative geometric ply. The only layer whose artwork covers the
    // whole plate rather than sitting inside a border — see `facet-fold`.
    id: 'embossed-wave',
    decal: 'facet-fold',
    animationPhase: 0.54,
    shape: {
      ...flatPlate,
      ...waveFold,
      // Overrides the fold's own lift, for the reason the film above gives.
      lift: 0,
      // Held well under the film above, which peels from flat. This sheet is
      // already folded — `waveFold` opens its arc to 0.66 — and a turn sized for
      // a flat plate lands on top of that, so the wave and the lift stop reading
      // as two things happening to one sheet and start reading as a crumple.
      peel: 0.42,
      thickness: FILM_THICKNESS,
      // The woven tooth the reference shows across this ply, under its facets.
      // Same shading-only corrugation the substrate uses and a quarter of its
      // strength: this is printed film with a texture, not cloth.
      ribFrequency: 96,
    },
    surface: {
      ...baseSurface,
      ...faceted,
      colorA: '#ef8417',
      colorB: '#f7a244',
      coreColor: '#c26208',
      weave: 'waffle',
      weaveScale: 52,
      weaveStretch: PLATE_ASPECT,
      weaveDepth: 0.7,
      weaveContrast: 0.1,
      weaveTint: '#c26208',
      roughness: 0.18,
      opacity: 0.93,
      ribShading: 0.11,
      ribContrast: 0.09,
      // Less than the plies around it. Frost scatters the surface normal, and
      // the normal is where a fold lives — frosting this one to match its
      // neighbours would sand the creases off the only layer that has any.
      frost: 0.3,
      // The low frost above is a decision about this layer's OWN normal, and it
      // is left standing — the crease survives. What the backdrop composite
      // scatters is the frame behind, which has no creases of this sheet in it
      // to sand off. Two different surfaces, so the argument for holding the
      // frost down is not an argument for holding this off. The 0.93 body keeps
      // the result to a softening under the facets rather than a window.
      frostsBackdrop: true,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(6), 0],
      offset: layerOffset(6),
      scale: 0.985,      castsShadow: true,
    },
  },
  {
    id: 'holo-wave',
    decal: 'currency-frame',
    animationPhase: 0.63,
    shape: {
      ...flatPlate,
      ...waveFold,
      lift: 0,
      peel: 0.34,
      thickness: FOIL_THICKNESS,
    },
    surface: {
      ...baseSurface,
      ...printed,
      colorA: '#b184c9',
      colorB: '#d3b3e2',
      coreColor: '#8a5aa8',
      weave: 'guilloche',
      weaveScale: 84,
      weaveStretch: PLATE_ASPECT,
      weaveDepth: 0.5,
      weaveContrast: 0.09,
      weaveTint: '#8a5aa8',
      absorption: 0.14,
      roughness: 0.26,
      iridescence: 0.7,
      // The same frosted foil as `holo-currency`, folded into a wave. Its rim
      // follows its own body into the magenta half of the run rather than
      // staying on the upper foil's warm white — a rim is the sheet's own edge
      // catching the light, so it cannot belong to a different sheet's hue.
      opacity: 0.56,
      frost: 0.8,
      frostsBackdrop: true,
      rimColor: '#f4eaff',
      rimStrength: 0.3,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(7), 0],
      offset: layerOffset(7),
      scale: 0.98,      castsShadow: true,
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
      colorA: '#f18a1e',
      colorB: '#f8a852',
      coreColor: '#c66a09',
      weave: 'plain',
      weaveScale: 210,
      weaveStretch: PLATE_ASPECT,
      weaveDepth: 0.45,
      weaveContrast: 0.08,
      weaveTint: '#c66a09',
      roughness: 0.21,
      opacity: 0.82,
      frost: 0.66,
      frostsBackdrop: true,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(8), 0],
      offset: layerOffset(8),
      scale: 0.99,      castsShadow: true,
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
      colorA: '#e0e0dc',
      colorB: '#eeeee9',
      coreColor: '#c2c2bc',
      weave: 'twill',
      weaveScale: 96,
      weaveStretch: PLATE_ASPECT,
      weaveDepth: 0.7,
      weaveContrast: 0.13,
      weaveTint: '#c2c2bc',
      roughness: 0.14,
      opacity: 1,
    },
    placement: {
      pivot: PIVOT,
      fanRotation: [0, layerTwist(9), 0],
      offset: layerOffset(9),
      scale: 0.995,      castsShadow: true,
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
      scale: 1,      castsShadow: true,
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
  // The page's own `ink-900`, read from the brand rather than copied out of
  // it. The canvas is transparent here so nothing clears to this, but it is
  // what the composition says it sits on, and a value that has silently
  // drifted from the page is worse than no value at all — which is exactly
  // what a second brand would have made of a literal.
  background: brand.palette.ink[900],
  sheets: assemble(layers),
}
