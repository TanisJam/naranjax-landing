import type { RectAreaLight, WebGLRenderer } from 'three'
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
 * Every knockout here is REVERSIBLE, and all but one avoid a shader recompile —
 * which is what makes the readings comparable, because a recompile stalls the
 * pipeline for frames afterwards and would land in whatever is measured next.
 * `reset` puts everything back.
 *
 * The exception is `lights`, and it cannot be otherwise: the area lights' cost
 * IS shader code, so the only way to stop paying it is a different program. It
 * pays for the exception by forcing the rebuild inside its own call, so the
 * stall is over before anything is timed. See it for the whole argument.
 *
 * Read each one against GPU MILLISECONDS, which is the column `sweep` leads
 * with wherever the driver will give it. Not the frame rate, and — since this
 * piece started holding 60 — not the frame interval either: an interval that is
 * sitting on vsync reports the same number whatever you switch off. See
 * `createGpuTimer` for how much that cost before it was noticed.
 *
 * THE TABLE, measured on an M3 once the timer made it measurable, against a
 * baseline of 13.2 gpu ms with 0.67 of drift under it:
 *
 *   no frost          5.94 ms   45% of the frame
 *   no shadows        5.47 ms   41%
 *   no area lights    2.05 ms   15%
 *   at pixel ratio 1  0.28 ms    2%
 *   no grain          0.18 ms    1%
 *
 * Two of those overturn what this file used to assert, and the assertions are
 * corrected where they live rather than only here. The frost was believed free
 * and is the most expensive thing in the piece. The pixel ratio was THE test
 * and is now noise, which is the real headline: at 0.28 ms this frame is not
 * fill-rate bound any more, so the whole family of fixes that trade resolution
 * for frames has nothing left to buy.
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

/**
 * Drawn and thrown away before the first baseline is taken.
 *
 * A GPU that has been idle is not running at the clocks it will settle on, and
 * the first seconds of a sweep are therefore measured on a different device
 * from the last. The first run of the timer-based version of this instrument
 * read 11.09 gpu ms at the top and 31.16 at the bottom — a drift nearly three
 * times the largest effect in the table, which cost the whole run.
 *
 * Bracketing cancels drift to first order, but only drift that is roughly
 * LINEAR across the two baselines around a reading. A clock ramp is a curve at
 * the start and flat afterwards, so the honest fix is to not measure the curve:
 * spend a couple of seconds getting there first.
 */
const WARMUP_MS = 2500

function median(samples: number[]): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]!
}

/**
 * What one measurement window came back with.
 *
 * Two numbers because they answer different questions and only one of them can
 * be trusted for small effects — see `createGpuTimer`.
 */
interface Reading {
  /** Median wall-clock interval between frames. Quantised by vsync. */
  interval: number
  /** Median GPU time for the frame's own draw. Null when unmeasurable. */
  gpu: number | null
}

/**
 * Reads how long the GPU actually spent on the frame.
 *
 * THIS IS THE ONLY HONEST NUMBER IN THE FILE, and the reason is a wall the
 * interval-based version of this instrument spent two sweeps walking into.
 *
 * The frame interval cannot measure a GPU-bound frame that is keeping up. With
 * vsync on, the interval is not "how long the work took" — it is "how many
 * refresh periods the work needed", and it is therefore QUANTISED. A frame
 * costing 8 ms and a frame costing 16 ms both come back as one refresh period
 * on a 60 Hz panel. Every knockout measured while the piece is holding its
 * frame rate reads as zero, and the table dutifully prints a column of zeroes
 * that look exactly as authoritative as findings.
 *
 * Worse than useless, actually: it can only see the wrong sign. Switching work
 * off can never show a saving at the cap because there is no headroom to show
 * it in, while switching work off and accidentally crossing a refresh boundary
 * shows up as a large REGRESSION. A capped sweep is an instrument that reports
 * only bad news, which is how a table ends up saying that turning the shadow
 * pass off made the frame slower.
 *
 * Raising the resolution to get off the cap does not fix it. That moves the
 * quantum, it does not remove it: at 33 ms the readings snap to multiples of
 * 16.7 instead of to 16.7 itself, and the effects being hunted here are single
 * milliseconds.
 *
 * `EXT_disjoint_timer_query_webgl2` sidesteps the whole problem by asking the
 * GPU what it did rather than inferring it from when the browser came back. The
 * result is in nanoseconds, it is independent of vsync, and it is the actual
 * quantity every knockout in this file is trying to change.
 *
 * Two things it demands in exchange:
 *
 * A query is asynchronous — the answer is not ready on the frame it was asked
 * about — so results are polled out of a queue some frames later. Nothing here
 * ever blocks on `QUERY_RESULT`, because doing that stalls the pipeline and the
 * measurement would then be of the stall.
 *
 * And `GPU_DISJOINT_EXT` has to be honoured. It means the GPU was interrupted —
 * a clock change, a context switch, another application taking the device — and
 * that every timing in flight is meaningless rather than merely noisy. Those
 * samples are DISCARDED, not averaged, because a disjoint does not produce a
 * wrong number in a predictable direction.
 */
interface GpuTimer {
  readonly supported: boolean
  /** Brackets every top-level draw with a query. */
  attach(): void
  detach(): void
  /** Median GPU ms since the last call, and forgets what it returned. */
  take(): number | null
}

function createGpuTimer(renderer: WebGLRenderer): GpuTimer {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number
    GPU_DISJOINT_EXT: number
  } | null

  const samples: number[] = []
  const pending: WebGLQuery[] = []
  let original: WebGLRenderer['render'] | null = null
  // Three renders the shadow map inside the same top-level call. Only ONE
  // `TIME_ELAPSED` query may be open at a time, so nesting has to be counted
  // rather than assumed away — the outermost call owns the query and the inner
  // ones pass straight through. Bracketing the outermost is also what makes the
  // number whole: the shadow pass is part of what the frame cost.
  let depth = 0

  const drain = (): void => {
    if (!ext) return
    let disjoint = false
    while (pending.length > 0) {
      const query = pending[0]!
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break
      pending.shift()
      // Read once per drain, after pulling results: the flag latches and is
      // cleared by being read, so testing it per query would clear it for the
      // first and report clean for the rest of a disjoint batch.
      disjoint = disjoint || (gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean)
      if (!disjoint) samples.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6)
      gl.deleteQuery(query)
    }
  }

  return {
    supported: ext !== null,

    attach(): void {
      if (!ext || original) return
      const inner = renderer.render.bind(renderer)
      original = renderer.render

      renderer.render = function timed(scene, camera): void {
        if (depth > 0) {
          inner(scene, camera)
          return
        }

        depth++
        drain()
        const query = gl.createQuery()
        if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
        try {
          inner(scene, camera)
        } finally {
          if (query) {
            gl.endQuery(ext.TIME_ELAPSED_EXT)
            pending.push(query)
          }
          depth--
        }
      }
    },

    detach(): void {
      if (!original) return
      renderer.render = original
      original = null
      for (const query of pending) gl.deleteQuery(query)
      pending.length = 0
      samples.length = 0
    },

    take(): number | null {
      if (!ext) return null
      drain()
      if (samples.length === 0) return null
      const value = median(samples)
      samples.length = 0
      return value
    },
  }
}

/** One measurement window: intervals throughout, GPU time over the same span. */
function measure(timer: GpuTimer | null): Promise<Reading> {
  return new Promise((resolve) => {
    const samples: number[] = []
    const start = performance.now()
    let last = start
    let settled = false

    const tick = (): void => {
      const now = performance.now()
      const past = now - start > SETTLE_MS
      if (past) {
        samples.push(now - last)
        // Everything the timer collected during the settle belongs to the
        // previous state. Dropped at the boundary rather than filtered later,
        // for the same reason the intervals are.
        if (!settled) {
          settled = true
          timer?.take()
        }
      }
      last = now

      if (now - start < SETTLE_MS + MEASURE_MS) {
        requestAnimationFrame(tick)
        return
      }

      // Median rather than mean. A sweep runs for seconds and something else on
      // the machine will hitch at some point during it; one 200 ms frame moves
      // a mean of sixty samples by three milliseconds, which is the size of the
      // effects being looked for. It cannot move the median at all.
      resolve({ interval: median(samples), gpu: timer?.take() ?? null })
    }

    requestAnimationFrame(tick)
  })
}

export interface Knockouts {
  /**
   * Redraws at a different device pixel ratio, 1 being one buffer pixel per CSS
   * pixel. Fragment cost goes with the SQUARE of this, so a piece drawing at
   * the 1.75 the stage clamps to is paying three times what it would at 1.
   *
   * This was THE test and the one to run first, on the reasoning that a large
   * drop here says the frame is fragment-bound and nothing else needs testing.
   * The reasoning still holds; the piece no longer answers to it. Measured at
   * 0.28 ms of a 13.2 ms frame once GPU timing made it readable — two per cent,
   * against the 19 ms the interval-based instrument was reporting while it was
   * pinned to vsync and reading its own quantisation.
   *
   * So it stays as a control rather than as the headline: a near-zero here is
   * now the EXPECTED result, and a large one would mean something regressed
   * back into the fragment path.
   */
  pixelRatio(ratio: number): string
  /**
   * Stops the depth pass outright. Isolates the cost of eleven casters.
   *
   * 5.47 ms of a 13.2 ms frame, which makes it co-equal with the frost and the
   * joint most expensive thing here. Every one of the eleven sheets is rendered
   * into the map, the translucent ones through a stochastic discard that
   * forfeits early-Z, and that is what it costs.
   *
   * Worth knowing what this row used to say: on the interval instrument it read
   * -3.9 ms — switching the shadow pass OFF made the frame SLOWER — which is
   * impossible and was believed long enough to be worth chasing. It was vsync.
   * The frame was pinned at the refresh either way and the reading had snapped
   * to a different multiple of it.
   */
  shadows(on: boolean): string
            /**
   * Resizes the shadow map, which is the depth pass's FRAGMENT budget.
   *
   * The depth material discards — that is what lets a film cast an honest
   * shadow — and a discard forfeits early-Z, so every texel a caster covers
   * runs a real fragment shader. If that is where the pass goes, cost falls
   * with the SQUARE of this and 512 buys three quarters of it back.
   */
  shadowMap(size: number): string
  /**
   * How many of the eleven sheets are allowed to cast, which is the depth
   * pass's per-draw budget.
   *
   * The other half of the same question: each caster is its own draw with its
   * own run of the loft in the vertex stage. If the pass is per-caster rather
   * than per-texel, this is the row that moves and the map size is the one that
   * does not.
   */
  shadowCasters(count: number): string
  /** Stops the film grain. Four instructions per fragment; a control, mostly. */
  grain(on: boolean): string
  /**
   * Stops every area light, leaving the directionals and the environment.
   *
   * The one knockout aimed at the SHADING rather than at a feature drawn on
   * top of it, and for a long time the largest number in the table after the
   * pixel ratio. Three's `RectAreaLight` is evaluated with linearly transformed
   * cosines: a pair of float-texture lookups plus a substantial amount of
   * matrix work, per light, PER FRAGMENT. Three of them across eleven
   * overlapping layers was thirty-three LTC evaluations on every pixel the
   * stack covers, and nothing about that is visible in a profile of the CPU.
   *
   * That is history rather than the current rig: this knockout is what
   * condemned `bounce` and then `rim`, and `key` is the only panel left. So it
   * now measures eleven evaluations rather than thirty-three, and a row that
   * reads much smaller than it used to is the fix landing, not the instrument
   * breaking. The lights are found by traversing the scene, so the count here
   * follows `stage.ts` on its own and this comment is the only thing that can
   * go stale.
   *
   * This is the only knockout that recompiles, and it has to be. The count of
   * visible lights of each type is part of three's program cache key, so
   * hiding them IS a different shader — which is exactly the point, since a
   * light left visible at zero intensity would run every instruction of the
   * LTC path and multiply the result by nothing. That measures the cost of
   * darkness, not the cost of the light.
   *
   * So the rebuild is forced here, synchronously, rather than left to happen on
   * the next draw. The stall then lands inside this call instead of inside the
   * measurement that follows it — which is the whole reason the rest of the
   * file avoids recompiles rather than paying for them.
   *
   * The frame goes dark. That is not a fault in the reading: what is being
   * timed is the work, and the work is gone.
   */
  lights(on: boolean): string
  /** Everything back as authored. */
  reset(): string
  /**
   * Median GPU milliseconds over a measurement window, on demand.
   *
   * For following something up by hand, the way the individual knockouts are.
   * Resolves to null where `EXT_disjoint_timer_query_webgl2` is unavailable,
   * which is a real answer and not a failure: it means every small number this
   * file could otherwise print would have been the refresh period in disguise.
   */
  gpu(): Promise<number | null>
  /**
   * Runs the whole set, one at a time, and prints what each one was worth.
   *
   * This is the entry point — the individual knockouts above are for following
   * something up. Reading them by hand off the counter means holding a number
   * in your head across a state change, which is where the errors come from:
   * the interesting differences here are a few milliseconds and the counter is
   * updating four times a second while you look away to type.
   *
   * Takes about half a minute — every knockout is measured against a baseline
   * taken on either side of it, so there are eleven readings and not six. That
   * is what the extra time buys, and it is not optional: a single baseline at
   * the top of the run charges whichever knockout was active while the machine
   * sagged for the sag, and the result is a table where switching work off
   * makes the frame slower.
   *
   * Reported in GPU MILLISECONDS where the driver will give them, and that is
   * the column to read. The frame interval is printed beside it for context and
   * is not a measurement of anything small: see `createGpuTimer` for why a
   * vsync-quantised interval can only ever report the wrong sign.
   *
   * Leave the machine alone while it runs, and give it a build rather than the
   * dev server. Puts the piece back exactly as it was.
   */
  sweep(): Promise<void>
}

export function createKnockouts(orchestrator: SceneOrchestrator): Knockouts {
  const { renderer, scene, camera } = orchestrator.stage

  // Found by walking the scene rather than handed over by `createStage`, so the
  // rig can gain or lose a panel without this having to be told. Duck-typed on
  // the flag three sets, which is also what its own renderer sorts lights by.
  const areaLights: RectAreaLight[] = []
  scene.traverse((object) => {
    if ((object as RectAreaLight).isRectAreaLight) areaLights.push(object as RectAreaLight)
  })

  // Captured before anything is switched off, so `reset` restores what the
  // composition authored rather than whatever the last knockout left behind.
  const pixelRatio = renderer.getPixelRatio()
  const casters = orchestrator.sheets.map((sheet) => sheet.mesh.castShadow)
  const grainAmount = orchestrator.sheets[0]?.uniforms.uGrain.value ?? 0
  const lit = areaLights.map((light) => light.visible)

  const shippedShadowMap = orchestrator.stage.keyLight.shadow.mapSize.x
  const timer = createGpuTimer(renderer)

  const knockouts: Knockouts = {
    pixelRatio(ratio) {
      // The governor owns this number in normal running and will take it back
      // within a second. A measurement it is quietly undoing halfway through is
      // worse than no measurement, because it looks like one.
      orchestrator.resolution.enabled = false
      const was = renderer.getPixelRatio()
      renderer.setPixelRatio(ratio)
      // Never `setPixelRatio` alone: the grain's cell grid is sized to the
      // drawing buffer texel for texel, and a grid that disagrees with it
      // changes the grain under the measurement.
      orchestrator.refresh()
      return `pixel ratio ${was} → ${ratio}`
    },

    shadows(on) {
      orchestrator.sheets.forEach((sheet, i) => {
        sheet.mesh.castShadow = on ? casters[i]! : false
      })
      return `shadows ${on ? 'on' : 'off'}`
    },

    shadowMap(size) {
      const light = orchestrator.stage.keyLight
      const was = light.shadow.mapSize.x
      light.shadow.mapSize.set(size, size)
      // Three allocates the render target once and keeps it. Dropping it is
      // what makes the new size take effect on the next shadow render.
      light.shadow.map?.dispose()
      light.shadow.map = null
      return `shadow map ${was} → ${size}`
    },

    shadowCasters(count) {
      let given = 0
      orchestrator.sheets.forEach((sheet, i) => {
        const wanted = casters[i]! && given < count
        if (wanted) given++
        sheet.mesh.castShadow = wanted
      })
      return `shadow casters ${given} of ${casters.filter(Boolean).length}`
    },






    grain(on) {
      for (const sheet of orchestrator.sheets) {
        sheet.uniforms.uGrain.value = on ? grainAmount : 0
      }
      return `grain ${on ? 'on' : 'off'}`
    },

    lights(on) {
      areaLights.forEach((light, i) => {
        light.visible = on ? lit[i]! : false
      })
      // Now, not on the next draw. Three rebuilds a material's program the
      // first time it renders under a changed light configuration, and that
      // rebuild is tens of milliseconds per material across eleven of them —
      // straight into the window that was about to be timed. Paying for it here
      // is the difference between measuring the light and measuring the
      // compiler.
      renderer.compile(scene, camera)
      return `area lights ${on ? 'on' : 'off'} (${areaLights.length})`
    },

    reset() {
      knockouts.shadows(true)
      knockouts.shadowMap(shippedShadowMap)
      knockouts.grain(true)
      knockouts.lights(true)
      const restored = knockouts.pixelRatio(pixelRatio)
      // Last, and after the ratio is back where it started: handing the
      // governor a resolution it did not choose is how it ends up correcting
      // for a state that no longer exists.
      orchestrator.resolution.enabled = true
      return restored
    },

    async gpu(): Promise<number | null> {
      timer.attach()
      const reading = await measure(timer)
      timer.detach()
      return reading.gpu
    },

    async sweep(): Promise<void> {
      // Every run measures the baseline again rather than trusting one taken
      // earlier. The machine warms up, the browser throttles, another tab
      // starts doing something — a difference against a stale baseline is a
      // difference against the weather.
      knockouts.reset()

      // THE GOVERNOR IS OFF FOR THE WHOLE SWEEP, and this is not a nicety.
      //
      // It reads the same frames this does and acts on them: a baseline slow
      // enough to be worth measuring is, by definition, slow enough for the
      // governor to answer by dropping resolution. It then holds the frame at
      // the budget for every row that follows — so each knockout is measured
      // against a resolution chosen for the row before it, every reading lands
      // on the frame budget, and the table comes back saying that the film
      // grain and the frost cost precisely the same amount. Which is the
      // signature of the failure and not a finding.
      //
      // `pixelRatio` already refuses to be governed for exactly this reason.
      // The scope was the bug: one knockout was protected and the sweep around
      // it was not. `reset` at the end is what turns it back on.
      orchestrator.resolution.enabled = false

      // Every knockout is BRACKETED: a baseline is measured on either side of
      // it and the saving is taken against their mean, not against one number
      // captured at the top of the run.
      //
      // The one-baseline version could not survive a machine that changes, and
      // machines change — they heat up and clock down, the compositor picks up
      // work, something else starts. A sweep takes the better part of a minute,
      // and against differences of a few milliseconds that drift is not noise
      // around the answer, it IS the answer: whatever knockout happened to be
      // in force while the machine sagged gets charged for the sag. The tell is
      // unmistakable once seen — switching work OFF comes back SLOWER, which no
      // amount of measurement error can produce and no real cost can either.
      //
      // Bracketing cancels drift to first order, because a straight line
      // between the two baselines is exactly their mean at the point in between.
      // What it cannot fix, it can at least SHOW: the spread of the baselines
      // is reported below, and if the machine moved further than the largest
      // effect being looked for, the table says so instead of being believed.
      //
      // The order is unchanged and still deliberate: the three cheap switches,
      // then the one that recompiles, then the ratio, which is the only one
      // that reallocates buffers.
      const trials: [label: string, off: () => void, on: () => void][] = [
        ['no shadows', () => void knockouts.shadows(false), () => void knockouts.shadows(true)],
        ['no grain', () => void knockouts.grain(false), () => void knockouts.grain(true)],
        ['no area lights', () => void knockouts.lights(false), () => void knockouts.lights(true)],
        [
          'at pixel ratio 1',
          () => void knockouts.pixelRatio(1),
          () => void knockouts.pixelRatio(pixelRatio),
        ],
      ]

      // Attached for the whole run and detached before the table is printed, so
      // the renderer is only wrapped while something is actually being timed.
      timer.attach()
      if (!timer.supported) {
        console.warn(
          'EXT_disjoint_timer_query_webgl2 is unavailable, so this falls back to frame intervals. ' +
            'Intervals are quantised by vsync: while the piece is holding its frame rate they can ' +
            'show a regression but never a saving, and every small figure below is the refresh ' +
            'period rather than a cost. Treat the table as a smoke test, not as measurements.',
        )
      }

      // Nothing is read off this. It exists so the first baseline is taken on a
      // GPU already at its running clocks — see `WARMUP_MS`.
      await new Promise<void>((resolve) => window.setTimeout(resolve, WARMUP_MS))
      timer.take()

      const baselines = [await measure(timer)]
      const measured: [label: string, reading: Reading, bracket: Reading, spread: number][] = []

      for (const [label, off, on] of trials) {
        off()
        const reading = await measure(timer)
        on()
        baselines.push(await measure(timer))

        // The two that sandwich this reading, and no others.
        const before = baselines[baselines.length - 2]!
        const after = baselines[baselines.length - 1]!
        const bracket: Reading = {
          interval: (before.interval + after.interval) / 2,
          gpu: before.gpu !== null && after.gpu !== null ? (before.gpu + after.gpu) / 2 : null,
        }
        // How far the machine moved UNDER THIS ROW specifically. The global
        // drift condemns the whole table at once, which is too blunt: a sweep
        // where the machine sagged during one trial still has four good rows in
        // it, and this is what tells them apart.
        const spread =
          before.gpu !== null && after.gpu !== null
            ? Math.abs(after.gpu - before.gpu)
            : Math.abs(after.interval - before.interval)
        measured.push([label, reading, bracket, spread])
      }

      timer.detach()
      knockouts.reset()

      // Which column the verdict is taken from. The GPU one whenever the driver
      // gave it, because it is the only one that can carry a small number.
      const usingGpu = measured.every(
        ([, reading, bracket]) => reading.gpu !== null && bracket.gpu !== null,
      )
      const figure = (reading: Reading): number => (usingGpu ? reading.gpu! : reading.interval)

      // A reading is only a floor when something ELSE reached the same wall.
      // The fastest measurement of any sweep is trivially the fastest one, and
      // marking it for that alone was a marker that fired every single time.
      //
      // Only ever applied to the interval column. GPU time has no ceiling to
      // hit: it is what the device spent, whether or not the frame then sat
      // waiting for a refresh.
      const intervals = [...baselines.map((b) => b.interval), ...measured.map(([, r]) => r.interval)]
      const floor = Math.min(...intervals)
      const atFloor = intervals.filter((ms) => ms <= floor * 1.03).length

      const rows: Record<string, Record<string, string>> = {}
      for (const [label, reading, bracket, spread] of measured) {
        const capped = atFloor > 1 && reading.interval <= floor * 1.03
        const saves = usingGpu ? bracket.gpu! - reading.gpu! : bracket.interval - reading.interval
        rows[label] = usingGpu
          ? {
              'gpu ms': reading.gpu!.toFixed(2),
              'gpu baseline': bracket.gpu!.toFixed(2),
              saves: `${saves.toFixed(2)} ms`,
              // The row's own verdict. A saving smaller than how far the
              // machine moved underneath it is not a small saving, it is no
              // reading at all — and saying so per row keeps the good rows of a
              // partly-spoiled sweep usable.
              verdict:
                Math.abs(saves) <= spread
                  ? `lost in drift (±${spread.toFixed(2)})`
                  : `drift ±${spread.toFixed(2)}`,
              'interval ms': `${reading.interval.toFixed(1)}${capped ? ' (at vsync)' : ''}`,
            }
          : {
              'ms/frame': reading.interval.toFixed(1),
              'baseline (bracketed)': bracket.interval.toFixed(1),
              saves: `${(bracket.interval - reading.interval).toFixed(1)} ms`,
              'at ceiling': capped ? 'floor, not a figure' : '',
            }
      }

      console.table(rows)

      const readings = baselines.map(figure)
      const low = Math.min(...readings)
      const high = Math.max(...readings)
      const drift = high - low
      const largest = Math.max(
        ...measured.map(([, reading, bracket]) => Math.abs(figure(bracket) - figure(reading))),
      )
      const survivors = measured.filter(
        ([, reading, bracket, spread]) => Math.abs(figure(bracket) - figure(reading)) > spread,
      )
      const unit = usingGpu ? 'gpu ms' : 'ms interval'

      console.log(
        `baseline ${low.toFixed(2)}–${high.toFixed(2)} ${unit} across ${baselines.length} readings (drift ${drift.toFixed(2)})`,
      )
      // Said out loud rather than left for the reader to notice, because the
      // table looks exactly as authoritative either way.
      if (drift > largest) {
        console.warn(
          `The machine moved ${drift.toFixed(2)} ${unit} across the whole sweep and the largest effect measured is ${largest.toFixed(2)}. ` +
            (survivors.length > 0
              ? `Read the per-row verdict rather than the table as a whole — ${survivors.length} of ${measured.length} rows still cleared their own bracket: ${survivors.map(([label]) => label).join(', ')}.`
              : 'No row cleared its own bracket. Nothing in that table is a measurement. Close what else is running and try again.'),
        )
      }

      // A negative saving is switching work OFF and getting a SLOWER frame,
      // which no real cost can produce. On the interval column it is usually
      // vsync: the reading crossed a refresh boundary and snapped a whole
      // period. On the GPU column it cannot be that, so if one survives here it
      // is either drift — which the line above will have said — or something
      // genuinely backwards worth chasing.
      const backwards = measured
        .filter(([, reading, bracket]) => figure(bracket) - figure(reading) < -drift)
        .map(([label]) => label)
      if (backwards.length > 0) {
        console.warn(
          `Switching work off came back SLOWER, by more than the baseline drift: ${backwards.join(', ')}. ` +
            (usingGpu
              ? 'This is GPU time, so vsync cannot explain it. Re-run before believing it; if it survives, it is real and worth chasing.'
              : 'This is the frame interval, so the likeliest explanation by far is a vsync boundary rather than a cost.'),
        )
      }
    },
  }

  return knockouts
}
