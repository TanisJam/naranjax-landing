import { Clock, Group, Vector3 } from 'three'
import type { Composition } from '../domain/types'
import { BackdropCapture } from '../infrastructure/three/BackdropCapture'
import { SheetObject } from '../infrastructure/three/SheetObject'
import { CAMERA_TARGET, createStage, type Stage } from '../infrastructure/three/stage'
import { AnimationTimeline } from './AnimationTimeline'
import { CameraInspector } from './CameraInspector'
import { FilmGrain } from './FilmGrain'
import { LayerPicker } from './LayerPicker'
import { PointerParallax } from './PointerParallax'
import { ResolutionGovernor } from './ResolutionGovernor'
import { StackOcclusion } from './StackOcclusion'
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
 * How far past the edge of the canvas a layer opened full-frame reaches.
 *
 * A few percent, and it earns them: a layer that merely FITS leaves a hairline
 * of backdrop down one side that the idle float and the pointer parallax then
 * breathe in and out of, which reads as the card not quite having arrived. This
 * is the knob for the crop — `focusZoom` itself is measured and must not be
 * authored over.
 */
const FOCUS_BLEED = 1.04

/**
 * How far along from the camera to its target a layer being read comes to rest,
 * as a fraction of that distance. 1 would leave it in the plane of the stack.
 *
 * It has to clear the stack, and by a real margin rather than a hair. Eleven
 * plates 0.31 apart, tilted, and each 2.36 across reach something over a unit
 * towards the lens from the middle of the fan — so a layer that stopped at the
 * target would be standing among the ones it just left, sorted against them
 * every frame and lit by whatever happened to be in front of it.
 *
 * This is also why `fitFocus` measures at THIS distance and not at the camera
 * target: a plate a third of the way closer to the lens is a third larger on
 * screen before it is scaled at all, and framing it against the wrong plane
 * would overshoot by exactly that much.
 */
const FOCUS_APPROACH = 0.72

/** Scratch for the framing measurement. Reused, never handed out. */
const FOCUS_TRAVEL = new Vector3()

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
  private readonly stackOcclusion: StackOcclusion
  /**
   * Public for the same reason `resolution` is: the capture stride is a cost
   * knob the diagnostics have to be able to move, and its effect is only
   * observable while the piece is running.
   */
  readonly backdrop: BackdropCapture
  private readonly film: FilmGrain

  private readonly parallaxGroup = new Group()
  private readonly floatGroup = new Group()
  // Mode-specific interaction helpers, kept small and read by the swatch-card
  // toggle (parallax enable flag, inspector orbit target).
  readonly parallax: PointerParallax | null
  readonly inspector: CameraInspector | null
  /** Which layer the pointer is on. Public: a click handler will want it. */
  readonly picker: LayerPicker

  /**
   * Called after every rendered frame with how long that frame's own work took,
   * in milliseconds. Null unless something is measuring.
   *
   * The measurement is deliberately taken from INSIDE the loop rather than left
   * to a caller timing its own `requestAnimationFrame`: this is the only place
   * that can separate the frame's work from the wait before it. What it cannot
   * see is the GPU, which finishes long after `render` returns — see
   * `FrameCounter` for why that gap is the useful part.
   */
  onFrame: ((cpuMs: number) => void) | null = null

  /**
   * Spends resolution to hold the frame rate. Public so a measurement can take
   * the ratio away from it — a governor and a knockout fighting over the same
   * number produce a reading of neither.
   */
  readonly resolution: ResolutionGovernor

  /** The card's long and short sides, in world units. See `fitFocusZoom`. */
  private readonly cardSpan: number
  private readonly cardRise: number

  /** Wall clock of the previous frame, for the governor's interval. */
  private lastFrameAt = 0
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

    // Before the sheets: every material merges the occlusion uniforms into its
    // own program as it is built, so the field has to exist first.
    this.stackOcclusion = new StackOcclusion(composition.sheets)
    this.backdrop = new BackdropCapture()
    this.film = new FilmGrain()

    this.sheets = composition.sheets.map((layer, index) => {
      const sheet = new SheetObject(
        layer,
        this.stackOcclusion.uniforms,
        this.backdrop,
        this.film.uniforms,
        index,
      )
      this.artwork.add(sheet.pivot)
      return sheet
    })

    // The card's own footprint, taken from the widest sheet rather than from a
    // constant: this is what a layer opened full-frame has to be measured
    // against, and the composition is the only thing that knows it.
    this.cardSpan = Math.max(
      ...composition.sheets.map((layer) => layer.shape.length * layer.placement.scale),
    )
    this.cardRise = Math.max(
      ...composition.sheets.map((layer) => layer.shape.width * layer.placement.scale),
    )

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

    // After the inspector branch, which sets its own lower ratio: the ceiling
    // is whatever the piece was authored to ask for on this path, not a
    // constant.
    this.resolution = new ResolutionGovernor(this.stage.renderer.getPixelRatio())

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
    this.backdrop.dispose()
    this.stage.dispose()
  }

  /**
   * Re-reads the container and the renderer's pixel ratio.
   *
   * Public for one reason: the drawing buffer and the backdrop capture have to
   * be sized together — they are matched texel for texel — so anything that
   * changes the pixel ratio from outside cannot just call `setPixelRatio` and
   * walk away. See the knockouts in `diagnostics`.
   */
  refresh(): void {
    this.handleResize()
  }

  /**
   * Changes the size of the canvas without the artwork appearing to move.
   *
   * `apply` is whatever resizes the container — going fullscreen, in practice.
   * What this adds is the compensation, and it is the whole reason opening a
   * layer does not begin with a lurch: a canvas that stops being a narrow column
   * and becomes the viewport changes TWO things about how large the artwork is
   * drawn, and both of them at once.
   *
   * The first is the dolly. `createStage` pulls the camera back when the aspect
   * is narrower than it can frame, so a 38% column is seen from about half again
   * as far away as the full viewport is — let that go and the artwork jumps that
   * much larger between two frames.
   *
   * The second is simply that a taller canvas draws the same world units across
   * more pixels. Both are captured here as one number, because an object's
   * height on screen is its world size over its distance, times the height of
   * the viewport in pixels, and nothing else.
   *
   * The offset is the same idea in two dimensions: the artwork sat in the middle
   * of the column, the column is not in the middle of the viewport, and the gap
   * between those two centres is a pixel distance that has to be spent as world
   * units at the new camera distance.
   *
   * Measured rather than derived from the layout, and deliberately: reading the
   * camera back after the resize means this stays correct if the dolly rule, the
   * fov or the panel's share of the page ever changes. None of those numbers
   * appear here.
   */
  reframe(apply: () => void): void {
    const camera = this.stage.camera
    const before = this.container.getBoundingClientRect()
    const beforeDistance = camera.position.distanceTo(CAMERA_TARGET)

    apply()
    // Synchronously, not on the resize observer: the measurements below have to
    // come from a camera that has already answered the new size, and the
    // observer does not run until the frame is over.
    this.handleResize()

    const after = this.container.getBoundingClientRect()
    const afterDistance = camera.position.distanceTo(CAMERA_TARGET)
    if (before.height === 0 || after.height === 0) return

    this.timeline.framePreserveScale =
      (afterDistance / beforeDistance) * (before.height / after.height)

    // World units per pixel at the plane the camera is aimed at.
    const unitsPerPixel =
      (2 * afterDistance * Math.tan((camera.fov * Math.PI) / 360)) / after.height

    this.timeline.framePreserveOffset
      .set(
        (before.left + before.width / 2 - (after.left + after.width / 2)) * unitsPerPixel,
        // Screen y runs down and world y runs up.
        -(before.top + before.height / 2 - (after.top + after.height / 2)) * unitsPerPixel,
        0,
      )
      // Into world space. The camera is tilted a few degrees off the axes, so a
      // screen-space offset is not a world-space one until it is turned.
      .applyQuaternion(camera.quaternion)
  }

  /** Drops the compensation, once nothing is relying on it any more. */
  clearReframe(): void {
    this.timeline.framePreserveScale = 1
    this.timeline.framePreserveOffset.set(0, 0, 0)
  }

  private handleResize(): void {
    const { clientWidth, clientHeight } = this.container
    if (clientWidth === 0 || clientHeight === 0) return
    this.stage.resize(clientWidth, clientHeight)
    // After the stage, which is what sets the drawing buffer the capture has to
    // match texel for texel.
    this.backdrop.resize(this.stage.renderer)
    // And after the camera, which is what this measures.
    this.fitFocus()
  }

  /**
   * Works out where a layer being read comes to rest, and how large it has to
   * be there to span the canvas.
   *
   * Re-measured on every resize rather than authored once, because the camera
   * dollies back whenever the canvas is narrower than it can frame — so the
   * size that fills a 38% column, the size that fills a laptop viewport and the
   * size that fills a phone held upright are three different numbers. A
   * constant would be right on exactly one screen.
   *
   * Contained rather than covered: the SMALLER of the two ratios. On a viewport
   * shaped roughly like a card, which is what a laptop is, the two agree to
   * within a couple of percent and the card fills everything. On a phone held
   * upright they do not, and the choice is between showing the whole card and
   * showing a band across the middle of it — and the card is the thing that was
   * asked for.
   */
  private fitFocus(): void {
    const camera = this.stage.camera
    const approach = FOCUS_TRAVEL.copy(CAMERA_TARGET).sub(camera.position)
    const distance = approach.length() * FOCUS_APPROACH

    this.timeline.framePoint
      .copy(camera.position)
      .addScaledVector(approach.normalize(), distance)

    const height = 2 * distance * Math.tan((camera.fov * Math.PI) / 360)
    const width = height * camera.aspect

    this.timeline.focusZoom =
      Math.min(width / this.cardSpan, height / this.cardRise) * FOCUS_BLEED
  }

  private readonly loop = (): void => {
    if (!this.running) return
    this.frameHandle = requestAnimationFrame(this.loop)

    // Requested before the work and read after it, so the reading covers this
    // frame's own cost and not the idle that preceded it.
    const started = this.onFrame ? performance.now() : 0

    // Clamped so a backgrounded tab does not fast-forward the whole intro.
    const delta = Math.min(this.clock.getDelta(), 1 / 30)
    // Picked against last frame's transforms, which is a frame of lag on a
    // highlight that damps in over several — the alternative is raycasting
    // after the motion is written and paying for a second matrix update.
    this.picker.update(this.stage.camera)
    this.timeline.hovered = this.picker.hovered
    this.timeline.hoveredAt = this.picker.hoveredAt
    this.timeline.hoverPush = this.picker.hoveredPush
    this.timeline.update(delta)
    this.parallax?.update(delta)
    this.inspector?.update()
    // After the timeline, which is what decides — and releases — the layer
    // being read. Ahead of the draw, which is what the order is for.
    this.stackOrder.focused = this.timeline.focused
    this.stackOrder.update(this.stage.camera)
    // After every source of motion and before the draw: what a layer is under
    // has to be answered for the frame being rendered, not the one before it.
    this.stackOcclusion.update(this.artwork, this.sheets, this.stage.keyLight)
    // Advanced on elapsed time rather than per frame — the grain is an exposure,
    // not a redraw. See `SHUTTER_HZ`.
    this.film.update(delta)
    // Before the draw, never after: the capture stride counts layers within a
    // frame, so it has to start from zero on the frame it is counting.
    this.backdrop.beginFrame()
    this.stage.renderer.render(this.stage.scene, this.stage.camera)

    // After the draw, so the interval spans a whole frame including whatever
    // the GPU was still finishing when the last one returned. That lag is the
    // point: it is the only place the cost of the fragment work shows up.
    const now = performance.now()
    const interval = this.lastFrameAt === 0 ? 0 : now - this.lastFrameAt
    this.lastFrameAt = now
    if (interval > 0) {
      const ratio = this.resolution.update(interval, now)
      if (ratio !== null) {
        this.stage.renderer.setPixelRatio(ratio)
        this.handleResize()
      }
    }

    this.onFrame?.(now - started)
  }
}
