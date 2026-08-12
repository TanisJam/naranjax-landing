import { CanvasTexture, SRGBColorSpace } from 'three'

export type CardFace = 'front' | 'back'

/** ISO/IEC 7810 ID-1 aspect (1.586:1) at a size that stays crisp at ~400px on screen. */
const WIDTH = 1024
const HEIGHT = 646

/** No printed element is allowed to reach past this inset. */
const MARGIN = 48

const TAU = Math.PI * 2

/**
 * The graphite/mint boundary as a fraction of the width, sampled at the top
 * edge, the vertical middle and the bottom edge.
 *
 * The seam is an S-curve, not a diagonal: it bulges right at mid-height and
 * pulls back at both ends, which is what makes the mint side read as a sweep
 * rather than a cut.
 */
const SEAM_TOP = 0.48
const SEAM_MIDDLE = 0.55
const SEAM_BOTTOM = 0.45

/** Half-width of the blend band that hides the seam's stair-stepping. */
const SEAM_FEATHER = 4

/** Shared layout, so the two faces line up when the card flips. */
const TEXT_LEFT = MARGIN + 40
const NUMBER_BASELINE = 430
const CAPTION_BASELINE = 492
const EXPIRY_BASELINE = 534
const NAME_BASELINE = 590
const CHIP: Rect = { x: 96, y: 196, width: 120, height: 92 }

const CARD_NUMBER = '5412 7512 3412 3456'
const EXPIRY = '12/28'
const CARDHOLDER = 'Lee M. Cardholder'

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
  /** Ink for every group but the last. */
  leadingGroups: string
  /** Ink for the trailing group, which on the front runs onto the mint side. */
  lastGroup: string
  /** Soft cast shadow that lifts flat type off the body without embossing it. */
  shadow: string
}

interface MastercardPalette {
  red: string
  amber: string
  overlap: string
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

/** Hermite ease, so the two halves of the seam meet with a matching slope. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/** The x where the S-curved seam crosses a given scanline. */
function seamXAt(y: number): number {
  const t = Math.min(Math.max(y / HEIGHT, 0), 1)

  const [from, to, local] =
    t < 0.5 ? [SEAM_TOP, SEAM_MIDDLE, t / 0.5] : [SEAM_MIDDLE, SEAM_BOTTOM, (t - 0.5) / 0.5]

  return (from + (to - from) * smoothstep(local)) * WIDTH
}

/**
 * A hard horizontal ramp between two colours, placed on the seam at height `y`.
 *
 * Used for artwork that may straddle the split: the mint side needs dark ink
 * where the graphite side needs light. A gradient hands off between the two
 * without cutting a run of text into separate draws, so the layout survives
 * whatever metrics the host substitutes for the generic families.
 */
function createSeamFill(
  ctx: CanvasRenderingContext2D,
  y: number,
  left: string,
  right: string,
): CanvasGradient {
  const boundary = seamXAt(y)
  const fill = ctx.createLinearGradient(boundary - SEAM_FEATHER, 0, boundary + SEAM_FEATHER, 0)
  fill.addColorStop(0, left)
  fill.addColorStop(1, right)
  return fill
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
 * The primary account number, drawn group by group so each can carry its own
 * ink without re-measuring the run.
 */
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
  ctx.shadowColor = style.shadow
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 3

  const groups = CARD_NUMBER.split(' ')
  const spaceAdvance = ctx.measureText(' ').width + style.tracking

  let cursor = x
  groups.forEach((group, index) => {
    ctx.fillStyle = index === groups.length - 1 ? style.lastGroup : style.leadingGroups
    fillTracked(ctx, group, cursor, baseline, style.tracking)
    cursor += trackedWidth(ctx, group, style.tracking) + spaceAdvance
  })
  ctx.restore()
}

/** Three stacked bars, the mark that precedes the wordmark. */
function drawBrandMark(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
  const barHeight = 13
  const gap = 7

  ctx.save()
  ctx.fillStyle = '#ffffff'
  for (let index = 0; index < 3; index++) {
    ctx.beginPath()
    ctx.roundRect(x, y + index * (barHeight + gap), width, barHeight, barHeight / 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * The gold contact plate: three stacked rounded bars, each cut in half by a
 * vertical divider. That is the module layout on the reference card, and it
 * reads at a glance where a generic contact grid turns to mush.
 */
function drawChip(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, width, height } = rect

  const gold = ctx.createLinearGradient(x, y, x + width, y + height)
  gold.addColorStop(0, '#e8cd86')
  gold.addColorStop(0.45, '#d4af5a')
  gold.addColorStop(1, '#a8842f')

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, 14)
  ctx.fillStyle = gold
  ctx.fill()

  const padX = 14
  const padY = 13
  const barLeft = x + padX
  const barWidth = width - padX * 2
  const gap = 9
  const barHeight = (height - padY * 2 - gap * 2) / 3
  const dividerWidth = 6
  const dividerX = barLeft + (barWidth - dividerWidth) / 2

  for (let index = 0; index < 3; index++) {
    const barTop = y + padY + index * (barHeight + gap)

    ctx.beginPath()
    ctx.roundRect(barLeft, barTop, barWidth, barHeight, barHeight / 2)
    ctx.fillStyle = 'rgba(58, 42, 12, 0.55)'
    ctx.fill()

    // The divider is painted back in with the plate's own gold rather than
    // erased, so the chip stays fully opaque for the ink-coverage mask.
    ctx.fillStyle = gold
    ctx.fillRect(dividerX, barTop, dividerWidth, barHeight)
  }
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

function drawMastercard(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  palette: MastercardPalette,
): void {
  const offset = radius * 0.62
  const leftX = centerX - offset
  const rightX = centerX + offset

  ctx.save()
  ctx.fillStyle = palette.red
  ctx.beginPath()
  ctx.arc(leftX, centerY, radius, 0, TAU)
  ctx.fill()

  ctx.fillStyle = palette.amber
  ctx.beginPath()
  ctx.arc(rightX, centerY, radius, 0, TAU)
  ctx.fill()

  // The overlap is painted explicitly instead of letting a translucent amber
  // circle blend into the red. No alpha can reach the brand's overlap hue —
  // it is more saturated than either circle — and any alpha below 1 would also
  // let the card body bleed through the amber lobe.
  ctx.beginPath()
  ctx.arc(leftX, centerY, radius, 0, TAU)
  ctx.clip()
  ctx.beginPath()
  ctx.arc(rightX, centerY, radius, 0, TAU)
  ctx.clip()
  ctx.fillStyle = palette.overlap
  ctx.fillRect(centerX - radius * 2, centerY - radius, radius * 4, radius * 2)
  ctx.restore()
}

/** The teal-to-mint sweep both faces are built on, deeper at the lower left. */
function fillMintBody(ctx: CanvasRenderingContext2D, deep: string, pale: string): void {
  const mint = ctx.createLinearGradient(0, HEIGHT, WIDTH, 0)
  mint.addColorStop(0, deep)
  mint.addColorStop(1, pale)
  ctx.fillStyle = mint
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
}

/**
 * Mint everywhere, then graphite composited over its left side.
 *
 * The graphite half arrives through its own alpha mask instead of a clipped
 * path: a clip leaves a one-pixel step that crawls and shimmers once the card
 * is seen at an angle, while a feathered ramp resolves cleanly at any tilt.
 * The mask is accumulated on a third surface because `destination-in` acts on
 * the whole canvas, so it cannot be applied scanline by scanline in place.
 */
function drawFrontBody(ctx: CanvasRenderingContext2D): void {
  fillMintBody(ctx, '#4fb3ab', '#8fd8cc')

  const graphiteLayer = createSurface(WIDTH, HEIGHT)
  const graphite = graphiteLayer.createLinearGradient(0, 0, WIDTH * 0.6, HEIGHT)
  graphite.addColorStop(0, '#33383e')
  graphite.addColorStop(0.55, '#24282e')
  graphite.addColorStop(1, '#1b1e22')
  graphiteLayer.fillStyle = graphite
  graphiteLayer.fillRect(0, 0, WIDTH, HEIGHT)

  const maskLayer = createSurface(WIDTH, HEIGHT)
  for (let y = 0; y < HEIGHT; y++) {
    // Sampling the curve at the row's centre keeps the seam symmetric about it.
    const boundary = seamXAt(y + 0.5)
    const ramp = maskLayer.createLinearGradient(
      boundary - SEAM_FEATHER,
      0,
      boundary + SEAM_FEATHER,
      0,
    )
    ramp.addColorStop(0, 'rgba(0, 0, 0, 1)')
    ramp.addColorStop(1, 'rgba(0, 0, 0, 0)')
    maskLayer.fillStyle = ramp
    maskLayer.fillRect(0, y, boundary + SEAM_FEATHER, 1)
  }

  graphiteLayer.globalCompositeOperation = 'destination-in'
  graphiteLayer.drawImage(maskLayer.canvas, 0, 0)

  ctx.drawImage(graphiteLayer.canvas, 0, 0)
}

function drawFront(ctx: CanvasRenderingContext2D): void {
  drawFrontBody(ctx)

  const brandTop = MARGIN + 44
  drawBrandMark(ctx, MARGIN + 24, brandTop, 54)

  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.font = '900 60px sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  fillTracked(ctx, 'FACEBANK', MARGIN + 96, brandTop + 48, -2.5)
  ctx.restore()

  drawChip(ctx, CHIP)

  drawCardNumber(ctx, TEXT_LEFT, NUMBER_BASELINE, {
    font: 'bold 56px sans-serif',
    tracking: 2,
    leadingGroups: '#ffffff',
    // The run outgrows the graphite half, so the trailing group is toned down
    // to a desaturated teal that keeps its contrast against the mint side.
    lastGroup: '#a9d9d2',
    shadow: 'rgba(8, 14, 18, 0.35)',
  })

  ctx.save()
  ctx.fillStyle = 'rgba(214, 224, 228, 0.92)'
  ctx.font = '700 20px sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  fillTracked(ctx, 'VALID THRU', TEXT_LEFT, CAPTION_BASELINE, 4)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 38px sans-serif'
  fillTracked(ctx, EXPIRY, TEXT_LEFT, EXPIRY_BASELINE, 1)

  // The name is the longest line on this face and the seam is at its narrowest
  // down here, so its ink flips to slate past the boundary rather than
  // disappearing into the mint if the host's metrics run wide.
  ctx.fillStyle = createSeamFill(ctx, NAME_BASELINE - 14, '#ffffff', '#1d2b33')
  ctx.font = 'bold 40px sans-serif'
  fillTracked(ctx, CARDHOLDER, TEXT_LEFT, NAME_BASELINE, 1.5)
  ctx.restore()

  drawContactless(ctx, {
    x: 838,
    y: 192,
    radius: 88,
    color: 'rgba(16, 22, 26, 0.85)',
    lineWidth: 12,
  })

  drawMastercard(ctx, 876, 512, 56, {
    red: '#eb001b',
    amber: '#f79e1b',
    overlap: '#ff5f00',
  })
}

/**
 * The reverse carries the same furniture as the front on an unbroken mint
 * body: no graphite region, no wordmark, and — per the spec sheet — no
 * magnetic stripe, so every mark keeps the front's coordinates.
 */
function drawBack(ctx: CanvasRenderingContext2D): void {
  fillMintBody(ctx, '#5cbdb4', '#a5ded2')

  drawChip(ctx, CHIP)

  const slate = '#20303a'
  drawCardNumber(ctx, TEXT_LEFT, NUMBER_BASELINE, {
    font: 'bold 56px sans-serif',
    tracking: 2,
    // Nothing crosses a boundary here, so the whole run shares one ink.
    leadingGroups: slate,
    lastGroup: slate,
    shadow: 'rgba(18, 52, 52, 0.25)',
  })

  ctx.save()
  ctx.fillStyle = 'rgba(32, 48, 58, 0.85)'
  ctx.font = '700 20px sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  fillTracked(ctx, 'VALID THRU', TEXT_LEFT, CAPTION_BASELINE, 4)

  ctx.fillStyle = slate
  ctx.font = 'bold 38px sans-serif'
  fillTracked(ctx, EXPIRY, TEXT_LEFT, EXPIRY_BASELINE, 1)

  ctx.font = 'bold 40px sans-serif'
  fillTracked(ctx, CARDHOLDER, TEXT_LEFT, NAME_BASELINE, 1.5)
  ctx.restore()

  drawContactless(ctx, {
    x: 838,
    y: 192,
    radius: 88,
    color: 'rgba(16, 22, 26, 0.85)',
    lineWidth: 12,
  })

  drawMastercard(ctx, 876, 512, 56, {
    red: '#eb001b',
    amber: '#f79e1b',
    overlap: '#ff5f00',
  })
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
