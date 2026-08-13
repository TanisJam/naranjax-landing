/**
 * How long a reading is accumulated over before it is written to the screen.
 *
 * Four updates a second. A number that changes sixty times a second is not a
 * readout, it is a flicker — nobody can read a millisecond figure at frame rate
 * and the eye ends up averaging it badly, which is the job this is here to do
 * properly.
 */
const WINDOW_MS = 250

/**
 * Gap above which the loop is assumed to have STOPPED rather than run slowly.
 *
 * The frame loop is halted whenever the tab is hidden or the panel scrolls out
 * of view, so the first interval after it resumes is however long the user was
 * away. Recorded as a frame time that would sit in the worst-case figure for
 * the rest of the session and read as a catastrophic hitch that never happened.
 * Well above any real frame: four vsyncs at 30 Hz.
 */
const DISCONTINUITY_MS = 140

/**
 * Frame timing, on screen.
 *
 * Two numbers rather than one, and the second is the reason this exists in this
 * form. `interval` is the true wall-clock time between frames and is the one
 * that answers "is it smooth"; `cpu` is how long the frame's own JavaScript
 * took, measured around the loop body.
 *
 * The gap between them is the diagnosis. `renderer.render` returns as soon as
 * the commands are submitted and long before the GPU has drawn any of them, so
 * work moved onto the GPU — a shadow pass over eleven plates, say, or seven
 * layers each running a blur — costs nothing in `cpu` and shows up ONLY as the
 * interval stretching. A reading of 33 ms interval against 3 ms cpu says the
 * GPU is the bottleneck and no amount of JavaScript tuning will touch it. The
 * same 33 ms against 30 ms cpu is the opposite problem entirely, and they are
 * indistinguishable from a frame rate alone.
 */
export class FrameCounter {
  private readonly element: HTMLElement

  private last = 0
  private windowStart = 0
  private frames = 0
  private intervalSum = 0
  private cpuSum = 0
  private worst = 0

  constructor(parent: HTMLElement = document.body) {
    const element = document.createElement('div')
    // Styled here rather than in the stylesheet on purpose: this is an
    // instrument, not part of the page, and it should be removable by deleting
    // one file.
    element.style.cssText = [
      'position:fixed',
      'top:8px',
      'left:8px',
      'z-index:9999',
      'padding:4px 8px',
      'border-radius:4px',
      'background:rgba(0,0,0,.72)',
      'color:#8fe',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'white-space:pre',
      // It sits over the artwork, and the artwork is the thing being measured.
      // An instrument that eats the pointer events changes what it is reading.
      'pointer-events:none',
      'user-select:none',
    ].join(';')
    element.textContent = 'measuring…'
    parent.appendChild(element)
    this.element = element
  }

  /** Call once per rendered frame, with the time that frame's own work took. */
  sample(cpuMs: number): void {
    const now = performance.now()
    const interval = now - this.last
    this.last = now

    // A resumed loop is not a slow frame. Dropping the sample keeps the pause
    // out of both the average and the worst case; the window it interrupted is
    // simply one frame short, which is under a percent of a 250 ms reading.
    if (interval > DISCONTINUITY_MS) return

    this.frames++
    this.intervalSum += interval
    this.cpuSum += cpuMs
    if (interval > this.worst) this.worst = interval

    if (now - this.windowStart < WINDOW_MS) return
    this.windowStart = now

    if (this.frames > 0) {
      const mean = this.intervalSum / this.frames
      this.element.textContent =
        `${(1000 / mean).toFixed(0).padStart(3)} fps` +
        `  ${mean.toFixed(1).padStart(5)} ms` +
        `  cpu ${(this.cpuSum / this.frames).toFixed(1).padStart(5)}` +
        `  peak ${this.worst.toFixed(1).padStart(5)}`
    }

    this.frames = 0
    this.intervalSum = 0
    this.cpuSum = 0
    this.worst = 0
  }

  dispose(): void {
    this.element.remove()
  }
}
