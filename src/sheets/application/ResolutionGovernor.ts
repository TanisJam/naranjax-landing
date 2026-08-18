/**
 * The frame this is trying to hold, in milliseconds.
 *
 * Sixty a second. Not because the piece cannot be watched at forty — it can —
 * but because a MISSED frame is what reads as stutter, and missing them is what
 * a variable frame time does. Forty-five held perfectly still would look better
 * than forty-five wandering, and neither is available: the cost of a frame here
 * changes with how much of the stack is on screen, whether a layer is peeling
 * and how many frosted films the camera is looking through.
 *
 * A display running at 120 is left holding 60 rather than pushed at its own
 * rate. Doubling the frame rate would double the pixels a second and this is
 * the wrong piece to spend that on: it is a slow, near-still object, and its
 * motion carries almost nothing above 60.
 */
const FRAME_BUDGET_MS = 16.6

/**
 * How far over budget a frame has to run before the resolution comes down, and
 * how far under it before quality is offered back.
 *
 * The gap between them is the whole of what keeps this from oscillating. With
 * one threshold, dropping the resolution lands the frame just under it, which
 * immediately argues for putting it back, which puts the frame over again —
 * once a second, for as long as the page is open, each swing reallocating the
 * drawing buffer and the backdrop capture.
 *
 * Derived from the budget rather than written next to it, so there is one place
 * to change the target and the band cannot drift away from it.
 */
const DROP_ABOVE_MS = FRAME_BUDGET_MS * 1.12
const RAISE_BELOW_MS = FRAME_BUDGET_MS * 0.93

/** Ratio step. Small enough that a correction is not itself a visible event. */
const STEP = 1.12

/**
 * How long a reading is gathered over, and how long the pipeline is given to
 * settle after a change before the next one starts.
 *
 * The settle matters more here than the window does. Changing the ratio
 * reallocates the drawing buffer and the backdrop texture, and the frames
 * during which the driver is doing that are far slower than the state they are
 * measuring — read as a verdict, they say the change made things worse and
 * argue for undoing it, every time.
 */
const WINDOW_MS = 700
const SETTLE_MS = 500

/**
 * Cooldown before quality is offered back after it has just been taken away,
 * and how much longer that wait gets each time the offer is refused.
 *
 * Backing off is what makes this converge. A machine that cannot hold 60 at a
 * given resolution will fail the same probe forever, and without the growing
 * wait it would fail it every four seconds all afternoon — a visible hitch each
 * time, for a question already answered.
 */
const PROBE_WAIT_MS = 4000
const PROBE_BACKOFF = 2

/**
 * Holds the frame rate by spending resolution, and only as much as it has to.
 *
 * The knockouts measured where this piece's time goes: at the authored 1.75 it
 * ran 22.3 ms a frame, and at 1 it hit the 16.6 ms vsync ceiling and stopped —
 * so the frame is fragment-bound, and pixels are the one thing it has plenty of
 * to trade. Fragment cost goes with the SQUARE of the ratio, which is what
 * makes this lever so much larger than any feature in the frame: the frost, the
 * most expensive thing the piece draws, is worth 3.7 ms, and the ratio is worth
 * more than 5.7.
 *
 * The reason it is adaptive rather than a lower number in `stage.ts` is that
 * there is no lower number that is right. The measurement above came off ONE
 * machine at ONE window size. Fixing the ratio at what suits it takes sharpness
 * away from every faster machine that never needed to give any up, and still
 * misses on slower ones. This starts at the authored ceiling and only ever
 * moves if the frames say so, so a machine that can afford the piece as
 * designed renders it exactly as designed and never learns this class exists.
 *
 * It also probes back upward. A frame held at 60 tells you nothing about how
 * much room is left — the interval is pinned at the vsync period whether there
 * is one millisecond of headroom or ten — so the only way to find out is to ask
 * for more and watch what happens.
 */
export class ResolutionGovernor {
  /** Set false while something else owns the ratio. See the knockouts. */
  enabled = true

  private samples: number[] = []
  private windowStart = 0
  private quietUntil = 0
  private probeWait = PROBE_WAIT_MS
  private ratio: number

  constructor(
    /** The authored ratio, and the most this will ever ask for. */
    private readonly ceiling: number,
    /**
     * Below this the piece stops being the piece — edges the whole composition
     * is built around start to crawl, and no frame rate buys that back.
     */
    private readonly floor = 1,
    /**
     * Where it BEGINS, which is not the same question as how high it may go.
     *
     * Defaulted to the ceiling, which is the old behaviour and the right one
     * while the ceiling is what the piece was authored at. It stops being right
     * the moment the ceiling carries something optional on top — the
     * supersample in `stage.ts` — because then starting there means every load
     * opens at the most expensive setting the piece has and walks DOWN from it.
     * At a 12% step and 1.2 s a correction that is about seven seconds of
     * dragging, on every visit, on exactly the machines that cannot afford it.
     *
     * Starting at the authored ratio inverts that: the piece opens at the cost
     * it was designed for, and the probe upward — which this already does, and
     * which is the only way to discover headroom behind a pinned vsync — buys
     * the supersample back within a couple of seconds on a machine that has the
     * room. Fast machines get the quality, slow ones never pay for asking.
     */
    start = ceiling,
  ) {
    this.ratio = Math.min(Math.max(start, floor), ceiling)
  }

  /**
   * Feeds one frame in and returns the ratio to switch to, or null to stay.
   *
   * Returning rather than applying, because the drawing buffer and the backdrop
   * capture have to be resized together and the orchestrator is what knows how.
   */
  update(intervalMs: number, now: number): number | null {
    if (!this.enabled) return null

    // Discard everything until the pipeline has settled from the last change,
    // and treat a long gap as the loop having been stopped rather than as a
    // catastrophic frame — the tab can be hidden and the panel scrolled away.
    if (now < this.quietUntil || intervalMs > 140) {
      this.samples.length = 0
      this.windowStart = now
      return null
    }

    this.samples.push(intervalMs)
    if (now - this.windowStart < WINDOW_MS || this.samples.length < 8) return null

    this.samples.sort((a, b) => a - b)
    const median = this.samples[this.samples.length >> 1]!
    this.samples.length = 0
    this.windowStart = now

    if (median > DROP_ABOVE_MS && this.ratio > this.floor) {
      // The probe that led here, if any, was refused. Wait longer before the
      // next one, so a machine that simply cannot hold this stops being asked.
      this.probeWait *= PROBE_BACKOFF
      return this.settle(Math.max(this.ratio / STEP, this.floor), now)
    }

    if (median < RAISE_BELOW_MS && this.ratio < this.ceiling) {
      return this.settle(Math.min(this.ratio * STEP, this.ceiling), now)
    }

    // Pinned at the vsync period with room unknown. Ask for more, occasionally.
    if (median <= DROP_ABOVE_MS && this.ratio < this.ceiling) {
      if (now < this.quietUntil + this.probeWait) return null
      return this.settle(Math.min(this.ratio * STEP, this.ceiling), now)
    }

    return null
  }

  private settle(ratio: number, now: number): number | null {
    if (Math.abs(ratio - this.ratio) < 1e-3) return null
    this.ratio = ratio
    this.quietUntil = now + SETTLE_MS
    return ratio
  }
}
