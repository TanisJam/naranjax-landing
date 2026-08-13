import { Raycaster, Vector2, type Camera, type Object3D } from 'three'
import type { SheetObject } from '../infrastructure/three/SheetObject'

/**
 * Most pointer samples one frame will act on.
 *
 * A stalled frame can bank hundreds, and replaying all of them would fire a
 * crossing for a gesture that finished long ago. The newest are kept because
 * the oldest are the ones whose crossings are already stale.
 */
const MAX_SAMPLES = 24

/** What caused a pick to change, for whoever has to answer it. */
export interface PickChange {
  /**
   * Whether the user caused it. A pick can change under a perfectly still
   * pointer, because the artwork floats and drifts a boundary across it —
   * measured at one or two crossings every three seconds on the layers whose
   * edge happens to sit near the pointer. Following it with the highlight is
   * right; the layer under the pointer really did change. Anything that reads
   * as a response to the USER has to check this first.
   */
  fromPointer: boolean
  /**
   * Seconds after the first crossing of this frame.
   *
   * A fast sweep produces several crossings between two frames, and they did
   * NOT happen at the same instant — the samples carry the real spacing. Firing
   * them all at once flattens a run of ticks into a single flam.
   */
  offset: number
  /** Pointer speed at the crossing, in NDC units per second. */
  speed: number
}

interface Sample {
  x: number
  y: number
  time: number
}

/**
 * Which layer the pointer is over.
 *
 * Resolved per frame rather than per pointer event, and that is not a detail:
 * the artwork floats, tilts under the parallax and slides through the whole
 * deploy, so the layer under a perfectly still pointer changes on its own. A
 * hover computed on `pointermove` would be stale the moment the piece moved.
 *
 * But per frame does not mean once per frame. Every sample the pointer produced
 * since the last frame is replayed in order against the current transforms,
 * because a single test at the newest position only sees where the sweep ENDED.
 * A mouse reports at 125-1000Hz against a 60Hz frame; a flick crosses four
 * layers in one frame and the three in the middle never existed. They did not
 * arrive late — the old code never asked about them.
 *
 * Eleven plane intersections is nothing, and two dozen of those is still
 * nothing — this is not the cost anyone was worried about.
 */
export class LayerPicker {
  /** The layer under the pointer, or null. */
  hovered: SheetObject | null = null

  /**
   * Clear to freeze the current pick and stop testing. The `selected` seam
   * below is where a click on a layer will eventually land.
   */
  enabled = true

  /**
   * Fired when the pick changes, and only then — the pointer crossing a
   * boundary is the event, not the pointer moving. Null means it left the
   * stack, which callers usually want to ignore rather than answer.
   */
  onChange: ((layer: SheetObject | null, change: PickChange) => void) | null = null

  private readonly raycaster = new Raycaster()
  private readonly ndc = new Vector2()

  /** Built once: this is walked several times per frame now, not once. */
  private readonly targets: Object3D[]
  private readonly byHitArea = new Map<Object3D, SheetObject>()

  /**
   * Ring buffer, preallocated. `pointermove` fires hundreds of times a second
   * and every one of them would otherwise leave an object behind.
   */
  private readonly samples: Sample[] = Array.from({ length: MAX_SAMPLES }, () => ({
    x: 0,
    y: 0,
    time: 0,
  }))
  private head = 0
  private pending = 0

  private inside = false
  /** Last position resolved, reused on frames where the pointer held still. */
  private lastX = 0
  private lastY = 0
  private lastTime = 0

  private readonly onPointerMove = (event: PointerEvent): void => {
    // Mouse only. A touch pointer reports a position while the finger is down
    // and then leaves it there, so a tap would light a layer up and keep it lit
    // with nothing on screen explaining why.
    if (event.pointerType !== 'mouse') return
    const rect = this.element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    this.inside = true

    // The samples the browser buffered, not just the one it chose to deliver.
    // What it coalesced away is exactly the layer crossings a fast sweep is
    // made of. Older Safari has no such method; the delivered event is then all
    // there is, and the queue below still beats keeping only the last of them.
    const coalesced =
      typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
    const points: readonly { clientX: number; clientY: number; timeStamp: number }[] =
      coalesced.length > 0 ? coalesced : [event]

    for (const point of points) {
      this.push(
        ((point.clientX - rect.left) / rect.width) * 2 - 1,
        -((point.clientY - rect.top) / rect.height) * 2 + 1,
        point.timeStamp,
      )
    }
  }

  private readonly onPointerLeave = (): void => {
    this.inside = false
  }

  constructor(
    private readonly element: HTMLElement,
    sheets: readonly SheetObject[],
  ) {
    this.targets = sheets.map((sheet) => sheet.hitArea)
    for (const sheet of sheets) this.byHitArea.set(sheet.hitArea, sheet)

    element.addEventListener('pointermove', this.onPointerMove, { passive: true })
    element.addEventListener('pointerleave', this.onPointerLeave, { passive: true })
  }

  /** The layer the pointer is over, for whoever handles a click on the stage. */
  get selected(): SheetObject | null {
    return this.hovered
  }

  update(camera: Camera): void {
    const count = this.pending
    this.pending = 0

    if (!this.enabled || !this.inside) {
      this.commit(null, { fromPointer: false, offset: 0, speed: 0 })
      return
    }

    if (count === 0) {
      // The pointer held still; the artwork did not. Re-resolve once and follow
      // wherever the drift put the boundary — but never call that the user's
      // doing. No grace window is needed for that any more: a crossing now
      // belongs to the sample that caused it, so there is no gap between the
      // event and the frame acting on it to paper over.
      this.resolve(camera, this.lastX, this.lastY, { fromPointer: false, offset: 0, speed: 0 })
      return
    }

    const start = (this.head - count + MAX_SAMPLES) % MAX_SAMPLES
    const first = this.samples[start]!.time

    for (let i = 0; i < count; i++) {
      const sample = this.samples[(start + i) % MAX_SAMPLES]!
      const elapsed = (sample.time - this.lastTime) / 1000
      // The very first sample of a session has nothing to measure against, and
      // a re-entry after a long pause would read as a teleport at huge speed.
      const speed =
        this.lastTime > 0 && elapsed > 0 && elapsed < 0.2
          ? Math.hypot(sample.x - this.lastX, sample.y - this.lastY) / elapsed
          : 0

      this.lastX = sample.x
      this.lastY = sample.y
      this.lastTime = sample.time

      this.resolve(camera, sample.x, sample.y, {
        fromPointer: true,
        offset: Math.max(sample.time - first, 0) / 1000,
        speed,
      })
    }
  }

  dispose(): void {
    this.element.removeEventListener('pointermove', this.onPointerMove)
    this.element.removeEventListener('pointerleave', this.onPointerLeave)
  }

  private push(x: number, y: number, time: number): void {
    const slot = this.samples[this.head]!
    slot.x = x
    slot.y = y
    slot.time = time
    this.head = (this.head + 1) % MAX_SAMPLES
    this.pending = Math.min(this.pending + 1, MAX_SAMPLES)
  }

  private resolve(camera: Camera, x: number, y: number, change: PickChange): void {
    this.ndc.set(x, y)
    this.raycaster.setFromCamera(this.ndc, camera)
    // Nearest first, which is what three sorts by, and the nearest plate is
    // the one the pointer is on top of even where several overlap.
    const hit = this.raycaster.intersectObjects(this.targets, false)[0]
    this.commit(hit ? (this.byHitArea.get(hit.object) ?? null) : null, change)
  }

  private commit(layer: SheetObject | null, change: PickChange): void {
    if (layer === this.hovered) return
    this.hovered = layer
    this.onChange?.(layer, change)
  }
}
