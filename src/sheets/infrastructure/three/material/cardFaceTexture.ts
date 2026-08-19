import { CanvasTexture, SRGBColorSpace } from 'three'

export type CardFace = 'front' | 'back'

/** ISO/IEC 7810 ID-1 aspect (1.586:1) at a size that stays crisp at ~400px on screen. */
const WIDTH = 1024
const HEIGHT = 646

/** No printed element is allowed to reach past this inset. */
const MARGIN = 48

/**
 * The card body, sampled off the MandarinaX reference render pixel for pixel.
 *
 * It agrees with `--color-mx-orange` here, and that agreement is a fact about
 * this brand rather than a rule: MandarinaX states its orange ON a card, so the
 * ink and the body are the same measurement taken from the same artefact. Where
 * a brand publishes the two separately they are two different things — an ink
 * and a pigmented PVC body photographed under light — and this constant is
 * still the one that governs the object.
 *
 * The reference sheet also shows a red card beside this one. The red is not a
 * second body here: it is the page's ground, and a card the colour of the page
 * behind it would disappear into the one thing it has to stand out from.
 */
const BODY_ORANGE = '#f37d06'

/**
 * The front carries no account data at all — no number, no expiry, no name.
 *
 * That is the reference design and it is also where the card industry went:
 * once the front stopped being run through an imprinter there was no reason for
 * it to carry the data, and moving it to the back buys back the whole face for
 * the brand. So the two faces no longer share a layout, and the constants below
 * are per-face rather than shared. An earlier version of this file aligned them
 * deliberately so the marks would hold still through a flip; there is nothing
 * left on the front for them to hold still against.
 */
const CARD_NUMBER = '5412 7512 3412 3456'
const EXPIRY = '12/28'
const CARDHOLDER = 'Mauricio N. Romero'

/**
 * The signature, as the outlines of its own ink.
 *
 * Traced from a photograph of the mark actually written by hand, thresholded
 * and reduced to closed contours — not set in a script face. That distinction
 * is the whole point of the panel. A typeface named `cursive` produces the same
 * shapes for everybody, which is precisely what a signature is not, and what a
 * host resolves that keyword to is anyone's guess: on Windows it is Comic Sans.
 * This is one person's hand, and it renders identically everywhere because it
 * is geometry rather than a font lookup.
 *
 * Contours rather than strokes, so the pen's own width variation survives — the
 * downstrokes are heavier than the upstrokes and the long flourish tapers at
 * both ends, and none of that can be recovered from a centre line stroked at a
 * constant width.
 *
 * Coordinates are flat x, y pairs in a box 1000 wide; `SIGNATURE_RISE` is how
 * tall that box is in the same units. Six contours: the ink itself and the
 * counters enclosed by the loops, filled together under the even-odd rule so
 * the holes stay holes without anyone having to track winding.
 *
 * Smoothed along each contour before simplifying, because a threshold boundary
 * carries the paper's grain and a simplifier preserves noise exactly as
 * faithfully as it preserves shape. What is left is 218 points for the whole
 * mark, drawn as quadratics through the midpoints of the polygon so the curves
 * come back rounded rather than faceted.
 */
const SIGNATURE_PATH: readonly (readonly number[])[] = [
  [
    609.9, 2.3, 620.3, 2.1, 630.3, 4.6, 639.8, 10.6, 640.9, 14.6, 635.9, 17.3, 623.6, 14.5,
    601.4, 16.4, 582.9, 24.3, 561.2, 38.4, 536.8, 63.8, 523.8, 84.2, 509.9, 114.7, 504.4, 118.5,
    499.9, 117.8, 495.8, 114.2, 494.9, 107.6, 485.2, 113.3, 479.7, 114.5, 474.5, 113, 467.3,
    105.4, 467.4, 96.3, 475.4, 60, 475, 55.8, 452.7, 80.1, 420.9, 127.6, 412.7, 128.1, 407.7,
    120.9, 419.8, 90.8, 408.2, 100.9, 380.5, 119.1, 372.9, 121.7, 365.9, 121.2, 359.4, 116.8,
    355.6, 109.5, 357.5, 98.5, 367, 69.8, 367.2, 64.3, 333.1, 95.8, 297.5, 135, 292.7, 136.9,
    287.8, 136.3, 282.4, 130.8, 282.1, 127.2, 304.8, 73, 308.7, 61.4, 307.6, 59.6, 282.2, 83.1,
    252.7, 115.8, 182.1, 205.5, 177.4, 207.8, 169.4, 206.4, 166.6, 202.3, 167.2, 198.4, 200.9,
    133.2, 232.6, 79.5, 108.1, 109.7, 13.4, 137.9, 4.2, 137.4, 0, 130.2, 1.2, 126.5, 4.7, 124.6,
    108.7, 95.5, 242.3, 64.2, 269.8, 24.8, 274.1, 21.3, 282.1, 18.5, 286.9, 21.7, 284.3, 30.7,
    262.4, 61.7, 218.3, 135.1, 250, 97.5, 284.5, 61.3, 284, 58.4, 288.1, 57.8, 301, 46.7, 315,
    38.3, 320.1, 39.4, 324.6, 43.5, 326.3, 51.7, 322.9, 67.7, 311.8, 97.1, 349.2, 60.6, 368.3,
    47, 374.4, 45.8, 379.4, 47.8, 382.8, 52.1, 383.9, 61.9, 381.1, 76.2, 372, 102.9, 372, 105.7,
    373.8, 106.1, 426.1, 72.6, 423, 77.5, 426.5, 76.4, 447, 37, 451.4, 32.8, 456.3, 31.2, 461,
    33.1, 463.1, 38.5, 455.4, 54, 469.7, 41.9, 476.8, 38, 484.4, 38.5, 490.9, 45.2, 491.9, 55.5,
    482.8, 94.6, 484, 97.8, 508.4, 77.4, 527.5, 25.7, 532.1, 24.5, 537.9, 27.8, 540, 32.5,
    539.4, 39.5, 552.3, 28, 572, 15, 595.4, 4.9
  ],
  [
    985.7, 81.7, 993.8, 81.5, 997.6, 83.1, 1000, 86.9, 998.8, 92.4, 979.8, 98.3, 971.4, 95.4,
    944.3, 97.8, 808.1, 116.5, 558.6, 160.3, 468.3, 178.9, 364.1, 203.8, 280.4, 226.7, 211.6,
    248.1, 282.6, 236.7, 414.5, 212.3, 514, 199, 413.3, 222.7, 237.3, 258.4, 176.8, 268.6,
    150.1, 269.2, 145.3, 266.3, 142.2, 260, 142.5, 256.1, 145.3, 253.5, 255.9, 220.9, 377.6,
    188.6, 482.8, 164.7, 600.6, 141.6, 742.8, 116.6, 874.2, 96.2
  ],
  [
    733.6, 14, 745.8, 15.1, 751.7, 20.1, 754.1, 25.5, 753.8, 39.6, 747.1, 51.5, 743.7, 62.2,
    743.4, 78.8, 749.1, 78.5, 757.6, 74.6, 787, 55.8, 782.2, 65.5, 782, 70.2, 766.1, 85.3,
    752.7, 92.2, 744, 93.1, 734, 88.5, 729.4, 82.9, 726.3, 72.1, 696.2, 97.1, 685.8, 101.6,
    676.1, 99.7, 669.4, 92.3, 669, 87.8, 674.9, 73.6, 684, 59.2, 695.4, 44.2, 712.1, 27.5,
    725.1, 17.9
  ],
  [
    867.5, 0, 881, 0.5, 889.5, 3.7, 896.4, 10, 896.8, 14.5, 892.2, 16.5, 881.7, 12.3, 871.2,
    12.3, 858.9, 15.5, 846.9, 21.5, 833.5, 31.4, 820.8, 45.1, 813.4, 56.4, 800.8, 83.5, 795.5,
    85.9, 789.4, 83.5, 786.7, 80.1, 786.6, 75.5, 809.5, 12.8, 814.4, 10, 818.5, 10.9, 822.2, 15,
    823.2, 21.4, 846.1, 6.7
  ],
  [
    738.3, 27.2, 741.1, 27.6, 741.5, 30.4, 729, 47.5, 704.3, 72.5, 686.7, 84.6, 694.9, 68.6,
    712.1, 46.9, 728.5, 32.2
  ],
  [
    616.2, 97.3, 621.6, 97.3, 625.6, 99.5, 627.1, 104.6, 625.2, 108.6, 619, 110, 614.1, 107.1,
    612.2, 101
  ],
]

/** Height of the signature's box, in the same units its x runs 0..1000 in. */
const SIGNATURE_RISE = 269.2

/** Front: the mark sits low and left, the network mark low and right. */
const WORDMARK_LEFT = MARGIN + 40
const WORDMARK_BASELINE = 486
const SUBBRAND_BASELINE = 544
const NETWORK_RIGHT = WIDTH - MARGIN - 32
const NETWORK_BASELINE = 560

/** Back: one column of data, and the same left margin as the front's mark. */
const TEXT_LEFT = MARGIN + 40
const NUMBER_BASELINE = 300
const CAPTION_BASELINE = 380
const EXPIRY_BASELINE = 422
const NAME_BASELINE = 520

const CHIP: Rect = { x: 96, y: 168, width: 128, height: 98 }
const CONTACTLESS = { x: 300, y: 217, radius: 62 }

/**
 * The signature panel, hoisted out of the drawing that used to own it.
 *
 * It is here because the height field needs the same rectangle: an applied
 * strip stands very slightly off the body, and a panel that is a lighter colour
 * and nothing else reads as a printed patch. Two copies of the numbers would be
 * two chances to drift apart.
 */
const SIGNATURE_PANEL: Rect = {
  x: MARGIN,
  y: 104,
  width: (WIDTH - MARGIN * 2) * 0.66,
  height: 118,
}

/**
 * Wear, read off a photograph of a card that has actually been carried.
 *
 * Three things in that photograph, and they are three different populations
 * rather than one effect turned up:
 *
 * HAIRLINES are the bulk of it. A hundred and more per face, thinner than a
 * texel, running every which way with only a lean towards the travel axis, and
 * so faint that no single one is findable — what you see is that the surface
 * has stopped being perfect. This is the population that was got wrong first
 * time: a few wide marks with a groove under them, which is not a used card but
 * a clean card with scratches DRAWN on it.
 *
 * NICKS live on the rim and pile into the corners, because that is what a card
 * lands on. They are the only marks in the photograph you can point at
 * individually, and the only ones that took material off.
 *
 * HAZE is not a mark at all. It is the varnish having gone unevenly dull, and
 * it is what stops the other two reading as dirt on an otherwise showroom
 * surface.
 *
 * Seeded, and per face, because two things have to be true at once: the marks
 * must be identical on every load — they are geometry of this object, not an
 * effect — and the two faces must not carry the same ones, which is what a
 * shared generator would produce.
 */
const WEAR_SEED: Record<CardFace, number> = { front: 0x5c1ff3, back: 0x9ea127 }

/**
 * Ten, down from the ninety-five this was first tuned at.
 *
 * The count is not a dial on the same thing at both ends. Near a hundred the
 * marks are a TEXTURE — a field the eye reads as a surface finish, and a card
 * finished that way is a scuffed panel, not a carried one. At ten they are
 * EVENTS: few enough to notice one at a time, far enough apart that the card
 * between them is plainly intact, and rare enough that none of them claims to
 * be the point.
 *
 * Ten rather than five because the marks are tapered now, and a taper costs
 * about half of each mark's visible area — five full-width strokes and five
 * tapered ones are not the same amount of wear on the face. The count came back
 * up to pay for the shape, not to add damage.
 *
 * The contrast per mark deliberately stayed where the measurement put it.
 * Fewer marks must not become fainter ones: under roughly three texels of width
 * and five levels of lift a mark falls beneath this sheet's animated grain and
 * stops existing at all, which is the hole this was dug out of once already.
 */
const HAIRLINES = 10
const NICKS = 52
const HAZE_PATCHES = 16

/** A scratch, as a quadratic — a hair does not travel in a straight line. */
interface Hairline {
  x0: number
  y0: number
  /** Control point, offset off the chord so the mark bows. */
  cx: number
  cy: number
  x1: number
  y1: number
  /** Width in px at the mark's deepest point. Everywhere else is less. */
  width: number
  /** Where along the run the mark is deepest, 0..1. */
  peak: number
  /** Which end the tool bit at. The other end is the one it lifted off. */
  biteFirst: boolean
  /** 0..1, weighted so most are barely there and a few are not. */
  strength: number
}

/** Material taken off an edge or a corner. */
interface Nick {
  x: number
  y: number
  /** Reach into the face from the rim. */
  length: number
  angle: number
  width: number
  strength: number
}

/** A patch of varnish gone dull. Soft, large, and never an edge. */
interface Haze {
  x: number
  y: number
  radius: number
  strength: number
}

interface Wear {
  hairlines: Hairline[]
  nicks: Nick[]
  haze: Haze[]
}

/**
 * mulberry32 — small, fast, and above all repeatable.
 *
 * `Math.random` would give a different card on every reload, and this file's
 * whole contract is that it paints the same object every time, offline and on
 * first frame.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Everything that has happened to one face, in the order it happened.
 *
 * Called separately by the print and by the height field rather than shared
 * through a cached list: same seed, same sequence, same marks. The two passes
 * do not draw the same populations — hairlines never reach the height field —
 * but where they do overlap they overlap exactly, which is the only reason a
 * nick reads as one event rather than as a smudge beside a dent.
 */
function createWear(seed: number): Wear {
  const random = seededRandom(seed)
  const hairlines: Hairline[] = []
  const nicks: Nick[] = []
  const haze: Haze[] = []

  // Pushes a uniform 0..1 towards whichever end it is nearer. Half the marks
  // go through it, which is what gives the face a worn rim and a comparatively
  // untouched middle instead of an even field of scratches — the even field is
  // what makes a card read as scratched acrylic rather than as carried.
  const towardsEdge = (t: number): number =>
    t < 0.5 ? 0.5 - (1 - t * 2) ** 0.6 / 2 : 0.5 + (t * 2 - 1) ** 0.6 / 2

  for (let index = 0; index < HAIRLINES; index++) {
    const crowded = random() < 0.5
    const x0 = WIDTH * (crowded ? towardsEdge(random()) : random())
    const y0 = HEIGHT * (crowded ? towardsEdge(random()) : random())
    // A lean rather than a rule. Most of the marks in the photograph do follow
    // the way the card travels, but plenty do not, and a field where every mark
    // agrees reads as brushed metal instead of as handling.
    const angle = random() < 0.58 ? (random() - 0.5) * 0.8 : (random() - 0.5) * Math.PI * 2
    // Long enough to read as a stroke, short enough to end inside the face. At
    // 300 they crossed the whole card and the eye stopped seeing damage and
    // started seeing a crazed panel.
    const length = 30 + random() ** 1.9 * 145
    const x1 = x0 + Math.cos(angle) * length
    const y1 = y0 + Math.sin(angle) * length
    // Bow the midpoint off the chord by a few percent of the run. Small enough
    // that no mark looks curved, large enough that no two look parallel.
    const bow = (random() - 0.5) * length * 0.07
    hairlines.push({
      x0,
      y0,
      cx: (x0 + x1) / 2 - Math.sin(angle) * bow,
      cy: (y0 + y1) / 2 + Math.cos(angle) * bow,
      x1,
      y1,
      // Two to four texels, which is wider than a scratch really is and is not
      // a mistake. The sheet carries an animated film grain measured at ~9.5
      // levels of per-pixel deviation, at roughly one and a half pixels a cell.
      // A one-texel mark is the SAME SIZE as that noise and a couple of levels
      // beneath it, so it does not read as faint — it does not read at all, and
      // a render with it and a render without it measure identical. What
      // separates a mark from grain is scale: over three or four pixels the
      // noise averages towards nothing while the mark keeps all of its
      // contrast, and the eye picks the line out of the boil.
      width: 1.2 + random() ** 2 * 1.6,
      // Never the middle. A scratch deepest at its exact centre is a shape
      // nothing makes; the contact point is wherever the pressure happened to
      // be, and putting it there is most of what stops the mark reading drawn.
      peak: 0.18 + random() * 0.5,
      biteFirst: random() < 0.5,
      strength: 0.22 + random() ** 2.2 * 0.78,
    })
  }

  for (let index = 0; index < NICKS; index++) {
    // Along the rim, pushed towards the ends of whichever edge it landed on:
    // a card is dropped on its corners far more often than on its middle.
    const edge = Math.floor(random() * 4)
    const raw = random()
    const along = raw < 0.5 ? raw * raw * 2 : 1 - (1 - raw) ** 2 * 2
    const inset = random() * 5

    let x = 0
    let y = 0
    let inward = 0
    if (edge === 0) {
      x = WIDTH * along
      y = inset
      inward = Math.PI / 2
    } else if (edge === 1) {
      x = WIDTH * along
      y = HEIGHT - inset
      inward = -Math.PI / 2
    } else if (edge === 2) {
      x = inset
      y = HEIGHT * along
      inward = 0
    } else {
      x = WIDTH - inset
      y = HEIGHT * along
      inward = Math.PI
    }

    nicks.push({
      x,
      y,
      // Mostly into the face, but skewed, because an impact rarely lands square
      // and a rim of marks all at ninety degrees reads as a printed dashed line.
      angle: inward + (random() - 0.5) * 1.5,
      length: 3 + random() ** 1.6 * 16,
      width: 1.4 + random() * 2.6,
      strength: 0.35 + random() ** 1.6 * 0.65,
    })
  }

  for (let index = 0; index < HAZE_PATCHES; index++) {
    haze.push({
      x: WIDTH * random(),
      y: HEIGHT * random(),
      // Mottling, not a wash. The first version spread six patches over three
      // hundred texels each, which is a change of a level or two across half the
      // card — under every threshold there is. Smaller and more of them puts the
      // variation at a scale the eye actually samples.
      radius: 70 + random() * 150,
      strength: 0.35 + random() * 0.65,
    })
  }

  return { hairlines, nicks, haze }
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface CardNumberStyle {
  font: string
  /** Extra advance per glyph, in px. Negative tightens. */
  tracking: number
  ink: string
  /** Soft cast shadow that lifts flat type off the body without embossing it. */
  shadow: string
}

interface ContactlessOptions {
  x: number
  y: number
  /** Radius of the outermost arc. */
  radius: number
  color: string
  lineWidth: number
}

function createSurface(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (context === null) {
    throw new Error('cardFaceTexture: 2D canvas context is unavailable, cannot draw the card face')
  }

  return context
}

/**
 * Draws text one glyph at a time so tracking is applied literally.
 *
 * This forfeits kerning pairs, which is the point: the layout below depends on
 * predictable advances, and the wordmark's tightening has to survive whatever
 * the host substitutes for the generic families.
 */
function fillTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  tracking: number,
): void {
  let cursor = x
  for (const glyph of text) {
    ctx.fillText(glyph, cursor, baseline)
    cursor += ctx.measureText(glyph).width + tracking
  }
}

/** The advance `fillTracked` consumes, needed to place the next group. */
function trackedWidth(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  let total = 0
  for (const glyph of text) {
    total += ctx.measureText(glyph).width + tracking
  }
  return total
}

/**
 * The matte body: a flat brand orange, a fine woven tooth, and a vignette.
 *
 * Flat is the hard part. The reference card has no gradient across it at all —
 * it is one colour of pigmented PVC — and a body drawn as a literal flat fill
 * comes out looking like coloured paper, because a real matte surface is never
 * uniform at close range. The tooth is what fixes that, and it has to be laid
 * in the ALBEDO rather than left to the material's roughness: roughness varies
 * the highlight, and this card is matte precisely so that it has almost no
 * highlight to vary.
 *
 * The hatch pitch is deliberately coarse enough to survive mipmapping. Finer
 * would be more faithful to the photograph and would turn into a moiré the
 * moment the card is seen at an angle, which is most of the time here.
 */
function fillMatteBody(ctx: CanvasRenderingContext2D, body: string): void {
  ctx.fillStyle = body
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  ctx.save()
  ctx.lineWidth = 1
  const pitch = 5
  // Two crossing runs rather than one: a single direction reads as brushing,
  // and the reference's tooth is woven.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)'
  ctx.beginPath()
  for (let x = -HEIGHT; x < WIDTH; x += pitch) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x + HEIGHT, HEIGHT)
  }
  ctx.stroke()

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.035)'
  ctx.beginPath()
  for (let x = 0; x < WIDTH + HEIGHT; x += pitch) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x - HEIGHT, HEIGHT)
  }
  ctx.stroke()
  ctx.restore()

  // Corners fall away slightly, which is what a card photographed on a flat
  // surface does. Radial rather than linear so no edge is favoured.
  const vignette = ctx.createRadialGradient(
    WIDTH * 0.45,
    HEIGHT * 0.4,
    HEIGHT * 0.2,
    WIDTH * 0.5,
    HEIGHT * 0.5,
    WIDTH * 0.72,
  )
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, 'rgba(60, 20, 0, 0.16)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
}

/**
 * The plate's outline. Shared, because the print and the height field both need
 * it and a chip whose ink and whose relief disagree by a pixel reads as a
 * misregistered sticker.
 */
function chipPlatePath(ctx: CanvasRenderingContext2D, rect: Rect, grow = 0): void {
  ctx.beginPath()
  ctx.roundRect(
    rect.x - grow,
    rect.y - grow,
    rect.width + grow * 2,
    rect.height + grow * 2,
    12 + grow,
  )
}

/**
 * The pad gaps: two horizontal splits into three bands, one vertical split
 * through the outer bands. The middle band keeps its own island.
 */
function chipGapPath(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, width, height } = rect
  const thirdY = height / 3
  ctx.beginPath()
  ctx.moveTo(x, y + thirdY)
  ctx.lineTo(x + width, y + thirdY)
  ctx.moveTo(x, y + thirdY * 2)
  ctx.lineTo(x + width, y + thirdY * 2)
  ctx.moveTo(x + width / 2, y)
  ctx.lineTo(x + width / 2, y + thirdY)
  ctx.moveTo(x + width / 2, y + thirdY * 2)
  ctx.lineTo(x + width / 2, y + height)
}

/**
 * The module — a rounded island in the middle band, and the one feature that
 * separates a chip from a grid of squares.
 */
function chipModulePath(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const thirdY = rect.height / 3
  ctx.beginPath()
  ctx.roundRect(
    rect.x + rect.width * 0.24,
    rect.y + thirdY + rect.height * 0.06,
    rect.width * 0.52,
    thirdY - rect.height * 0.12,
    5,
  )
}

/**
 * The EMV contact plate.
 *
 * Eight pads around a central module, which is the layout on the reference and
 * on every chip card in a pocket. The earlier three-bar version read as a chip
 * at thumbnail size and as nothing in particular once the card fills the
 * screen, which on this piece it does.
 *
 * The pad gaps are drawn as strokes over the plate rather than as gaps between
 * filled pads, so the chip stays fully opaque for the ink-coverage mask — the
 * material reads this texture's alpha, and a hole here punches through the
 * print.
 *
 * What is painted here is the plate's COLOUR and its occlusion, and nothing
 * that pretends to be light. The seam is a contact shadow — a milled pocket
 * traps light at its wall no matter where the light is — and the brushing is
 * the plating's own finish. The highlight that makes the plate sit proud comes
 * from the height field instead, because this card can be turned over and spun
 * in the hand, and a highlight baked into the artwork is a lie the moment the
 * card faces anywhere but the way it was painted for.
 */
function drawChip(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, width, height } = rect

  const gold = ctx.createLinearGradient(x, y, x + width, y + height)
  gold.addColorStop(0, '#f0dcae')
  gold.addColorStop(0.42, '#d9bd7f')
  gold.addColorStop(1, '#b2914c')

  ctx.save()

  // The seat. Three passes rather than one stroke, so the shadow falls off
  // instead of ending in a drawn line — the pocket's wall is a slope.
  for (let pass = 3; pass >= 1; pass--) {
    chipPlatePath(ctx, rect, pass)
    ctx.strokeStyle = `rgba(92, 38, 2, ${0.1 / pass})`
    ctx.lineWidth = 2
    ctx.stroke()
  }

  chipPlatePath(ctx, rect)
  ctx.fillStyle = gold
  ctx.fill()

  ctx.clip()

  // The plating's finish: fine lines across the plate, well under the contrast
  // of the pad gaps. Contact plates are not mirrors — they are lightly brushed,
  // and a perfectly smooth gold gradient is the tell that this is a drawing.
  ctx.lineWidth = 1
  for (let line = 0; line < height; line += 3) {
    ctx.strokeStyle = line % 6 === 0 ? 'rgba(255, 248, 224, 0.09)' : 'rgba(88, 66, 22, 0.07)'
    ctx.beginPath()
    ctx.moveTo(x, y + line + 0.5)
    ctx.lineTo(x + width, y + line + 0.5)
    ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(74, 56, 20, 0.55)'
  ctx.lineWidth = 3.5
  chipGapPath(ctx, rect)
  ctx.stroke()

  chipModulePath(ctx, rect)
  ctx.stroke()
  ctx.restore()
}

/** Four nested arcs opening to the right — the contactless payment symbol. */
function drawContactless(ctx: CanvasRenderingContext2D, options: ContactlessOptions): void {
  const spread = (50 * Math.PI) / 180

  ctx.save()
  ctx.strokeStyle = options.color
  ctx.lineWidth = options.lineWidth
  ctx.lineCap = 'round'
  for (let index = 0; index < 4; index++) {
    ctx.beginPath()
    ctx.arc(options.x, options.y, options.radius * (0.32 + index * 0.2267), -spread, spread)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * The wordmark, in the brand's own two-part construction.
 *
 * "Mandarina" and "X" are one word set in one weight and one colour — the split
 * the page header makes, tinting the X, is a UI affordance and not the logo.
 * The reference card sets the whole thing in white, and a card is where a brand
 * is least free to improvise.
 *
 * Returns the advance it consumed so the sub-brand line beneath can be placed
 * against the mark rather than against a number copied from here.
 */
function drawWordmark(ctx: CanvasRenderingContext2D, x: number, baseline: number): number {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 76px sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  fillTracked(ctx, 'MandarinaX', x, baseline, -1)
  const advance = trackedWidth(ctx, 'MandarinaX', -1)
  ctx.restore()
  return advance
}

/**
 * The network mark, set rather than drawn as artwork.
 *
 * Right-aligned off `NETWORK_RIGHT`, because the thing that has to stay put is
 * its right edge against the card's — a left-aligned mark drifts across the
 * corner the moment the host substitutes a wider italic.
 */
function drawNetworkMark(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'italic 800 62px sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'right'
  ctx.fillText('VISA', NETWORK_RIGHT, NETWORK_BASELINE)
  ctx.restore()
}

/** The primary account number, one ink and one run — it crosses nothing. */
function drawCardNumber(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseline: number,
  style: CardNumberStyle,
): void {
  ctx.save()
  ctx.font = style.font
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = style.ink
  ctx.shadowColor = style.shadow
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 3
  fillTracked(ctx, CARD_NUMBER, x, baseline, style.tracking)
  ctx.restore()
}

/** The point on a mark's curve at t. */
function hairlinePoint(mark: Hairline, t: number): [number, number] {
  const u = 1 - t
  return [
    u * u * mark.x0 + 2 * u * t * mark.cx + t * t * mark.x1,
    u * u * mark.y0 + 2 * u * t * mark.cy + t * t * mark.y1,
  ]
}

/** Its direction there, analytically — a quadratic's derivative is free. */
function hairlineTangent(mark: Hairline, t: number): [number, number] {
  const u = 1 - t
  return [
    2 * u * (mark.cx - mark.x0) + 2 * t * (mark.x1 - mark.cx),
    2 * u * (mark.cy - mark.y0) + 2 * t * (mark.y1 - mark.cy),
  ]
}

/**
 * How much of the mark's full width survives at t. Zero at both ends, one at
 * the peak.
 *
 * Asymmetric, and that is the whole point of having a profile at all. A scratch
 * is not a spindle: something catches, which happens over almost no distance,
 * and then lifts away, which happens over a lot of it. Rise and fall are the
 * same two exponents in whichever order the mark was made — one under 1 for the
 * end that bit, one over 1 for the end that let go. Give both ends the same
 * curve and the mark comes back looking machined.
 */
function hairlineProfile(mark: Hairline, t: number): number {
  const rise = mark.biteFirst ? 0.5 : 1.8
  const fall = mark.biteFirst ? 1.8 : 0.5
  return t < mark.peak
    ? (t / mark.peak) ** rise
    : ((1 - t) / (1 - mark.peak)) ** fall
}

/**
 * One mark, as a shape rather than as a stroke.
 *
 * A stroke has one width for its whole length, and a constant-width line is the
 * tell that separates a drawn scratch from a real one — the eye reads uniform
 * thickness as a tool that was told to draw, not one that slipped. So the
 * outline is built by walking the curve and offsetting it by the profile.
 *
 * ONE filled path, not a run of segments at stepped widths. Segments would need
 * round caps to close the joins, every join would then be drawn twice, and at
 * these alphas twice is visible: the mark comes back beaded, which trades one
 * artificial look for another. A single fill composites exactly once.
 *
 * The fade along the length rides in a gradient rather than in the geometry,
 * because a scratch loses BOTH depth and bite towards its ends and only one of
 * those is a width. Square-rooted so the two do not compound into a mark that
 * is invisible everywhere except one point in the middle.
 */
function fillHairline(ctx: CanvasRenderingContext2D, mark: Hairline, alpha: number): void {
  const STEPS = 26
  const near: [number, number][] = []
  const far: [number, number][] = []

  for (let step = 0; step <= STEPS; step++) {
    const t = step / STEPS
    const [x, y] = hairlinePoint(mark, t)
    const [dx, dy] = hairlineTangent(mark, t)
    const run = Math.hypot(dx, dy) || 1
    const half = (mark.width * hairlineProfile(mark, t)) / 2
    const nx = (-dy / run) * half
    const ny = (dx / run) * half
    near.push([x + nx, y + ny])
    far.push([x - nx, y - ny])
  }

  const [headX, headY] = hairlinePoint(mark, 0)
  const [tailX, tailY] = hairlinePoint(mark, 1)
  const ink = ctx.createLinearGradient(headX, headY, tailX, tailY)
  for (let stop = 0; stop <= 10; stop++) {
    const t = stop / 10
    ink.addColorStop(t, `rgba(255, 247, 238, ${alpha * Math.sqrt(hairlineProfile(mark, t))})`)
  }

  ctx.beginPath()
  const [firstX, firstY] = near[0] as [number, number]
  ctx.moveTo(firstX, firstY)
  for (let index = 1; index < near.length; index++) {
    const [x, y] = near[index] as [number, number]
    ctx.lineTo(x, y)
  }
  for (let index = far.length - 1; index >= 0; index--) {
    const [x, y] = far[index] as [number, number]
    ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = ink
  ctx.fill()
}

/**
 * The wear, in the print.
 *
 * Lighter than the body and never darker, which is the part that is easy to get
 * backwards: a scuff on a varnished card is not dirt sitting on the surface, it
 * is varnish taken OFF it, and a micro-abraded patch scatters more light than
 * the polish it replaced. Drawn dark it reads as a smudge on the screen; drawn
 * light it reads as a card that has been somewhere.
 *
 * Haze first, then hairlines, then nicks — dullest and largest to sharpest and
 * smallest, which is also the order they happen in. And all of it last, over
 * the type as well as the body, because none of this respects the artwork
 * underneath it.
 *
 * The alphas are small to the point of looking like typos. They are not: at a
 * hundred and forty marks a face what is being built is a STATISTIC, and any
 * single mark strong enough to find on its own is a mark strong enough to make
 * the card look damaged rather than used.
 */
function drawWear(ctx: CanvasRenderingContext2D, wear: Wear): void {
  ctx.save()

  for (const patch of wear.haze) {
    const bloom = ctx.createRadialGradient(patch.x, patch.y, 0, patch.x, patch.y, patch.radius)
    bloom.addColorStop(0, `rgba(255, 246, 236, ${0.11 * patch.strength})`)
    bloom.addColorStop(1, 'rgba(255, 246, 236, 0)')
    ctx.fillStyle = bloom
    ctx.fillRect(patch.x - patch.radius, patch.y - patch.radius, patch.radius * 2, patch.radius * 2)
  }

  for (const mark of wear.hairlines) {
    fillHairline(ctx, mark, 0.22 * mark.strength)
  }

  ctx.lineCap = 'round'

  // The rim, pale before any individual nick is placed. Irregular by being
  // drawn per nick rather than as a ring: a card does not wear evenly around
  // its edge, and a clean gradient border is the single most synthetic thing
  // that can be put on one.
  for (const nick of wear.nicks) {
    ctx.strokeStyle = `rgba(255, 242, 230, ${0.22 * nick.strength})`
    ctx.lineWidth = nick.width
    ctx.beginPath()
    ctx.moveTo(nick.x, nick.y)
    ctx.lineTo(
      nick.x + Math.cos(nick.angle) * nick.length,
      nick.y + Math.sin(nick.angle) * nick.length,
    )
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * The face the card is recognised by: flat orange, the mark, the network, and
 * the two pieces of hardware. Nothing else.
 *
 * The restraint is the design. Every element removed from here is one the eye
 * does not have to sort past before it reaches the mark, and this card is seen
 * for a fraction of a second at a time inside a moving stack.
 */
function drawFront(ctx: CanvasRenderingContext2D): void {
  fillMatteBody(ctx, BODY_ORANGE)

  drawChip(ctx, CHIP)
  drawContactless(ctx, {
    ...CONTACTLESS,
    // White, matching the print rather than the plate. On the reference this
    // symbol belongs to the ink layer, not to the chip it sits beside.
    color: 'rgba(255, 255, 255, 0.95)',
    lineWidth: 9,
  })

  drawWordmark(ctx, WORDMARK_LEFT, WORDMARK_BASELINE)

  ctx.save()
  // Lighter than the mark and noticeably smaller: it names the product, and a
  // sub-brand set at the mark's weight competes with it for the same glance.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
  ctx.font = '400 40px sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  fillTracked(ctx, 'Crédito', WORDMARK_LEFT + 4, SUBBRAND_BASELINE, 0.5)
  ctx.restore()

  drawNetworkMark(ctx)

  drawWear(ctx, createWear(WEAR_SEED.front))
}

/**
 * The one hand-made mark on the card.
 *
 * Laid into the panel rather than onto the body, because that is what a
 * signature panel is: a receptive strip over a surface that ink will not take.
 *
 * Fitted by HEIGHT and left-aligned, not stretched to the strip. The mark is
 * roughly four times as wide as it is tall and the panel is twelve, so filling
 * the panel would mean distorting a person's hand to suit a rectangle — and a
 * signature that reaches both ends of its box is the one thing no real one
 * does. What sets the scale is the panel's height, which is why the panel grew:
 * a strip too shallow to hold a signature is a decoration, not a panel.
 *
 * Ink rather than black. A pen on a pale panel is never neutral — it is blue or
 * it is brown-black — and pure black over this cream reads as toner.
 */
function drawSignature(ctx: CanvasRenderingContext2D, panel: Rect): void {
  const scale = (panel.height * 0.86) / SIGNATURE_RISE

  ctx.save()
  ctx.translate(panel.x + 38, panel.y + panel.height * 0.09)
  ctx.scale(scale, scale)
  ctx.fillStyle = 'rgba(28, 34, 68, 0.88)'

  ctx.beginPath()
  for (const contour of SIGNATURE_PATH) {
    const count = contour.length / 2
    // Quadratics through the midpoints of the polygon: each stored point
    // becomes a control point rather than a corner, which is what turns a
    // simplified outline back into the curve it was simplified from.
    const at = (i: number): [number, number] => {
      const k = (((i % count) + count) % count) * 2
      return [contour[k] as number, contour[k + 1] as number]
    }
    const [lx, ly] = at(-1)
    const [fx, fy] = at(0)
    ctx.moveTo((lx + fx) / 2, (ly + fy) / 2)
    for (let i = 0; i < count; i++) {
      const [ax, ay] = at(i)
      const [bx, by] = at(i + 1)
      ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2)
    }
    ctx.closePath()
  }
  ctx.fill('evenodd')

  ctx.restore()
}

/**
 * The reverse, which is where the account data went.
 *
 * A deeper orange than the front and the same tooth over it. Deeper because the
 * back of a real card is the same pigment under a different finish and reads a
 * shade heavier, and because it gives the white print something to sit on: this
 * face carries far more type than the front and it is the one place on the card
 * where white on orange has to be legible rather than merely branded.
 */
function drawBack(ctx: CanvasRenderingContext2D): void {
  fillMatteBody(ctx, '#d76302')

  // The signature panel, the only light field on either face. Kept because the
  // number sits above it and needs the eye to have somewhere to stop.
  // Not the full width, which is both what a real panel does and what this one
  // needs. A strip running edge to edge leaves two thirds of itself empty
  // beside a signature the size a hand actually writes — and the emptiness
  // reads as a missing element rather than as space. Ended where the mark ends
  // and the body takes the rest, the way the CVV box does on a printed card.
  const panel = SIGNATURE_PANEL
  ctx.save()
  ctx.fillStyle = 'rgba(255, 248, 240, 0.92)'
  ctx.beginPath()
  ctx.roundRect(panel.x, panel.y, panel.width, panel.height, 6)
  ctx.fill()
  ctx.restore()

  drawSignature(ctx, panel)

  drawCardNumber(ctx, TEXT_LEFT, NUMBER_BASELINE, {
    font: 'bold 54px sans-serif',
    tracking: 2,
    ink: '#ffffff',
    shadow: 'rgba(96, 34, 0, 0.35)',
  })

  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.font = '700 20px sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  fillTracked(ctx, 'VALID THRU', TEXT_LEFT, CAPTION_BASELINE, 4)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 38px sans-serif'
  fillTracked(ctx, EXPIRY, TEXT_LEFT, EXPIRY_BASELINE, 1)

  ctx.font = 'bold 38px sans-serif'
  fillTracked(ctx, CARDHOLDER, TEXT_LEFT, NAME_BASELINE, 1.5)
  ctx.restore()

  drawNetworkMark(ctx)

  drawWear(ctx, createWear(WEAR_SEED.back))
}

/**
 * Paints one printed card face and hands it back as a texture.
 *
 * Everything is drawn procedurally — no images, no fonts beyond the generic
 * families — so the stack renders byte-identically offline and on first paint.
 * Both faces cover the full rect opaquely before anything else lands: the
 * material reads this texture's alpha as an ink-coverage mask, so a single
 * transparent pixel would punch a hole through the print.
 * The canvas corners stay square because the card's rounded silhouette comes
 * from the geometry, not from this artwork.
 */
export function createCardFaceTexture(face: CardFace): CanvasTexture {
  const ctx = createSurface(WIDTH, HEIGHT)

  if (face === 'front') {
    drawFront(ctx)
  } else {
    drawBack(ctx)
  }

  const texture = new CanvasTexture(ctx.canvas)
  texture.colorSpace = SRGBColorSpace

  return texture
}


/**
 * Grey levels in the height field, 0..255. Mid grey is the card's own surface,
 * so a mark can cut BELOW it as well as stand above — which is the whole reason
 * the base is not black.
 *
 * The numbers are chosen for the tilt they end up producing, not for how tall
 * anything is in millimetres. The shader differentiates this field over a fixed
 * ±0.006 of uv — about six texels across — and multiplies the difference by
 * `decalRelief`. The plate's 56 levels are 0.22 of the range, so at the 0.85
 * this card runs the shoulder turns the normal by roughly eleven degrees: a
 * step you can see the light break over, and nothing like the wall that 0.22
 * unscaled would have built.
 *
 * The scuffs are a fourteenth of that. They are meant to catch the highlight as
 * it sweeps past and to be invisible the rest of the time, which is what a
 * scratch on a card in your hand actually does.
 */
const RELIEF_BASE = 128
const RELIEF_PLATE = 184
const RELIEF_MODULE = 198
const RELIEF_GAP = 150
const RELIEF_PANEL = 143

/** How many texels the plate takes to climb out of its pocket. */
const RELIEF_SHOULDER = 4

function grey(level: number): string {
  const value = Math.round(level)
  return `rgb(${value}, ${value}, ${value})`
}

/**
 * The chip, as height.
 *
 * A contact plate is milled into the card and sits a hair proud of it, and that
 * hair is the entire difference between hardware and a gold rectangle printed
 * on plastic. The pad gaps go the other way — they are cut INTO the plate, not
 * through it — so they stop above the body rather than returning to it.
 */
function drawChipRelief(ctx: CanvasRenderingContext2D, rect: Rect): void {
  // The pocket wall as a short ramp instead of a cliff. A cliff is not more
  // correct, it is just narrower than the shader's sampling window, and what
  // comes back is a wire outline around the chip.
  //
  // The ramp climbs INWARD, entirely inside the plate's own footprint. Run
  // outward instead — which is what the first pass did — and the raised strip
  // lands on the orange body, where it takes a specular the plate should have
  // taken and reads as a pink halo bleeding off the chip. The wall belongs to
  // the edge of the metal, not to the card around it.
  for (let step = RELIEF_SHOULDER; step >= 0; step--) {
    const climbed = 1 - step / RELIEF_SHOULDER
    ctx.fillStyle = grey(RELIEF_BASE + (RELIEF_PLATE - RELIEF_BASE) * climbed)
    chipPlatePath(ctx, rect, -step)
    ctx.fill()
  }

  ctx.save()
  chipPlatePath(ctx, rect)
  ctx.clip()

  ctx.strokeStyle = grey(RELIEF_GAP)
  ctx.lineWidth = 4
  chipGapPath(ctx, rect)
  ctx.stroke()

  // The module stands proud of the pads around it, over its own one-texel
  // shoulder — it is a separate part seated in the plate, not an etched line.
  ctx.strokeStyle = grey((RELIEF_PLATE + RELIEF_MODULE) / 2)
  ctx.lineWidth = 3
  chipModulePath(ctx, rect)
  ctx.stroke()
  ctx.fillStyle = grey(RELIEF_MODULE)
  chipModulePath(ctx, rect)
  ctx.fill()
  ctx.restore()
}

/** The signature panel: an applied strip, so it stands very slightly off. */
function drawPanelRelief(ctx: CanvasRenderingContext2D, panel: Rect): void {
  ctx.save()
  ctx.strokeStyle = grey((RELIEF_BASE + RELIEF_PANEL) / 2)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(panel.x, panel.y, panel.width, panel.height, 6)
  ctx.stroke()
  ctx.fillStyle = grey(RELIEF_PANEL)
  ctx.fill()
  ctx.restore()
}

/**
 * Of all that wear, the part that actually took material off.
 *
 * The nicks alone. The hairlines are deliberately absent, and their absence is
 * the correction that mattered most: given a groove they catch the specular,
 * and a fine mark that catches the specular stops being a fine mark — it
 * becomes a lit band, which is exactly how a hundred hairlines turned into a
 * handful of harsh streaks the first time round. On a real card a scratch that
 * shallow changes what the surface SCATTERS, not which way it faces.
 *
 * Shallow even here. A chipped rim is a fraction of the step the chip stands
 * at, and the whole point of a shared height field is that the two stay in
 * proportion to each other.
 */
function drawWearRelief(ctx: CanvasRenderingContext2D, wear: Wear): void {
  ctx.save()
  ctx.lineCap = 'round'
  for (const nick of wear.nicks) {
    ctx.strokeStyle = grey(RELIEF_BASE - 10 * nick.strength)
    // A shade wider than the ink. A pit has walls and the ink does not, and a
    // stroke narrower than the shader's sampling window loses depth to it.
    ctx.lineWidth = nick.width + 1.4
    ctx.beginPath()
    ctx.moveTo(nick.x, nick.y)
    ctx.lineTo(
      nick.x + Math.cos(nick.angle) * nick.length,
      nick.y + Math.sin(nick.angle) * nick.length,
    )
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Moves the height field into the alpha channel it is read from.
 *
 * The field has to ARRIVE in alpha — that is where the shader looks — but it
 * cannot be PAINTED there. Canvas composites alpha rather than assigning it, so
 * a groove crossing the chip would add to the plate instead of cutting into it,
 * and every overlap would climb towards opaque. So the whole field is drawn in
 * opaque grey, where overlapping strokes simply replace what is under them, and
 * moved across in one pass at the end.
 *
 * The colour channels are flattened to white on the way. Nothing samples them,
 * and leaving the greys behind would only invite someone to.
 */
function bakeHeightIntoAlpha(ctx: CanvasRenderingContext2D): void {
  const image = ctx.getImageData(0, 0, WIDTH, HEIGHT)
  const { data } = image
  for (let index = 0; index < data.length; index += 4) {
    data[index + 3] = data[index] as number
    data[index] = 255
    data[index + 1] = 255
    data[index + 2] = 255
  }
  ctx.putImageData(image, 0, 0)
}

/**
 * The same card, as the surface it is rather than the picture it carries.
 *
 * A second map and not a second channel of the first, and that is forced: the
 * printed faces cover their rect opaquely because the material reads the
 * decal's alpha as ink coverage, and an alpha that never varies has no gradient
 * for the emboss chunk to differentiate. The two uses genuinely collide on a
 * card, where every other layer in this stack gets to share them.
 *
 * Everything on it is drawn from the same constants and the same seeds as the
 * print, so the relief and the ink are two readings of one object.
 */
export function createCardReliefTexture(face: CardFace): CanvasTexture {
  const ctx = createSurface(WIDTH, HEIGHT)

  ctx.fillStyle = grey(RELIEF_BASE)
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  if (face === 'front') {
    drawChipRelief(ctx, CHIP)
  } else {
    drawPanelRelief(ctx, SIGNATURE_PANEL)
  }

  drawWearRelief(ctx, createWear(WEAR_SEED[face]))
  bakeHeightIntoAlpha(ctx)

  // No colour space is declared, unlike the printed face. Only alpha is read
  // here and no transfer function touches alpha, so tagging this sRGB would
  // describe a decode that never happens.
  return new CanvasTexture(ctx.canvas)
}
