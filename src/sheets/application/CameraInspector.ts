import { Vector3, type PerspectiveCamera } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * Free camera orbit for looking at the materials up close.
 *
 * This is an inspection tool, not part of the piece. It takes over the pointer
 * and the camera, so whenever it is active the pointer parallax and the idle
 * float have to stand down — otherwise two things fight over the same drag and
 * the view drifts under your hands while you are trying to hold still on a
 * surface.
 */
export class CameraInspector {
  private readonly controls: OrbitControls

  constructor(camera: PerspectiveCamera, element: HTMLElement) {
    this.controls = new OrbitControls(camera, element)
    this.controls.target.set(0, 0, 0)
    // Damping makes slow inspection passes readable; without it the camera
    // stops dead on mouse-up and small adjustments feel notchy.
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.rotateSpeed = 0.5
    this.controls.zoomSpeed = 0.8
    this.controls.panSpeed = 0.6
    this.controls.minDistance = 1.2
    this.controls.maxDistance = 30
    this.controls.update()
  }

  /**
   * The point the camera orbits and looks at. Live reference — write it
   * together with the camera position; the next `update()` re-derives the
   * orbit from the pair, so programmed moves keep damping intact.
   */
  get target(): Vector3 {
    return this.controls.target
  }

  update(): void {
    this.controls.update()
  }

  dispose(): void {
    this.controls.dispose()
  }
}
