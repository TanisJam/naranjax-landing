import { CanvasTexture, SRGBColorSpace, type Texture } from 'three'

/**
 * The same ID-1 canvas the printed faces and the drawn motifs use, so every
 * decal in the stack shares one UV space and `decalUv()` needs to know nothing
 * about which kind of artwork it is sampling.
 */
const WIDTH = 1024
const HEIGHT = 646

/**
 * Device pixels per authored pixel, and HALF what the drawn motifs use.
 *
 * The motifs are drawn, so their cost is a choice and their detail is
 * unbounded — `layerMotifTexture` pays 2 there to keep an engraved line a line
 * when a layer fills the viewport. These are photographs of a drawing, and what
 * bounds them is the file: 1024 px wide, of which the drawing itself occupies
 * rather less, landing at about one texel per source pixel once it is fitted to
 * the plate. A 2 here would spend four times the memory magnifying detail the
 * file does not contain — the way to more detail is a larger export, not a
 * larger canvas.
 *
 * It matters more than it did, because there are more of them: the motifs are
 * four textures shared across nine plates, and artwork is nine textures across
 * nine plates. At 1 the nine cost roughly half what the four cost at 2, which
 * is why a brand that ships artwork ends up LIGHTER than one that does not.
 */
const RESOLUTION = typeof window !== 'undefined' && window.innerWidth >= 900 ? 1 : 0.5

/**
 * The largest share of the plate a drawing may take, on either axis.
 *
 * Measured against the drawing's own trimmed bounds and not its file, which is
 * what makes one number work for all nine — see `bounds`. Held under 1 so the
 * drawing reads as something placed ON the plate rather than as the plate's own
 * print: the two covers are the only layers here that print edge to edge, and
 * that is the distinction the margin protects.
 */
const ART_EXTENT = 0.86

/**
 * Radius of the background estimate, as a fraction of the source width.
 *
 * This one number is the whole extraction. The source is a rendered emboss —
 * white line work standing off a near-flat ground, lit from the upper left — so
 * the ground is modelled by blurring the image until the line work dissolves
 * into it, and what survives the subtraction is the drawing.
 *
 * Which makes the radius a statement about SIZE, not about strength: marks
 * narrower than it survive, anything broader is absorbed into the ground. And
 * that is exactly the discrimination this artwork needs, because a rendered
 * emboss carries TWO things that deviate from the ground — the strokes, a few
 * pixels wide, and the soft ambient shadow they cast, a hundred wide. At 0.11
 * that shadow survives as a grey wash inside every phone and every jar. At 0.03
 * it belongs to the ground, where it always belonged: the shadow is how the
 * source depicts relief, and this material renders its own.
 *
 * A corner-sampled or global background would be simpler and would be brittle
 * for the same reason — flat today, wrong the moment one drawing arrives with a
 * vignette or a mark that touches an edge.
 */
const FIELD_RADIUS = 0.03

/**
 * Residual below which there is no drawing, only the ground's own grain.
 *
 * The ground is not perfectly flat — it carries a fine noise, a couple of levels
 * deep. Everything here is multiplied by `COVERAGE_GAIN` afterwards, so two
 * levels of grain become a visible speckle across the whole plate unless it is
 * cut first. Subtracted rather than thresholded, so the floor takes the grain
 * away without putting a step where the faint end of the artwork is.
 */
const NOISE_FLOOR = 0.012

/**
 * Turns the residual into coverage.
 *
 * PROPORTIONATE, and that word is doing all the work. Alpha decides how much of
 * the file's own colour lands on the plate, and the file's own colour where it
 * has nothing to say is its GROUND — a near-white. So an alpha that saturates
 * is an alpha that prints near-white at full strength over places the drawing
 * never marked.
 *
 * This ran at 14 for exactly one round and produced the pale wash the plates
 * came back with. Not from the margins, which read a clean zero, but from
 * INSIDE the drawn shapes: a rendered emboss carries a soft ambient shading
 * across the inside of every phone and every note, five or ten levels deep over
 * three hundred pixels, and a gain of 14 turned that into full coverage. Which
 * then printed the ground it belongs to across the whole shape.
 *
 * So the pairing to hold on to is: coverage stays LINEAR in what the file
 * actually says, and the punch comes from `PRINT_CONTRAST`, which cannot cause
 * this because it moves values about the ground rather than towards it.
 */
const COVERAGE_GAIN = 3.5

/** One, so a faint mark stays faint. See `COVERAGE_GAIN` for why that matters. */
const COVERAGE_GAMMA = 1

/**
 * How far the artwork's own values are stretched about its ground before they
 * are printed.
 *
 * The files are white line work on white and their entire range is some thirty
 * levels either side of a ground near 247 — which is correct for a photograph
 * of a card held under a soft light, and far too little once those same values
 * are laid over a plate that is not that ground. Printed faithfully the drawing
 * disappears.
 *
 * A per-pixel LINEAR stretch about the local ground, so it is only a gain on
 * what the file already says: no pixel moves relative to its neighbours and no
 * edge is touched. That is the property worth protecting here — the edges are
 * the reason this artwork is being printed rather than pressed.
 */
const PRINT_CONTRAST = 2.4

/**
 * How far the outer border fades to nothing, as a fraction of the source width.
 *
 * The blur cannot see past the image, so the ground estimate is least reliable
 * in exactly this band. Narrow, because the artwork keeps a wide margin of its
 * own and the trim below then takes that margin away — a fade wide enough to
 * matter would be eating a drawing that is not there.
 */
const BORDER_FADE = 0.04

/**
 * Coverage at which the trim decides it has found the drawing.
 *
 * Well below a stroke's full value, so a soft mark counts, and well above the
 * floor, so nothing the grain leaves behind can widen the box.
 */
const BOUNDS_LEVEL = 0.15

/**
 * Softening on the plate, in authored pixels — and as little as a resampled
 * image can be given.
 *
 * It used to be a shoulder, and its job was to keep a hard alpha edge from
 * differentiating into a razor crease when the shader took the channel as a
 * height field. The shader no longer does: this artwork is PRINTED, so its
 * edges are read directly and every one of them is the thing being delivered.
 * All that is left for this to do is take the stair-step off a diagonal, which
 * is a sub-pixel job.
 */
const SHOULDER = 0.3

const clamp255 = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value)

function createSurface(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) {
    throw new Error('layerArtTexture: 2D canvas context is unavailable, cannot extract the artwork')
  }

  return context
}

/**
 * The image redrawn on a border of its own edge pixels.
 *
 * `ctx.filter` treats everything outside a canvas as transparent black, so a
 * blur taken at the bounds of the image pulls the residual towards zero along
 * all four sides and reports a drawing where there is only the edge of the
 * frame. Extending the edge outwards by the blur's own reach gives it something
 * to average that is at least the right colour.
 */
function padded(image: HTMLImageElement, size: number, pad: number): HTMLCanvasElement {
  const ctx = createSurface(size + pad * 2, size + pad * 2)
  ctx.drawImage(image, pad, pad, size, size)

  // Top and bottom first, then the two sides taken off the result, so the
  // corners are filled by the horizontal pass rather than left transparent.
  ctx.drawImage(image, 0, 0, image.naturalWidth, 1, pad, 0, size, pad)
  ctx.drawImage(
    image,
    0,
    image.naturalHeight - 1,
    image.naturalWidth,
    1,
    pad,
    pad + size,
    size,
    pad,
  )
  const height = size + pad * 2
  ctx.drawImage(ctx.canvas, pad, 0, 1, height, 0, 0, pad, height)
  ctx.drawImage(ctx.canvas, pad + size - 1, 0, 1, height, pad + size, 0, pad, height)

  return ctx.canvas
}

/** Where a drawing actually is, inside the frame it was delivered in. */
interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The box the drawing occupies, or the whole frame when there is no telling.
 *
 * This is what lets one `ART_EXTENT` govern all nine. The artwork is delivered
 * as square icons, but what each one holds inside that square is not square and
 * not the same size twice — a coin on its own fills a fifth of its frame while
 * two phones side by side fill most of theirs. Fitting the FILES would print
 * those at the same scale, which is to say at wildly different weights, and the
 * stack would read as nine drawings of nine different importances.
 *
 * The fallback is not defensive padding. A frame whose box comes back empty or
 * nearly whole is one this measurement did not understand, and an unscaled
 * drawing centred on the plate is a plainly worse result rather than a broken
 * one — which is the right way for a measurement to fail.
 */
function bounds(coverage: Float32Array, size: number): Bounds {
  let minX = size
  let minY = size
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (coverage[y * size + x]! < BOUNDS_LEVEL) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  const width = maxX - minX + 1
  const height = maxY - minY + 1
  const whole = { x: 0, y: 0, width: size, height: size }
  if (maxX < 0) return whole
  if (width < size * 0.1 || height < size * 0.1) return whole

  return { x: minX, y: minY, width, height }
}

/** The drawing lifted off its own ground, and where it sits in the frame. */
interface Drawing {
  canvas: HTMLCanvasElement
  bounds: Bounds
}

/**
 * The drawing lifted off its own ground.
 *
 * Alpha is coverage: what the ground underneath cannot account for. RGB is one
 * flat ink. Both channels of the same canvas, because the shader wants exactly
 * this pair — `decal.rgb` for the tint and `decal.a` for the ink weight AND the
 * height field.
 */
function extract(image: HTMLImageElement): Drawing {
  const size = image.naturalWidth
  const blur = size * FIELD_RADIUS
  const pad = Math.ceil(blur * 2)

  // The artwork exactly as delivered, edges and all. Nothing in this function
  // is allowed to soften it — those edges are the reason the file was chosen,
  // and they are also, now, the only source of its alpha.
  //
  // A stroke's core sits at almost the ground colour here, so it comes out
  // barely printed. That is not a hole to be filled: it is what the reference
  // shows. These drawings are read at their edges, and the middle of a raised
  // line looks like the surface it rose from.
  const sharp = createSurface(size, size)
  sharp.drawImage(image, 0, 0, size, size)
  const print = sharp.getImageData(0, 0, size, size)

  const field = createSurface(size + pad * 2, size + pad * 2)
  field.filter = `blur(${blur}px)`
  field.drawImage(padded(image, size, pad), 0, 0)
  const ground = field.getImageData(pad, pad, size, size)

  const fade = size * BORDER_FADE
  const coverage = new Float32Array(size * size)
  const out = new ImageData(size, size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4

      // Measured on the SHARP copy — the same pixels that get printed — and
      // that identity is the whole reason the plate stops glowing.
      //
      // Read off a blurred copy instead, coverage spread outwards past the
      // marks and reported a drawing in the clear margin beside every stroke.
      // Alpha there is not harmless: the ink it lets through is the FILE'S OWN
      // GROUND, a near-white, and near-white printed at four fifths over a
      // violet plate is a white wash. Invisible on the ivory plies, which is
      // why it survived a round. Tying the two together makes the failure
      // impossible rather than tuned away: wherever the print has nothing to
      // say, it says it at zero alpha.
      //
      // Mean absolute channel distance rather than a luminance one. The artwork
      // is grey on grey so the three readings agree today, and the distance is
      // what keeps that from being load-bearing: a mark that departs from the
      // ground in hue alone would still be found.
      const residual =
        (Math.abs(print.data[i]! - ground.data[i]!) +
          Math.abs(print.data[i + 1]! - ground.data[i + 1]!) +
          Math.abs(print.data[i + 2]! - ground.data[i + 2]!)) /
        3 /
        255

      const signal = Math.max(0, residual - NOISE_FLOOR)
      const graded = Math.min(1, signal * COVERAGE_GAIN) ** COVERAGE_GAMMA
      const edge = Math.min(1, Math.min(x, y, size - 1 - x, size - 1 - y) / fade)
      const covered = graded * edge

      coverage[y * size + x] = covered
      for (let c = 0; c < 3; c += 1) {
        const base = ground.data[i + c]!
        out.data[i + c] = clamp255(base + (print.data[i + c]! - base) * PRINT_CONTRAST)
      }
      out.data[i + 3] = Math.round(covered * 255)
    }
  }

  const lifted = createSurface(size, size)
  lifted.putImageData(out, 0, 0)
  return { canvas: lifted.canvas, bounds: bounds(coverage, size) }
}

/**
 * Centres the drawing on the plate at a common weight, engraved shoulder on.
 *
 * Both axes are fitted rather than height alone, because a trimmed box has no
 * fixed proportion: the two-phones drawing is nearly as wide as the plate and a
 * height-only fit would run it off the sides.
 */
function place(plate: CanvasRenderingContext2D, drawing: Drawing): void {
  const box = drawing.bounds
  const fit = Math.min((WIDTH * ART_EXTENT) / box.width, (HEIGHT * ART_EXTENT) / box.height)
  const width = box.width * fit
  const height = box.height * fit

  // Stated in DEVICE pixels with the transform folded in by hand, rather than
  // authored pixels under a scaled context. `ctx.filter` is the one canvas
  // operation whose relationship to the current transform is not worth relying
  // on — `layerMotifTexture` reached the same conclusion the same way — and the
  // scale is known right here, so there is nothing to rely on.
  plate.save()
  plate.filter = `blur(${SHOULDER * RESOLUTION}px)`
  plate.drawImage(
    drawing.canvas,
    box.x,
    box.y,
    box.width,
    box.height,
    ((WIDTH - width) / 2) * RESOLUTION,
    ((HEIGHT - height) / 2) * RESOLUTION,
    width * RESOLUTION,
    height * RESOLUTION,
  )
  plate.restore()
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.addEventListener('load', () => resolve(image), { once: true })
    image.addEventListener('error', () => reject(new Error(`cannot load ${src}`)), { once: true })
    image.src = src
  })
}

/**
 * The decal for a layer that ships its feature's own illustration.
 *
 * Returns before the file does, and that is the shape of the thing rather than
 * a shortcut: a texture is what the material binds at construction, and a
 * material that had to wait for a network round trip would hold up the whole
 * stack — including the two covers, which have their artwork already. So the
 * plate is handed an empty decal and the drawing arrives into the same canvas a
 * moment later. An empty decal is not a wrong one: alpha is zero everywhere, so
 * both readings of it — the ink and the height field — are exactly the nothing
 * the plate would have had.
 *
 * A file that fails to load leaves that nothing in place permanently, which is
 * the right failure. The layer keeps its material, its weave and its relief; it
 * is missing a drawing, and a missing drawing should not cost anyone the stack.
 */
export function createLayerArtTexture(asset: string): Texture {
  const plate = createSurface(WIDTH * RESOLUTION, HEIGHT * RESOLUTION)
  const texture = new CanvasTexture(plate.canvas)
  texture.colorSpace = SRGBColorSpace

  load(`/${asset}`)
    .then((image) => {
      place(plate, extract(image))
      texture.needsUpdate = true
    })
    .catch((error: unknown) => {
      console.warn(`layerArtTexture: ${asset} is not on the plate`, error)
    })

  return texture
}
