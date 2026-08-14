import { CanvasTexture, SRGBColorSpace } from 'three'

export type CardFace = 'front' | 'back'

/** ISO/IEC 7810 ID-1 aspect (1.586:1) at a size that stays crisp at ~400px on screen. */
const WIDTH = 1024
const HEIGHT = 646

/** No printed element is allowed to reach past this inset. */
const MARGIN = 48

/**
 * The card body, measured off the reference render of the finished card.
 *
 * Deliberately NOT the logo's #FF5000. That value is an ink and this is a
 * pigmented PVC body photographed under light; they are two different things
 * and the render says so. The logo ink still governs everywhere the mark itself
 * is drawn — the page header, the isotype — and this governs the object.
 */
const BODY_ORANGE = '#f6840f'

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
const CARDHOLDER = 'Lee M. Cardholder'

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
 */
function drawChip(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, width, height } = rect

  const gold = ctx.createLinearGradient(x, y, x + width, y + height)
  gold.addColorStop(0, '#f0dcae')
  gold.addColorStop(0.42, '#d9bd7f')
  gold.addColorStop(1, '#b2914c')

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, 12)
  ctx.fillStyle = gold
  ctx.fill()

  ctx.clip()
  ctx.strokeStyle = 'rgba(74, 56, 20, 0.55)'
  ctx.lineWidth = 3.5

  // Two horizontal gaps split the plate into three bands, and one vertical gap
  // splits the outer bands into pads. The middle band keeps its own island.
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
  ctx.stroke()

  // The module: a rounded island in the middle band, the one feature that
  // separates a chip from a grid of squares.
  ctx.beginPath()
  ctx.roundRect(x + width * 0.24, y + thirdY + height * 0.06, width * 0.52, thirdY - height * 0.12, 5)
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
 * "Naranja" and "X" are one word set in one weight and one colour — the split
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
  fillTracked(ctx, 'NaranjaX', x, baseline, -1)
  const advance = trackedWidth(ctx, 'NaranjaX', -1)
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
 * The reverse, which is where the account data went.
 *
 * A deeper orange than the front and the same tooth over it. Deeper because the
 * back of a real card is the same pigment under a different finish and reads a
 * shade heavier, and because it gives the white print something to sit on: this
 * face carries far more type than the front and it is the one place on the card
 * where white on orange has to be legible rather than merely branded.
 */
function drawBack(ctx: CanvasRenderingContext2D): void {
  fillMatteBody(ctx, '#e06a05')

  // The signature panel, the only light field on either face. Kept because the
  // number sits above it and needs the eye to have somewhere to stop.
  ctx.save()
  ctx.fillStyle = 'rgba(255, 248, 240, 0.92)'
  ctx.beginPath()
  ctx.roundRect(MARGIN, 120, WIDTH - MARGIN * 2, 76, 6)
  ctx.fill()
  ctx.restore()

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
