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

  bakeHeightIntoAlpha(ctx)

  // No colour space is declared, unlike the printed face. Only alpha is read
  // here and no transfer function touches alpha, so tagging this sRGB would
  // describe a decode that never happens.
  return new CanvasTexture(ctx.canvas)
}
