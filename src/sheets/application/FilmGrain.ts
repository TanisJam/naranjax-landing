import { Vector2 } from 'three'
import type { WebGLRenderer } from 'three'
import type { FilmGrainUniforms } from '../infrastructure/three/material/sheetMaterial'

/**
 * Peak-to-peak amplitude at mid density, in output units.
 *
 * Small on purpose. Grain that announces itself is a filter; grain that works
 * is the thing you notice only when it is switched off, because it is what
 * stops a perfectly smooth gradient from reading as vector art. At this level
 * the swing through the midtones is about eight values out of 255, which is
 * roughly what a fine-stock scan carries.
 */
const GRAIN_AMOUNT = 0.065

/**
 * How many times a second the field is redrawn.
 *
 * NOT once per frame, and that is the whole reason this class exists rather
 * than a `Math.random()` in the loop. Grain is laid down once per exposure, so
 * on film it changes at the shutter and holds still in between; at 60 or 120 Hz
 * a fresh field every frame averages itself out in the eye and what is left is
 * a faint shimmer instead of texture.
 *
 * Below the projection rate this is imitating, and deliberately so. Film runs
 * at 24 and this holds each field for roughly three of those, which is not what
 * a projector does and is what the piece wants: the artwork underneath is
 * almost still — it breathes and drifts and otherwise sits there — so grain
 * churning at full rate over it is the fastest thing in the frame by a wide
 * margin, and the eye goes to the fastest thing. Slowed down it settles into
 * the image instead of running across it.
 *
 * There is a floor under this and it is not zero. Held long enough the field
 * stops reading as grain in the image and starts reading as dirt on the glass
 * in front of it — the giveaway is that it no longer belongs to the picture.
 * Freezing it outright is an available look, not a further step along this one.
 *
 * The rate is also why the field must not be tied to the frame: the count below
 * advances on elapsed seconds, so the grain runs at the same speed on a 144 Hz
 * monitor as on a 60 Hz one.
 */
const SHUTTER_HZ = 8

/**
 * Successive seeds, from the R2 low-discrepancy sequence.
 *
 * Two independent-looking coordinates out of one counter, and spread rather
 * than random: consecutive exposures land far apart in the hash's input space,
 * so no two frames in a row can come out looking alike. A plain incrementing
 * seed would walk the field along a line and the grain would visibly drift.
 */
const R2_X = 0.7548776662466927
const R2_Y = 0.5698402909980532

/**
 * The film every layer is exposed onto.
 *
 * Owns one pair of uniforms shared by all eleven materials by reference, which
 * is what makes the grain a property of the FRAME rather than of each sheet —
 * see `FilmGrainUniforms` for why the stack falls apart if they differ.
 *
 * Deliberately not a post-process pass. `FRAGMENT_GRAIN_CHUNK` has the whole
 * argument; the short version is that a pass would cost a full-screen target
 * and a copy, and would then have to be taught to leave the transparent canvas
 * alone — while riding the sheets' own alpha gives that for nothing.
 */
export class FilmGrain {
  readonly uniforms: FilmGrainUniforms = {
    uGrain: { value: GRAIN_AMOUNT },
    uGrainSeed: { value: new Vector2() },
    uViewTexel: { value: new Vector2(1, 1) },
  }

  /**
   * Measured against the DRAWING BUFFER rather than the CSS box, because that
   * is what `gl_FragCoord` counts in and the cells are locked to it. On a 2x
   * display the two differ by exactly the factor that would halve the grain.
   *
   * Called on every resize, including the ones that only move the drawing
   * buffer — the resolution governor changes the pixel ratio without the CSS
   * box moving at all, and the grain has to follow it.
   */
  resize(renderer: WebGLRenderer): void {
    const size = renderer.getDrawingBufferSize(new Vector2())
    this.uniforms.uViewTexel.value.set(1 / Math.max(1, size.x), 1 / Math.max(1, size.y))
  }

  private elapsed = 0
  /** Which exposure the current field belongs to. -1 forces the first write. */
  private exposure = -1

  update(delta: number): void {
    this.elapsed += delta

    const exposure = Math.floor(this.elapsed * SHUTTER_HZ)
    if (exposure === this.exposure) return
    this.exposure = exposure

    // Fractional part only: the hash folds its input, so what matters is that
    // successive seeds differ by an irrational-looking amount, not how large
    // they are — and keeping them under 1 leaves the fragment shader's float
    // precision entirely to the pixel coordinates it is added to.
    this.uniforms.uGrainSeed.value.set(
      (exposure * R2_X) % 1,
      (exposure * R2_Y) % 1,
    )
  }
}
