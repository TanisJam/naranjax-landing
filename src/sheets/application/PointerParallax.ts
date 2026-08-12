import type { Group } from 'three'
import { clamp, damp } from '../domain/easing'

/**
 * Pointer-driven tilt, applied to its own group so it never fights the idle
 * motion the timeline writes one level down.
 */
export class PointerParallax {
  strengthX = 0.2
  strengthY = 0.12

  /**
   * Disable to freeze the tilt back to neutral (e.g. while the swatch card is
   * up). The targets are left untouched, so re-enabling resumes from wherever
   * the pointer is.
   */
  enabled = true

  private targetX = 0
  private targetY = 0
  private currentX = 0
  private currentY = 0

  private readonly onPointerMove = (event: PointerEvent): void => {
    const rect = this.element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    this.targetX = clamp((event.clientX - rect.left) / rect.width - 0.5, -0.5, 0.5) * 2
    this.targetY = clamp((event.clientY - rect.top) / rect.height - 0.5, -0.5, 0.5) * 2
  }

  private readonly onPointerLeave = (): void => {
    this.targetX = 0
    this.targetY = 0
  }

  constructor(
    private readonly element: HTMLElement,
    private readonly group: Group,
  ) {
    element.addEventListener('pointermove', this.onPointerMove, { passive: true })
    element.addEventListener('pointerleave', this.onPointerLeave, { passive: true })
  }

  update(delta: number): void {
    const targetX = this.enabled ? this.targetX : 0
    const targetY = this.enabled ? this.targetY : 0
    this.currentX = damp(this.currentX, targetX, 4, delta)
    this.currentY = damp(this.currentY, targetY, 4, delta)
    this.group.rotation.y = this.currentX * this.strengthX
    this.group.rotation.x = this.currentY * this.strengthY
  }

  dispose(): void {
    this.element.removeEventListener('pointermove', this.onPointerMove)
    this.element.removeEventListener('pointerleave', this.onPointerLeave)
  }
}
