import { CanvasTexture, SRGBColorSpace } from 'three'

export type LayerMotif = 'embossed-circles' | 'currency-frame' | 'border-frame'

/** Same ID-1 canvas as the printed faces, so every decal shares one UV space. */
const WIDTH = 1024
const HEIGHT = 646

const TAU = Math.PI * 2

/** Relief pressed into the layer's own plastic, so the ink is near-colourless. */
const EMBOSS_INK = '#f2f6f8'

/** Engraved line art, where the ink actually contributes to the albedo. */
const PRINT_INK = '#eef7fa'

const CENTER_X = WIDTH / 2
const CENTER_Y = HEIGHT / 2

const BORDER_INSET = 60
const BORDER_GAP = 14
const BORDER_STROKE = 7
const BORDER_RADIUS = 28
/** How far along each edge the corner chamfer starts, measured from the corner. */
const NOTCH_REACH = 34
const NOTCH_JEWEL = 9

interface RoundRect {
  x: number
  y: number
  width: number
  height: number
  radius: number
}

interface Relief {
  ink: string
  /** Peak alpha of the layer, which is also its peak height. */
  alpha: number
  /** Gaussian sigma of the shoulder, in px. */
  blur: number
}

interface Corner {
  x: number
  y: number
  /** Unit step towards the inside of the frame on each axis. */
  towardsX: number
  towardsY: number
}

function createSurface(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (context === null) {
    throw new Error('layerMotifTexture: 2D canvas context is unavailable, cannot draw the motif')
  }

  return context
}

/**
 * Paints one motif layer and composites it with a blurred, capped alpha.
 *
 * The shader reads this alpha twice — once to blend the ink, once as a height
 * field — so a hard alpha step would differentiate into a razor-sharp crease.
 * Drawing at full opacity on a scratch surface first also keeps overlapping
 * strokes from accumulating alpha, which would otherwise show up as bumps where
 * two lines of the same shape cross.
 */
function paintRelief(
  ctx: CanvasRenderingContext2D,
  relief: Relief,
  paint: (scratch: CanvasRenderingContext2D) => void,
): void {
  const scratch = createSurface(WIDTH, HEIGHT)
  scratch.strokeStyle = relief.ink
  scratch.fillStyle = relief.ink
  scratch.lineCap = 'round'
  scratch.lineJoin = 'round'
  paint(scratch)

  ctx.save()
  ctx.filter = `blur(${relief.blur}px)`
  ctx.globalAlpha = relief.alpha
  ctx.drawImage(scratch.canvas, 0, 0)
  ctx.restore()
}

function strokeRoundRect(ctx: CanvasRenderingContext2D, rect: RoundRect): void {
  ctx.beginPath()
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius)
  ctx.stroke()
}

function strokeCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, TAU)
  ctx.stroke()
}

function fillDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, half: number): void {
  ctx.beginPath()
  ctx.moveTo(x, y - half)
  ctx.lineTo(x + half, y)
  ctx.lineTo(x, y + half)
  ctx.lineTo(x - half, y)
  ctx.closePath()
  ctx.fill()
}

function cornersOf(rect: RoundRect): Corner[] {
  const left = rect.x
  const right = rect.x + rect.width
  const top = rect.y
  const bottom = rect.y + rect.height

  return [
    { x: left, y: top, towardsX: 1, towardsY: 1 },
    { x: right, y: top, towardsX: -1, towardsY: 1 },
    { x: right, y: bottom, towardsX: -1, towardsY: -1 },
    { x: left, y: bottom, towardsX: 1, towardsY: -1 },
  ]
}

/** A chamfer cutting each corner, with a jewel tucked in the pocket behind it. */
function drawCornerNotches(ctx: CanvasRenderingContext2D, rect: RoundRect): void {
  for (const corner of cornersOf(rect)) {
    ctx.beginPath()
    ctx.moveTo(corner.x + corner.towardsX * NOTCH_REACH, corner.y)
    ctx.lineTo(corner.x, corner.y + corner.towardsY * NOTCH_REACH)
    ctx.stroke()

    fillDiamond(
      ctx,
      corner.x + corner.towardsX * NOTCH_REACH,
      corner.y + corner.towardsY * NOTCH_REACH,
      NOTCH_JEWEL,
    )
  }
}

/** The banknote double border, shared by the framed motifs. */
function drawBanknoteBorder(ctx: CanvasRenderingContext2D): void {
  const outer: RoundRect = {
    x: BORDER_INSET,
    y: BORDER_INSET,
    width: WIDTH - BORDER_INSET * 2,
    height: HEIGHT - BORDER_INSET * 2,
    radius: BORDER_RADIUS,
  }
  const inset = BORDER_INSET + BORDER_GAP
  const inner: RoundRect = {
    x: inset,
    y: inset,
    width: WIDTH - inset * 2,
    height: HEIGHT - inset * 2,
    radius: BORDER_RADIUS - BORDER_GAP,
  }

  ctx.lineWidth = BORDER_STROKE
  strokeRoundRect(ctx, outer)
  strokeRoundRect(ctx, inner)
  drawCornerNotches(ctx, inner)
}

/** An open "C" crossed by a vertical bar — a currency glyph read in relief. */
function drawCurrencySwirl(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  ctx.lineWidth = 16
  ctx.beginPath()
  ctx.arc(x, y, radius, 0.32 * Math.PI, 1.68 * Math.PI)
  ctx.stroke()

  const overhang = radius * 1.48
  ctx.lineWidth = 14
  ctx.beginPath()
  ctx.moveTo(x, y - overhang)
  ctx.lineTo(x, y + overhang)
  ctx.stroke()
}

function strokeEllipseRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
): void {
  ctx.beginPath()
  ctx.ellipse(x, y, radiusX, radiusY, 0, 0, TAU)
  ctx.stroke()
}

/**
 * Shapes pressed into the plastic rather than printed on it.
 *
 * The alpha ceiling stays low because the caller blends almost none of this ink
 * into the albedo and takes the channel as height instead — the strokes are
 * correspondingly fat and heavily blurred so the relief reads as a moulded
 * swell, not as an engraved line.
 */
function drawEmbossedCircles(ctx: CanvasRenderingContext2D): void {
  const medallionX = 470
  const medallionY = 323

  paintRelief(ctx, { ink: EMBOSS_INK, alpha: 0.22, blur: 7 }, (scratch) => {
    scratch.lineWidth = 18
    strokeCircle(scratch, medallionX, medallionY, 150)
  })

  paintRelief(ctx, { ink: EMBOSS_INK, alpha: 0.16, blur: 6 }, (scratch) => {
    scratch.lineWidth = 14
    strokeCircle(scratch, medallionX, medallionY, 104)
  })

  paintRelief(ctx, { ink: EMBOSS_INK, alpha: 0.2, blur: 6 }, (scratch) => {
    drawCurrencySwirl(scratch, medallionX, medallionY, 62)
  })

  paintRelief(ctx, { ink: EMBOSS_INK, alpha: 0.13, blur: 6 }, (scratch) => {
    scratch.lineWidth = 12
    strokeEllipseRing(scratch, 150, 190, 45, 32)
    strokeEllipseRing(scratch, 760, 450, 45, 32)
  })
}

function drawCurrencyFrame(ctx: CanvasRenderingContext2D): void {
  paintRelief(ctx, { ink: PRINT_INK, alpha: 0.72, blur: 2.5 }, drawBanknoteBorder)

  paintRelief(ctx, { ink: PRINT_INK, alpha: 0.78, blur: 2.5 }, (scratch) => {
    scratch.lineWidth = 8
    strokeCircle(scratch, CENTER_X, CENTER_Y, 125)

    // Stroked rather than filled: a solid glyph would become a plateau in the
    // height field, while the outline keeps the engraved contour.
    scratch.lineWidth = 7
    scratch.font = '700 180px sans-serif'
    scratch.textAlign = 'center'
    scratch.textBaseline = 'middle'
    scratch.strokeText('$', CENTER_X, CENTER_Y + 4)
  })

  paintRelief(ctx, { ink: PRINT_INK, alpha: 0.62, blur: 2.5 }, (scratch) => {
    scratch.lineWidth = 7
    strokeCircle(scratch, CENTER_X - 210, CENTER_Y, 35)
    strokeCircle(scratch, CENTER_X + 210, CENTER_Y, 35)
  })
}

function drawBorderFrame(ctx: CanvasRenderingContext2D): void {
  paintRelief(ctx, { ink: PRINT_INK, alpha: 0.72, blur: 2.5 }, drawBanknoteBorder)

  paintRelief(ctx, { ink: PRINT_INK, alpha: 0.7, blur: 2.5 }, (scratch) => {
    scratch.lineWidth = 7
    strokeCircle(scratch, CENTER_X, CENTER_Y, 40)
  })
}

const MOTIF_PAINTERS: Record<LayerMotif, (ctx: CanvasRenderingContext2D) => void> = {
  'embossed-circles': drawEmbossedCircles,
  'currency-frame': drawCurrencyFrame,
  'border-frame': drawBorderFrame,
}

/**
 * Paints one decal for a middle layer of the exploded card stack.
 *
 * The canvas is left fully transparent and only the motif carries alpha, because
 * the caller uses that channel both to blend the ink over the layer's own colour
 * and as the height field for normal perturbation. Any opaque backdrop would
 * flood the whole layer with ink and raise the entire surface by a constant,
 * flattening the relief it is supposed to produce.
 */
export function createLayerMotifTexture(motif: LayerMotif): CanvasTexture {
  const ctx = createSurface(WIDTH, HEIGHT)
  ctx.clearRect(0, 0, WIDTH, HEIGHT)

  MOTIF_PAINTERS[motif](ctx)

  const texture = new CanvasTexture(ctx.canvas)
  texture.colorSpace = SRGBColorSpace

  return texture
}
