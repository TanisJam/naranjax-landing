import { Clock, Group } from 'three'
import type { Composition } from '../domain/types'
import { SheetObject } from '../infrastructure/three/SheetObject'
import { createStage, type Stage } from '../infrastructure/three/stage'
import { AnimationTimeline } from './AnimationTimeline'
import { CameraInspector } from './CameraInspector'
import { LayerPicker } from './LayerPicker'
import { PointerParallax } from './PointerParallax'
import { StackOrder } from './StackOrder'

/**
 * Resting orientation of the exploded stack. The X tilt is what matters most:
 * the cards lie flat in their own space, so without it the stack is seen
 * edge-on and every layer collapses to a line. The Z roll is what puts the long
 * axis on the diagonal instead of leaving the stack squared up with the panel.
 */
const EXPLODED_POSE: [number, number, number] = [0.42, -0.62, 0.18]

/**
 * Orientation of the closed card: square to the camera, as a card is when it is
 * handed to you.
 *
 * The X angle is not a round 90°. The camera sits above its target and looks
 * slightly down, so a plate at exactly a quarter turn is square to the world
 * and NOT to the lens; the value is the elevation of the camera as seen from
 * the target, which is what actually puts the print flat on the screen. The Y
 * angle answers the camera's small sideways offset for the same reason.
 */
const CLOSED_POSE: [number, number, number] = [1.489, -0.024, 0]

/**
 * Owns the scene graph and the frame loop. The nesting is deliberate: pointer
 * parallax, idle float and the artwork's resting orientation each get their own
 * group so they can be written independently without stomping each other.
 *
 *   parallax → float → artwork → [sheet pivots]
 */
export class SceneOrchestrator {
  readonly stage: Stage
  readonly sheets: readonly SheetObject[]
  readonly timeline: AnimationTimeline
  readonly artwork: Group
  private readonly stackOrder: StackOrder

  private readonly parallaxGroup = new Group()
  private readonly floatGroup = new Group()
  // Mode-specific interaction helpers, kept small and read by the swatch-card
  // toggle (parallax enable flag, inspector orbit target).
  readonly parallax: PointerParallax | null
  readonly inspector: CameraInspector | null
  /** Which layer the pointer is on. Public: a click handler will want it. */
  readonly picker: LayerPicker
  private readonly clock = new Clock()
  private readonly resizeObserver: ResizeObserver
  private frameHandle = 0
  private running = false

  constructor(
    private readonly container: HTMLElement,
    composition: Composition,
    /**
     * Free camera orbit for examining the materials. Mutually exclusive with
     * the pointer parallax — both claim the same drag.
     */
    inspect = false,
  ) {
    this.stage = createStage(container)

    this.artwork = new Group()
    this.artwork.name = 'artwork'
    this.artwork.rotation.set(...EXPLODED_POSE)
    // The stack is spread symmetrically about its own middle, so only the twist
    // pushes it off centre — the lower layers swing further left than the upper
    // ones swing right, and the nudge back buys equal margins in the panel.
    this.artwork.position.set(0.14, 0, 0)

    this.sheets = composition.sheets.map((layer) => {
      const sheet = new SheetObject(layer)
      this.artwork.add(sheet.pivot)
      return sheet
    })

    this.floatGroup.add(this.artwork)
    this.parallaxGroup.add(this.floatGroup)
    this.stage.scene.add(this.parallaxGroup)

    this.timeline = new AnimationTimeline(this.sheets, this.floatGroup, this.artwork, CLOSED_POSE)
    this.stackOrder = new StackOrder(this.sheets, this.artwork)
    this.picker = new LayerPicker(container, this.sheets)

    if (inspect) {
      this.inspector = new CameraInspector(this.stage.camera, container)
      this.parallax = null
      // Inspection is fill-rate bound: flat slabs seen face-on cover most of the
      // viewport and stack four translucent layers of a heavy PBR shader, so
      // cost scales with pixels, not geometry. Trading resolution for a
      // responsive drag is the right call while studying a surface; the
      // presentation path keeps its full pixel ratio.
      this.stage.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25))
      // Hold the piece still: a surface you are studying should not drift.
      this.timeline.breatheAmount = 0
      this.timeline.floatAmount = 0
      this.timeline.windAmount = 0
    } else {
      this.inspector = null
      this.parallax = new PointerParallax(container, this.parallaxGroup)
    }

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(container)
    this.handleResize()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.clock.start()
    this.loop()
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.frameHandle)
    this.clock.stop()
  }

  dispose(): void {
    this.stop()
    this.resizeObserver.disconnect()
    this.picker.dispose()
    this.parallax?.dispose()
    this.inspector?.dispose()
    for (const sheet of this.sheets) sheet.dispose()
    this.stage.dispose()
  }

  private handleResize(): void {
    const { clientWidth, clientHeight } = this.container
    if (clientWidth === 0 || clientHeight === 0) return
    this.stage.resize(clientWidth, clientHeight)
  }

  private readonly loop = (): void => {
    if (!this.running) return
    this.frameHandle = requestAnimationFrame(this.loop)

    // Clamped so a backgrounded tab does not fast-forward the whole intro.
    const delta = Math.min(this.clock.getDelta(), 1 / 30)
    // Picked against last frame's transforms, which is a frame of lag on a
    // highlight that damps in over several — the alternative is raycasting
    // after the motion is written and paying for a second matrix update.
    this.picker.update(this.stage.camera)
    this.timeline.hovered = this.picker.hovered
    this.timeline.update(delta)
    this.parallax?.update(delta)
    this.inspector?.update()
    this.stackOrder.update(this.stage.camera)
    this.stage.renderer.render(this.stage.scene, this.stage.camera)
  }
}
