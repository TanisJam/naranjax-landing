import type { SceneOrchestrator } from '../sheets/application/SceneOrchestrator'

/**
 * Turning one thing off at a time and reading what the frame gives back.
 *
 * This is the same instrument the lighting rig was fitted with, applied to
 * cost instead of to brightness, and it exists because a GPU-bound frame does
 * not say WHICH of its work is the expensive part. Eleven overlapping layers of
 * a heavy physical material, seven of them each taking eleven texture samples
 * of the frame behind, four full-buffer copies and a shadow pass over every
 * plate — all of it lands in the same number, and guessing which one to attack
 * costs image quality every time the guess is wrong.
 *
 * Every knockout here is REVERSIBLE and none forces a shader recompile, which
 * is what makes the readings comparable: a recompile stalls the pipeline for
 * frames afterwards and would land in whatever is measured next. `reset` puts
 * everything back.
 *
 * Read each one against the interval, not the frame rate — the difference
 * between 25 ms and 17 ms is the size of the thing you just switched off, and
 * the difference between 40 fps and 59 is not proportional to anything.
 */
/**
 * How long each state is measured for, and how long it is given to settle
 * first.
 *
 * The settle is not padding. Switching a knockout can reallocate a texture or
 * leave the driver with a pipeline full of work from the previous state, and
 * those frames land in whatever is timed next — which is exactly the error that
 * makes one knockout look like the cost of another. Discarded, not averaged.
 */
const SETTLE_MS = 400
const MEASURE_MS = 1200

/** Frame intervals over a window, by MEDIAN. */
function measure(): Promise<number> {
  return new Promise((resolve) => {
    const samples: number[] = []
    const start = performance.now()
    let last = start

    const tick = (): void => {
      const now = performance.now()
      if (now - start > SETTLE_MS) samples.push(now - last)
      last = now

      if (now - start < SETTLE_MS + MEASURE_MS) {
        requestAnimationFrame(tick)
        return
      }

      // Median rather than mean. A sweep runs for seconds and something else on
      // the machine will hitch at some point during it; one 200 ms frame moves
      // a mean of sixty samples by three milliseconds, which is the size of the
      // effects being looked for. It cannot move the median at all.
      samples.sort((a, b) => a - b)
      resolve(samples[samples.length >> 1] ?? 0)
    }

    requestAnimationFrame(tick)
  })
}

export interface Knockouts {
  /**
   * Redraws at a different device pixel ratio, 1 being one buffer pixel per CSS
   * pixel. THE fill-rate test, and the first one to run: fragment cost goes
   * with the SQUARE of this, so a piece drawing at the 1.75 the stage clamps to
   * is paying three times what it would at 1. A large drop here says the frame
   * is fragment-bound and nothing else needs testing to know it.
   */
  pixelRatio(ratio: number): string
  /** Stops the depth pass outright. Isolates the cost of eleven casters. */
  shadows(on: boolean): string
  /**
   * Stops the frost: no backdrop captures, no spiral, no manual composite. The
   * layers go back to being plain translucent sheets.
   */
  frost(on: boolean): string
  /** Stops the film grain. Four instructions per fragment; a control, mostly. */
  grain(on: boolean): string
  /** Everything back as authored. */
  reset(): string
  /**
   * Runs the whole set, one at a time, and prints what each one was worth.
   *
   * This is the entry point — the individual knockouts above are for following
   * something up. Reading them by hand off the counter means holding a number
   * in your head across a state change, which is where the errors come from:
   * the interesting differences here are a few milliseconds and the counter is
   * updating four times a second while you look away to type.
   *
   * Takes about ten seconds and puts the piece back exactly as it was.
   */
  sweep(): Promise<void>
}

export function createKnockouts(orchestrator: SceneOrchestrator): Knockouts {
  const { renderer } = orchestrator.stage

  // Captured before anything is switched off, so `reset` restores what the
  // composition authored rather than whatever the last knockout left behind.
  const pixelRatio = renderer.getPixelRatio()
  const casters = orchestrator.sheets.map((sheet) => sheet.mesh.castShadow)
  const spreads = orchestrator.sheets.map((sheet) => sheet.uniforms.uFrostSpread.value)
  const captures = orchestrator.sheets.map((sheet) => sheet.mesh.onBeforeRender)
  const grainAmount = orchestrator.sheets[0]?.uniforms.uGrain.value ?? 0

  const knockouts: Knockouts = {
    pixelRatio(ratio) {
      // The governor owns this number in normal running and will take it back
      // within a second. A measurement it is quietly undoing halfway through is
      // worse than no measurement, because it looks like one.
      orchestrator.resolution.enabled = false
      const was = renderer.getPixelRatio()
      renderer.setPixelRatio(ratio)
      // Never `setPixelRatio` alone: the backdrop capture is sized to the
      // drawing buffer texel for texel, and a capture that disagrees with it
      // puts the frost's samples in the wrong place.
      orchestrator.refresh()
      return `pixel ratio ${was} → ${ratio}`
    },

    shadows(on) {
      orchestrator.sheets.forEach((sheet, i) => {
        sheet.mesh.castShadow = on ? casters[i]! : false
      })
      return `shadows ${on ? 'on' : 'off'}`
    },

    frost(on) {
      orchestrator.sheets.forEach((sheet, i) => {
        // Zero is what the branch in the shader tests, so this costs the
        // fragment nothing beyond the compare — no taps and no composite.
        sheet.uniforms.uFrostSpread.value = on ? spreads[i]! : 0
        // And the capture itself, which is a copy of the whole drawing buffer
        // and would otherwise keep running for a blur nobody reads.
        sheet.mesh.onBeforeRender = on ? captures[i]! : () => {}
      })
      return `frost ${on ? 'on' : 'off'}`
    },

    grain(on) {
      for (const sheet of orchestrator.sheets) {
        sheet.uniforms.uGrain.value = on ? grainAmount : 0
      }
      return `grain ${on ? 'on' : 'off'}`
    },

    reset() {
      knockouts.shadows(true)
      knockouts.frost(true)
      knockouts.grain(true)
      const restored = knockouts.pixelRatio(pixelRatio)
      // Last, and after the ratio is back where it started: handing the
      // governor a resolution it did not choose is how it ends up correcting
      // for a state that no longer exists.
      orchestrator.resolution.enabled = true
      return restored
    },

    async sweep(): Promise<void> {
      // Every run measures the baseline again rather than trusting one taken
      // earlier. The machine warms up, the browser throttles, another tab
      // starts doing something — a difference against a stale baseline is a
      // difference against the weather.
      knockouts.reset()
      const baseline = await measure()

      const rows: Record<string, Record<string, string>> = {}
      const record = (label: string, ms: number): void => {
        rows[label] = {
          'ms/frame': ms.toFixed(1),
          fps: (1000 / ms).toFixed(0),
          saves: ms < baseline ? `${(baseline - ms).toFixed(1)} ms` : '—',
        }
      }

      record('as authored', baseline)

      knockouts.frost(false)
      record('no frost', await measure())
      knockouts.frost(true)

      knockouts.shadows(false)
      record('no shadows', await measure())
      knockouts.shadows(true)

      knockouts.grain(false)
      record('no grain', await measure())
      knockouts.grain(true)

      // Last, because it is the only one that reallocates buffers, and because
      // what it answers is not "should this ship at 1" — it is whether the
      // frame is fragment-bound at all. Fragment cost goes with the SQUARE of
      // this, so if the piece is filling pixels this is the largest number in
      // the table by a wide margin and every other row should be read in that
      // light.
      knockouts.pixelRatio(1)
      record('at pixel ratio 1', await measure())

      knockouts.reset()
      console.table(rows)
    },
  }

  return knockouts
}
