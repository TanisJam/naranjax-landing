import { CanvasTexture, SRGBColorSpace } from 'three'

export type LayerMotif = 'embossed-circles' | 'currency-frame' | 'border-frame' | 'facet-fold'

/** Same ID-1 canvas as the printed faces, so every decal shares one UV space. */
const WIDTH = 1024
const HEIGHT = 646

/**
 * Device pixels per authored pixel.
 *
 * The authored grid is a coordinate system, not a resolution, and it was being
 * used as both. A layer opened in the detail view spans the whole viewport:
 * 1600 CSS px on a laptop is 3200 device px at a 2 device ratio and 6400 in the
 * drawing buffer once `SUPERSAMPLE` is on — a 1024 px plate magnified six
 * times. That is the "poco definido" in the feedback, and no filtering setting
 * fixes it, because the detail simply is not in the texture.
 *
 * Everything below still draws in the 1024x646 space; `createSurface` scales
 * the context so the numbers keep meaning what they meant, and only the pixel
 * count under them changes.
 *
 * Narrow viewports stay at 1, and that is not a compromise: the plate is a few
 * hundred CSS px there, so the extra texels would never be sampled — while the
 * memory very much would be. Each motif costs 4 bytes a texel plus a third
 * again for its mip chain, so 2 turns a 3.5 MB decal into 14 MB, and there are
 * four of them.
 */
const RESOLUTION = typeof window !== 'undefined' && window.innerWidth >= 900 ? 2 : 1

const TAU = Math.PI * 2

/** Relief pressed into the layer's own plastic, so the ink is near-colourless. */
const EMBOSS_INK = '#f2f6f8'

/** Engraved line art, where the ink actually contributes to the albedo. */
const PRINT_INK = '#eef7fa'

/**
 * Shoulder on the engraved motifs, in authored pixels.
 *
 * Halved from the 2.5 it sat at, which was the OTHER half of the "poco
 * definido". A shoulder authored against a plate two hundred pixels wide on
 * screen is fifteen device pixels of ramp on one that fills the viewport, and
 * a line whose ramp is fifteen pixels wide is not a line.
 *
 * It cannot go to zero — a hard alpha step differentiates into a razor crease
 * in the height field — but it has far more room than it was taking. The relief
 * is read at `reach = 0.006` in uv, about six authored pixels, so the gradient
 * the emboss actually uses is set there and not here. This only has to be wide
 * enough that the step is not a step.
 */
const PRINT_SHOULDER = 1.2

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

function createSurface(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH * RESOLUTION
  canvas.height = HEIGHT * RESOLUTION

  const context = canvas.getContext('2d')
  if (context === null) {
    throw new Error('layerMotifTexture: 2D canvas context is unavailable, cannot draw the motif')
  }

  context.setTransform(RESOLUTION, 0, 0, RESOLUTION, 0, 0)

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
  const scratch = createSurface()
  scratch.strokeStyle = relief.ink
  scratch.fillStyle = relief.ink
  scratch.lineCap = 'round'
  scratch.lineJoin = 'round'
  paint(scratch)

  // Composited with the transform reset, so the scratch lands texel for texel
  // and the blur radius can be stated in device pixels. `ctx.filter` is the one
  // canvas operation whose relationship to the current transform is not worth
  // relying on, and the scale is already known here.
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.filter = `blur(${relief.blur * RESOLUTION}px)`
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
  paintRelief(ctx, { ink: PRINT_INK, alpha: 0.72, blur: PRINT_SHOULDER }, drawBanknoteBorder)

  paintRelief(ctx, { ink: PRINT_INK, alpha: 0.78, blur: PRINT_SHOULDER }, (scratch) => {
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

  paintRelief(ctx, { ink: PRINT_INK, alpha: 0.62, blur: PRINT_SHOULDER }, (scratch) => {
    scratch.lineWidth = 7
    strokeCircle(scratch, CENTER_X - 210, CENTER_Y, 35)
    strokeCircle(scratch, CENTER_X + 210, CENTER_Y, 35)
  })
}

function drawBorderFrame(ctx: CanvasRenderingContext2D): void {
  paintRelief(ctx, { ink: PRINT_INK, alpha: 0.72, blur: PRINT_SHOULDER }, drawBanknoteBorder)

  paintRelief(ctx, { ink: PRINT_INK, alpha: 0.7, blur: PRINT_SHOULDER }, (scratch) => {
    scratch.lineWidth = 7
    strokeCircle(scratch, CENTER_X, CENTER_Y, 40)
  })
}

/**
 * Where the two creases cross the top edge, as a fraction of the width.
 *
 * Both run from a bottom corner up to the top edge, so the layer reads as one
 * sheet folded twice rather than as three shapes laid side by side. Off-centre
 * on purpose — the reference's creases are not symmetric, and a symmetric pair
 * turns the fold into a paper aeroplane.
 */
const CREASE_LEFT = 0.36
const CREASE_RIGHT = 0.64

/**
 * The height each facet holds at its two ends.
 *
 * These are the whole motif. A fold is not a shape drawn onto a sheet, it is a
 * place where the sheet's slope CHANGES — so what is authored here is a value
 * per corner, and the creases appear for free wherever two facets arrive at the
 * same edge on different gradients. Drawing the creases as lines instead would
 * have produced three flat panels with a stroke between them, which is a
 * diagram of a fold and not a fold.
 *
 * The centre panel is the tall one and it falls away downwards, which is what
 * puts the highlight along the top edge in the reference.
 *
 * The SPAN between the extremes matters more than any single value, and it is
 * deliberately narrow. Measured off the reference, its facets differ by about a
 * tenth in lightness — they are a fold catching light, not a colour-blocked
 * graphic. A first pass ran this from 0.25 to 0.95 and produced a washed-out
 * chevron that looked painted on; through `decalInk` at 0.32 and the 0.85 cap
 * below, the range here lands at roughly a tenth of albedo, which is the
 * number the photograph actually shows.
 */
const FACET_AT_CREASE = 0.5
const FACET_LEFT_EDGE = 0.34
const FACET_RIGHT_EDGE = 0.36
const FACET_CENTRE_TOP = 0.72
const FACET_CENTRE_BOTTOM = 0.44

function fillFacet(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
  ramp: { from: readonly [number, number]; to: readonly [number, number] },
  levels: readonly [number, number],
): void {
  const fill = ctx.createLinearGradient(ramp.from[0], ramp.from[1], ramp.to[0], ramp.to[1])
  fill.addColorStop(0, `rgba(255, 255, 255, ${levels[0]})`)
  fill.addColorStop(1, `rgba(255, 255, 255, ${levels[1]})`)

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(points[0]![0], points[0]![1])
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()
}

/**
 * The decorative interior print: one sheet folded into three facets.
 *
 * Unlike every other motif here this one covers the whole plate rather than
 * sitting inside a border, because it is not artwork applied to a layer — it is
 * what the layer is. That is also why it goes through `paintRelief` with a
 * wider blur than the engraved motifs: those need their lines to stay lines,
 * while a crease that resolves in two pixels reads as a scratch in the plastic
 * instead of as a fold in it.
 */
function drawFacetFold(ctx: CanvasRenderingContext2D): void {
  const left = CREASE_LEFT * WIDTH
  const right = CREASE_RIGHT * WIDTH

  paintRelief(ctx, { ink: '#ffffff', alpha: 0.85, blur: 5 }, (scratch) => {
    fillFacet(
      scratch,
      [
        [0, 0],
        [left, 0],
        [0, HEIGHT],
      ],
      { from: [0, 0], to: [left, HEIGHT * 0.5] },
      [FACET_LEFT_EDGE, FACET_AT_CREASE],
    )

    fillFacet(
      scratch,
      [
        [left, 0],
        [right, 0],
        [WIDTH, HEIGHT],
        [0, HEIGHT],
      ],
      { from: [0, 0], to: [0, HEIGHT] },
      [FACET_CENTRE_TOP, FACET_CENTRE_BOTTOM],
    )

    fillFacet(
      scratch,
      [
        [right, 0],
        [WIDTH, 0],
        [WIDTH, HEIGHT],
      ],
      { from: [right, HEIGHT * 0.5], to: [WIDTH, 0] },
      [FACET_AT_CREASE, FACET_RIGHT_EDGE],
    )
  })
}

const MOTIF_PAINTERS: Record<LayerMotif, (ctx: CanvasRenderingContext2D) => void> = {
  'embossed-circles': drawEmbossedCircles,
  'currency-frame': drawCurrencyFrame,
  'border-frame': drawBorderFrame,
  'facet-fold': drawFacetFold,
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
  const ctx = createSurface()
  ctx.clearRect(0, 0, WIDTH, HEIGHT)

  MOTIF_PAINTERS[motif](ctx)

  const texture = new CanvasTexture(ctx.canvas)
  texture.colorSpace = SRGBColorSpace

  return texture
}
