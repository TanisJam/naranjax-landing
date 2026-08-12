import { Raycaster, Vector2, type Camera } from 'three'
import type { SheetObject } from '../infrastructure/three/SheetObject'

/** How long after a pointer move a pick still counts as the user's doing. */
const POINTER_GRACE_FRAMES = 5

/**
 * Which layer the pointer is over.
 *
 * Resolved per frame rather than per pointer event, and that is not a detail:
 * the artwork floats, tilts under the parallax and slides through the whole
 * deploy, so the layer under a perfectly still pointer changes on its own. A
 * hover computed on `pointermove` would be stale the moment the piece moved.
 *
 * Eleven plane intersections is nothing — this is not the cost anyone was
 * worried about.
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
   *
   * `fromPointer` says whether the user caused it. A pick can change under a
   * perfectly still pointer, because the artwork floats and drifts a boundary
   * across it — measured at one or two crossings every three seconds on the
   * layers whose edge happens to sit near the pointer. Following it with the
   * highlight is right; the layer under the pointer really did change. Anything
   * that reads as a response to the USER has to check this first.
   */
  onChange: ((layer: SheetObject | null, fromPointer: boolean) => void) | null = null

  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private inside = false
  /**
   * Frames since the pointer last moved. Five of them is a tenth of a second —
   * long enough to cover the gap between the event and the frame that acts on
   * it, short enough that idle drift never passes for a gesture.
   */
  private framesSinceMoved = Number.MAX_SAFE_INTEGER

  private readonly onPointerMove = (event: PointerEvent): void => {
    // Mouse only. A touch pointer reports a position while the finger is down
    // and then leaves it there, so a tap would light a layer up and keep it lit
    // with nothing on screen explaining why.
    if (event.pointerType !== 'mouse') return
    const rect = this.element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.inside = true
    this.framesSinceMoved = 0
  }

  private readonly onPointerLeave = (): void => {
    this.inside = false
  }

  constructor(
    private readonly element: HTMLElement,
    private readonly sheets: readonly SheetObject[],
  ) {
    element.addEventListener('pointermove', this.onPointerMove, { passive: true })
    element.addEventListener('pointerleave', this.onPointerLeave, { passive: true })
  }

  /** The layer the pointer is over, for whoever handles a click on the stage. */
  get selected(): SheetObject | null {
    return this.hovered
  }

  update(camera: Camera): void {
    const previous = this.hovered
    const fromPointer = this.framesSinceMoved < POINTER_GRACE_FRAMES
    this.framesSinceMoved++

    if (!this.inside || !this.enabled) {
      this.hovered = null
    } else {
      this.raycaster.setFromCamera(this.pointer, camera)
      // Nearest first, which is what three sorts by, and the nearest plate is
      // the one the pointer is on top of even where several overlap.
      const hit = this.raycaster.intersectObjects(
        this.sheets.map((sheet) => sheet.hitArea),
        false,
      )[0]

      this.hovered = hit ? (this.sheets.find((sheet) => sheet.hitArea === hit.object) ?? null) : null
    }

    if (this.hovered !== previous) this.onChange?.(this.hovered, fromPointer)
  }

  dispose(): void {
    this.element.removeEventListener('pointermove', this.onPointerMove)
    this.element.removeEventListener('pointerleave', this.onPointerLeave)
  }
}
