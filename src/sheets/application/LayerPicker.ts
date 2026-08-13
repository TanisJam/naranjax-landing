import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three'
import { clamp } from '../domain/easing'
import type { SheetObject } from '../infrastructure/three/SheetObject'

/**
 * Pointer speed, in NDC units per second, at which the drag pushes a layer as
 * hard as it will ever push it.
 *
 * Set so an ORDINARY sweep saturates, not so a flick does. Measured against the
 * same scale the scrape uses, where 0.6 is the floor at which a crossing stops
 * being a visit, an unhurried move across the stack runs a little over 1. Put
 * the ceiling where the flicks are and every normal gesture lands in the bottom
 * third of the range, which is a deformation nobody ever sees.
 *
 * Everything past this clamps, and that is the finger: it does not press ten
 * times harder because the hand moved ten times faster.
 */
const PUSH_FULL_SPEED = 1.6

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
   * Where along that layer's spine the pointer is, 0 at the root and 1 at the
   * tip. Meaningless while `hovered` is null, and deliberately left holding its
   * last value there rather than reset — whatever answers this is fading out,
   * and snapping the position home on the way would be a visible twitch.
   *
   * This is the one thing here that is NOT an event. `onChange` fires on a
   * crossing, which is where a hover begins; this keeps moving for the whole
   * time the pointer stays on one layer, which is where a hover lives.
   */
  hoveredAt = 0.5

  /**
   * How hard the pointer is pushing the hovered layer's face, and which way.
   * -1 is straight into it, +1 is straight out of it, 0 is not pushing at all.
   *
   * This is a VELOCITY, not a presence. A pointer parked on a layer reports 0,
   * because a finger resting on a card does not bend it — it is the sweep that
   * bends it. Everything about the drag reading as a gesture instead of a state
   * comes from that one fact.
   *
   * The sign is the pointer's travel resolved against the plate's own face
   * normal as the camera sees it. Sweeping down a plate whose face is tilted up
   * toward you presses into it; sweeping the other way drags up it and peels it
   * open. Screen space is the right frame for this and not an approximation of
   * one — a finger on glass moves in the plane of the glass, and the artwork
   * floats and tilts underneath it.
   */
  hoveredPush = 0

  /** Pointer travel, in NDC units per second. Zero on any frame it held still. */
  readonly velocity = new Vector2()

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
  /** Scratch for the hovered plate's face normal. Reused, never handed out. */
  private readonly faceNormal = new Vector3()

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
      this.velocity.set(0, 0)
      this.hoveredPush = 0
      this.commit(null, { fromPointer: false, offset: 0, speed: 0 })
      return
    }

    if (count === 0) {
      // The pointer held still; the artwork did not. Re-resolve once and follow
      // wherever the drift put the boundary — but never call that the user's
      // doing. No grace window is needed for that any more: a crossing now
      // belongs to the sample that caused it, so there is no gap between the
      // event and the frame acting on it to paper over.
      //
      // No samples IS the stop, and it needs no timeout to detect: the pointer
      // that produced nothing this frame is a pointer that did not move, so the
      // push falls to zero on the very first frame after the hand stops. That is
      // what lets the plate spring back the instant the gesture ends.
      this.velocity.set(0, 0)
      this.resolve(camera, this.lastX, this.lastY, { fromPointer: false, offset: 0, speed: 0 })
      this.measurePush(camera)
      return
    }

    const start = (this.head - count + MAX_SAMPLES) % MAX_SAMPLES
    const first = this.samples[start]!.time
    // Where the pointer was when the last frame ended, kept for the net travel
    // below. `lastX/lastY/lastTime` are about to be walked forward.
    const fromX = this.lastX
    const fromY = this.lastY
    const fromTime = this.lastTime

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

    // Net travel across the whole frame, not the last sample pair. The pair is
    // a hundredth of the distance measured over a hundredth of the time, so it
    // carries the same speed with a hundred times the jitter — and the drag is
    // read as a direction, which is exactly what that jitter ruins.
    const span = (this.lastTime - fromTime) / 1000
    if (fromTime > 0 && span > 0 && span < 0.2) {
      this.velocity.set((this.lastX - fromX) / span, (this.lastY - fromY) / span)
    } else {
      this.velocity.set(0, 0)
    }

    this.measurePush(camera)
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
    const layer = hit ? (this.byHitArea.get(hit.object) ?? null) : null

    // Which plate, and where on it. The proxies are planes, so three always
    // hands back a uv; the guard is for the type, not for a case that happens.
    if (layer && hit?.uv) this.hoveredAt = layer.spineParamAt(hit.uv.x)

    this.commit(layer, change)
  }

  /**
   * Resolves this frame's travel against the hovered plate into a signed push.
   *
   * The face normal goes into VIEW space, where its x and y are the direction
   * the plate is facing as drawn on screen — the same plane the pointer lives
   * in, so the two can simply be dotted. A plate seen edge-on has almost no
   * screen normal left and takes almost no push, which is right: there is no
   * face there to press on.
   *
   * The dot is taken in NDC, where x is stretched by the aspect ratio, so a
   * horizontal sweep counts for slightly more than a vertical one of the same
   * on-screen length. On a wide viewport that is a few percent on a quantity
   * that is clamped anyway, and correcting it would mean handing this the
   * viewport for no visible difference.
   */
  private measurePush(camera: Camera): void {
    const layer = this.hovered
    if (!layer) {
      this.hoveredPush = 0
      return
    }

    layer.faceNormal(this.faceNormal).transformDirection(camera.matrixWorldInverse)
    this.hoveredPush = clamp(
      (this.velocity.x * this.faceNormal.x + this.velocity.y * this.faceNormal.y) /
        PUSH_FULL_SPEED,
      -1,
      1,
    )
  }

  private commit(layer: SheetObject | null, change: PickChange): void {
    if (layer === this.hovered) return
    this.hovered = layer
    this.onChange?.(layer, change)
  }
}
