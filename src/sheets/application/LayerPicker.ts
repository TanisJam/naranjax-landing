import { Raycaster, Vector2, type Camera } from 'three'
import type { SheetObject } from '../infrastructure/three/SheetObject'

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

  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private inside = false

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
    if (!this.inside || !this.enabled) {
      this.hovered = null
      return
    }

    this.raycaster.setFromCamera(this.pointer, camera)
    // Nearest first, which is what three sorts by, and the nearest plate is the
    // one the pointer is actually on top of even where several overlap.
    const hit = this.raycaster.intersectObjects(
      this.sheets.map((sheet) => sheet.hitArea),
      false,
    )[0]

    this.hovered = hit ? (this.sheets.find((sheet) => sheet.hitArea === hit.object) ?? null) : null
  }

  dispose(): void {
    this.element.removeEventListener('pointermove', this.onPointerMove)
    this.element.removeEventListener('pointerleave', this.onPointerLeave)
  }
}
