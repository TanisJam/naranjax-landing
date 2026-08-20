import { Clock, Euler, Group, Quaternion, Vector3 } from 'three'
import { clamp } from '../domain/easing'
import type { Composition } from '../domain/types'
import { SheetObject } from '../infrastructure/three/SheetObject'
import {
  CAMERA_TARGET,
  createStage,
  FIT_ASPECT,
  SUPERSAMPLE,
  type Stage,
} from '../infrastructure/three/stage'
import { AnimationTimeline } from './AnimationTimeline'
import { CameraInspector } from './CameraInspector'
import { CardTumble } from './CardTumble'
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

/**
 * How far out a layer has to be to count as being IN FRONT of the stack rather
 * than inside it, as a fraction of its travel.
 *
 * The draw order is an integer and cannot be eased, so this is not a question
 * of making the change smooth — it is a question of putting it where it is
 * TRUE, and where the eye is least able to time it.
 *
 * True: the plate travels `1 - FOCUS_APPROACH` of the camera's distance toward
 * the lens, about 2.1 units, and the tilted fan itself reaches something over a
 * unit forward of its middle. So a plate is back among the layers it left at
 * roughly half its travel, not at the end of it — everything after that point
 * is a card being drawn over a deck it is already inside.
 *
 * And least able to time it: `easeInOutCubic` is at its steepest exactly here,
 * so the plate is moving as fast as it moves all return. The old behaviour put
 * the same one-frame change at the other extreme, where the curve arrives with
 * no slope at all and the plate has been sitting still for several frames — the
 * worst possible moment to change anything, and the reason it read as a snap.
 *
 * The fully correct answer is to sort the travelling plate into the stack by
 * its real depth every frame, so each of the five or so layers it passes is
 * crossed at the instant it is actually crossed. That is a bigger change than
 * this one earns: those crossings all happen inside the window this constant
 * already hides, and none of them is the one that was visible.
 */
const STACK_REENTRY = 0.45

/**
 * How far the fan turns per octave of viewport aspect — 55°, in radians, per
 * natural-log unit away from `FIT_ASPECT`.
 *
 * Continuous by construction rather than by a threshold, and the log is why: a
 * viewport twice as wide as another is the same amount wider as one half again
 * as wide is than that, and the eye reads shape ratios that way too. Anchored
 * at `FIT_ASPECT`, so the aspect the fan was composed against turns it by
 * exactly nothing and the authored arrangement is what a square-ish screen
 * still gets.
 *
 * MEASURED, not chosen. A sweep of the projected silhouette against the frame
 * the camera actually gives at each aspect has a clear best turn — the one that
 * draws the card largest — and it runs -26° at 4:3, -41° at 16:9 and -55° at
 * 21:9. This constant is the slope through those, and across every aspect from
 * a tall phone to 32:9 it lands within 1.8% of the largest the stack could have
 * been drawn. At 16:9 it is 35% larger than the composed layout would be.
 *
 * The wide end is worth stating plainly, because it is not what "wide screen →
 * horizontal" would suggest: the law reaches -40° at 16:9, a diagonal, and the
 * fully horizontal fan is a further 50° away. Going there is not a tuning
 * question, it is a loss — a horizontal fan measures over four times as wide as
 * it is tall against a 16:9 frame's 1.78, so it only fits at 42% of the size,
 * and the hero shrinks by more than half to buy the arrangement. The law stops
 * where the card stops growing.
 */
const LAYOUT_TURN_RATE = 0.96

/**
 * Where the turn stops, in radians: -80° and +9°.
 *
 * The wide clamp is a backstop for aspects no display has, and it is the one
 * that would cost something if it were missing — past about -80° the fan lies
 * along the cards' own long axis and the silhouette stops widening, so further
 * turn buys nothing and starts throwing the layers back over each other.
 *
 * The tall clamp is not a backstop, it is the answer. A phone's binding
 * constraint is WIDTH — the camera dollies back to hold the piece, so extra
 * height is free and the frame is 3.52 units across at every tall aspect there
 * is. The best the fan can do is stand a little straighter to narrow itself,
 * and 9° is the whole of what there is to gain; the sweep gives back the same
 * 13% at 9:16 as at 9:19.5, and turning further past it starts losing again.
 */
const LAYOUT_TURN_MIN = -1.396
const LAYOUT_TURN_MAX = 0.157

/**
 * The nudge that answers the twist: the stack is spread symmetrically about its
 * own middle, so only the twist pushes it off centre — the lower layers swing
 * further left than the upper ones swing right, and this buys equal margins.
 *
 * Held as a constant rather than written straight onto the artwork because the
 * layout can be turned, and the nudge has to be re-derived from the composed
 * value on every turn rather than from wherever the last one left it.
 */
const CENTRE_NUDGE = new Vector3(0.14, 0, 0)

/**
 * The resting pose, inverted. Turns a world direction into the frame the sheet
 * offsets are written in.
 *
 * The EXPLODED pose specifically, and not whatever the artwork happens to be
 * holding: the layout is a thing seen spread out, the offsets it turns are
 * weighted by the deploy, and both go to nothing together as the card closes.
 * Anchoring the turn to the orientation the fan is actually read in is what
 * keeps it from depending on when a resize happened to land.
 */
const EXPLODED_FRAME = new Quaternion().setFromEuler(new Euler(...EXPLODED_POSE)).invert()

/**
 * How much of the frame the closed card fills, on whichever axis is tighter.
 *
 * Not a new number: it is what the authored `closedZoom` of 1.2 was WORTH on
 * the panel it was tuned against, recovered rather than re-chosen. A 38% column
 * of a 1440x900 page is 0.61 aspect, which dollies the camera back to frame a
 * 3.52 by 5.78 window, and a card 2.36 across at 1.2 covers 81% of that width —
 * the "as far as it goes before the margins stop reading as deliberate" the old
 * constant's comment names. The intent survives; only its expression moves.
 */
const CLOSED_COVERAGE = 0.81

/**
 * The widest the closed card may be drawn, in CSS pixels.
 *
 * `CLOSED_COVERAGE` is a share of the frame, and a share is the wrong kind of
 * number for the thing it now sits in front of. It was recovered from a 38%
 * column; the canvas is the whole viewport, so on a 1440-wide laptop that share
 * draws the card about 1150 pixels across — which is not a card being handed to
 * you, it is a card the size of a table. The bigger the display, the further it
 * goes, because there is nothing in a percentage that knows how large a card is.
 *
 * So the coverage keeps the small end and this takes the large one, and the two
 * meet without a breakpoint anywhere: a phone frames the card at about 320
 * pixels and never reaches this, a laptop hits it and stops, and a 27-inch
 * display draws exactly the same object as the laptop instead of a poster of
 * it. The cap is the one that reads as a physical size, which is the whole
 * claim a closed card is making.
 *
 * Only the CLOSED state is capped. The click is what asks for the piece at the
 * scale the composition was drawn at, and the growth from here to there is the
 * gesture — it used to be a card the size of the screen becoming a fan the size
 * of the screen, which is a shape change with no arrival in it.
 */
const CLOSED_MAX_WIDTH = 640

/** Scratch for the framing measurement. Reused, never handed out. */
const FOCUS_TRAVEL = new Vector3()

/** Scratch for the layout turn. Reused, never handed out. */
const LAYOUT_AXIS = new Vector3()
const LAYOUT_TURN = new Quaternion()

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
    private readonly film: FilmGrain

  private readonly parallaxGroup = new Group()
  /**
   * Where a drag lands while the card is shut. Between the parallax and the
   * float, and it only turns — see `CardTumble` for why a translating group
   * could not go here.
   */
  private readonly tumbleGroup = new Group()
  private readonly floatGroup = new Group()
  // Mode-specific interaction helpers, kept small and read by the swatch-card
  // toggle (parallax enable flag, inspector orbit target).
  readonly parallax: PointerParallax | null
  readonly inspector: CameraInspector | null
  /**
   * Drag-to-turn for the closed card. Public for the same reason the picker is:
   * the click a turn ends with arrives outside this class, and only this knows
   * whether it was a click at all.
   */
  readonly tumble: CardTumble | null
  /** Which layer the pointer is on. Public: a click handler will want it. */
  readonly picker: LayerPicker

  /**
   * A layer to light up as though the pointer were on it, or null to leave the
   * answer to the pointer.
   *
   * The rail beside the deployed stack is the reason this exists. Its labels
   * are DOM, they sit off the artwork, and a pointer resting on one of them is
   * over no layer at all — so the plate a reader is pointing AT would go dark
   * at the moment they aimed at its name. The override says which plate the
   * page believes is being addressed, and the pointer keeps every other frame.
   *
   * Read once per frame beside the picker rather than written into `hovered`
   * from outside, because the loop overwrites that field on every pass and a
   * value set between two frames would live for less than one.
   */
  hoverOverride: SheetObject | null = null

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
   * Called once per frame with the scene graph already updated, for whatever
   * has to be positioned against where a plate actually ended up.
   *
   * Separate from `onFrame`, which is a measurement and is null whenever
   * nothing is measuring. This one runs in the shipped page.
   */
  onAfterRender: (() => void) | null = null

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
  /**
   * A resize asked for, and the ratio it was asked for at, waiting to be
   * applied at the TOP of a frame rather than wherever it was decided.
   *
   * This is not tidiness, it is the difference between a frame being shown and
   * a frame being thrown away. Sizing the drawing buffer assigns
   * `canvas.width`, and assigning it clears the buffer to transparent black —
   * unconditionally, even when the value does not change, which is what
   * `renderer.setSize` does on every call. The browser composites the canvas at
   * the END of the rendering update, not when `render` returns, so a resize
   * decided AFTER the draw wipes the frame that was about to be presented. With
   * `alpha: true` what shows through is the page behind it. One blank frame,
   * every time the buffer is touched.
   *
   * Both of the things that touch it landed on the wrong side of the draw.
   *
   * The governor decided after `render` because its whole reading is the
   * interval that includes the GPU's tail — see the loop. That has to stay
   * where it is; only the APPLICATION moves.
   *
   * And the `ResizeObserver` was worse, because it looks like it runs between
   * frames and does not: resize observations are delivered after the animation
   * frame callbacks in the same update, before the paint. So the observer fires
   * in the narrow window where the frame is drawn and not yet shown. That is
   * the flicker at load — the container settles over the first few frames and
   * each settle costs one blank one.
   */
  private pendingRatio: number | null = null
  private pendingResize = false
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
    // See `CENTRE_NUDGE`. Read back out of the artwork by the timeline, which
    // is what makes this the composed value the layout turn re-derives from.
    this.artwork.position.copy(CENTRE_NUDGE)

    // Before the sheets: every material merges the occlusion uniforms into its
    // own program as it is built, so the field has to exist first.
    this.stackOcclusion = new StackOcclusion(composition.sheets)
    this.film = new FilmGrain()

    this.sheets = composition.sheets.map((layer, index) => {
      const sheet = new SheetObject(
        layer,
        this.stackOcclusion.uniforms,
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
    this.tumbleGroup.add(this.floatGroup)
    this.parallaxGroup.add(this.tumbleGroup)
    this.stage.scene.add(this.parallaxGroup)

    this.timeline = new AnimationTimeline(this.sheets, this.floatGroup, this.artwork, CLOSED_POSE)
    this.stackOrder = new StackOrder(this.sheets, this.artwork)
    this.picker = new LayerPicker(container, this.sheets)

    if (inspect) {
      this.inspector = new CameraInspector(this.stage.camera, container)
      this.parallax = null
      // Three things cannot share one drag. The orbit is the inspection tool
      // and it takes the camera as well as the pointer, so the two that move
      // the artwork instead both stand down.
      this.tumble = null
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
      this.tumble = new CardTumble(container, this.tumbleGroup)
    }

    // After the inspector branch, which sets its own lower ratio: the ceiling
    // is whatever the piece was authored to ask for on this path, not a
    // constant.
    //
    // STARTS at the authored ratio and may climb to the supersample above it,
    // rather than opening there and walking down. Same reachable quality, and
    // it is the difference between a machine that cannot afford the supersample
    // paying seven seconds to find that out on every visit and never paying at
    // all. Multiplying the CURRENT ratio rather than a constant is what keeps
    // the inspector's own lower setting intact.
    const authoredRatio = this.stage.renderer.getPixelRatio()
    this.resolution = new ResolutionGovernor(authoredRatio * SUPERSAMPLE, 1, authoredRatio)

    // Marked, not applied. See `pendingResize` — the observer runs after this
    // frame's draw and before it is shown, so resizing here discards it.
    this.resizeObserver = new ResizeObserver(() => {
      this.pendingResize = true
    })
    this.resizeObserver.observe(container)
    // Directly, and this one is right where it is: nothing has been drawn yet,
    // so there is no frame to lose, and the first one needs a sized canvas.
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
    this.tumble?.dispose()
    this.inspector?.dispose()
    for (const sheet of this.sheets) sheet.dispose()
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

    // What that scale is applied ABOUT. The aim point, because the artwork is
    // not on it and a point off the axis is drawn at a different distance from
    // the centre once the camera and the viewport have both changed — see
    // `framePreserveAnchor`, which carries the measurement.
    this.timeline.framePreserveAnchor.copy(CAMERA_TARGET)

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

  /**
   * Gives the canvas back: re-measures it, then drops the compensation.
   *
   * Both, here, rather than two calls a caller has to remember to make in
   * order. `handleResize` declines to do anything at all for a container with
   * no size, and a compensation dropped while the camera is still framed for a
   * viewport that is no longer there is not a small error — it is the entire
   * factor, half again the size of the artwork, between two frames. The two
   * cannot come apart if only one of them is reachable.
   *
   * Returns whether the canvas was actually re-measured, since a caller that
   * has just changed the layout may want to know its change did not take.
   */
  clearReframe(): boolean {
    if (!this.handleResize()) return false
    this.timeline.framePreserveScale = 1
    this.timeline.framePreserveOffset.set(0, 0, 0)
    return true
  }

  private handleResize(): boolean {
    const { clientWidth, clientHeight } = this.container
    if (clientWidth === 0 || clientHeight === 0) return false
    this.stage.resize(clientWidth, clientHeight)
    // After the stage, which is what sets the drawing buffer the grain cells
    // have to match texel for texel.
    this.film.resize(this.stage.renderer)
    // And after the camera, which is what all three of these measure.
    this.fitFocus()
    this.fitClosed()
    this.fitLayout()
    return true
  }

  /**
   * How much closer the closed card sits, measured instead of authored.
   *
   * This was a constant of 1.2, and it stopped being right the moment the
   * canvas stopped being a 38% column and became the viewport. The constant is
   * not merely stale: at 1.2 on a 16:9 viewport the closed card covers 44% of
   * the frame while the exploded fan covers 67%, so closing the stack — the
   * gesture whose entire job is to pull the card TOWARD you — draws it a third
   * SMALLER. It inverts itself, and no amount of retuning one number fixes that
   * on every screen at once, because the number that is right for a phone is
   * half the number that is right for a laptop.
   *
   * So it moves here, beside `fitFocus`, and for word for word the same reason
   * that one gives: the camera dollies back whenever the canvas is narrower
   * than it can frame, and a constant would be right on exactly one screen.
   * `CLOSED_COVERAGE` carries what the old constant was worth, so a phone still
   * gets 1.207 — within a thousandth of the 1.2 that was authored for it.
   *
   * Contained rather than covered, the same as `fitFocus`, and the closed card
   * is the case that most needs it: it is square to the camera, so on a wide
   * viewport the height binds and on a narrow one the width does, and covering
   * would run the card off the frame on whichever axis lost.
   *
   * Measured at the camera's own target plane, not at `FOCUS_APPROACH`. A layer
   * being read travels most of the way to the lens; the closed card does not
   * travel at all — it is the stack, shut, where the stack already was.
   */
  private fitClosed(): void {
    const camera = this.stage.camera
    const distance = camera.position.distanceTo(CAMERA_TARGET)
    const height = 2 * distance * Math.tan((camera.fov * Math.PI) / 360)
    const width = height * camera.aspect

    // Pixels per world unit at that same plane, which is the only place the two
    // rules can be compared — one is a share of the frame and the other is a
    // length on the glass, and this is the exchange rate between them.
    const perUnit = this.container.clientWidth / width

    this.timeline.closedZoom = Math.min(
      Math.min(width / this.cardSpan, height / this.cardRise) * CLOSED_COVERAGE,
      CLOSED_MAX_WIDTH / perUnit / this.cardSpan,
    )
  }

  /**
   * Lays the fan down or stands it up to suit the shape of the viewport.
   *
   * The stack spreads along one direction, and which direction that is has been
   * a property of the COMPOSITION until now — fixed, and therefore fitted to
   * exactly one screen shape. It is really a property of the FRAME: a fan of
   * near-horizontal cards spread vertically is the right arrangement for a
   * phone and the wrong one for a laptop, where it leaves half the width empty
   * and pays for it by drawing the card a third smaller than it could be.
   *
   * Continuous, with no threshold anywhere in it. A breakpoint would mean some
   * width at which dragging a window edge one pixel snaps the whole piece into
   * another arrangement, and the arrangement is the composition — see
   * `LAYOUT_TURN_RATE` for the law and for the measurement behind its slope.
   *
   * Only the LAYOUT turns. Every plate keeps the orientation it was composed
   * with, and every offset keeps its depth exactly, because the turn is about
   * the lens axis — `SheetObject.setLayoutRotation` carries why that one choice
   * is what makes the rest of the stack able to ignore this entirely.
   *
   * The axis is read off the camera rather than derived from the offset that
   * placed it, for the same reason `reframe` measures instead of deriving: the
   * dolly rule and the fov can move, and neither of their numbers appears here.
   */
  private fitLayout(): void {
    const camera = this.stage.camera
    const turn = clamp(
      -LAYOUT_TURN_RATE * Math.log(camera.aspect / FIT_ASPECT),
      LAYOUT_TURN_MIN,
      LAYOUT_TURN_MAX,
    )

    // The lens axis, brought into the frame the sheet offsets are written in.
    camera.getWorldDirection(LAYOUT_AXIS).applyQuaternion(EXPLODED_FRAME)
    LAYOUT_TURN.setFromAxisAngle(LAYOUT_AXIS, turn)
    for (const sheet of this.sheets) sheet.setLayoutRotation(LAYOUT_TURN)

    // And the nudge, which is a correction for the layout leaning one way, so
    // it leans with it. The same turn about the same axis — in WORLD space this
    // time, because the artwork's position is written in its parent's frame and
    // not in its own. Turning a rotation through the pose it is expressed in
    // leaves the axis it is about pointing exactly where it pointed, so these
    // two are one rotation seen from two frames rather than two rotations.
    this.timeline.centreNudge
      .copy(CENTRE_NUDGE)
      .applyAxisAngle(camera.getWorldDirection(LAYOUT_AXIS), turn)
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

    // Every change to the drawing buffer, applied here and nowhere else, so it
    // always clears a frame that has not been drawn instead of one that has.
    // See `pendingResize`. Ahead of the timing below on purpose: the
    // reallocation is part of this frame's cost and the governor should see it
    // — it is why `SETTLE_MS` exists.
    if (this.pendingRatio !== null) {
      this.stage.renderer.setPixelRatio(this.pendingRatio)
      this.pendingRatio = null
      // Never `setPixelRatio` alone: the capture is sized to the drawing buffer
      // texel for texel, and the two coming apart misregisters the frost.
      this.pendingResize = true
    }
    if (this.pendingResize) {
      this.pendingResize = false
      this.handleResize()
    }

    // Requested before the work and read after it, so the reading covers this
    // frame's own cost and not the idle that preceded it.
    const started = this.onFrame ? performance.now() : 0

    // Clamped so a backgrounded tab does not fast-forward the whole intro.
    const delta = Math.min(this.clock.getDelta(), 1 / 30)
    // Picked against last frame's transforms, which is a frame of lag on a
    // highlight that damps in over several — the alternative is raycasting
    // after the motion is written and paying for a second matrix update.
    this.picker.update(this.stage.camera)
    // The override wins, and takes the other two with it. A plate lit from the
    // rail is not being touched, so it has no position along its spine and no
    // push: handing it the pointer's leftovers would bend a plate the reader is
    // only naming, using a gesture aimed somewhere else entirely.
    const addressed = this.hoverOverride ?? this.picker.hovered
    this.timeline.hovered = addressed
    this.timeline.hoveredAt = this.hoverOverride ? 0.5 : this.picker.hoveredAt
    this.timeline.hoverPush = this.hoverOverride ? 0 : this.picker.hoveredPush
    this.timeline.update(delta)
    // Before the parallax, which has to know whether this frame's drag is
    // already spoken for. Gated on the TARGET rather than on how far the stack
    // has actually opened: the click is the moment the gesture changes meaning,
    // and a drag begun halfway through the deploy is riffling a deck that is
    // coming apart, not turning a card that no longer exists.
    if (this.tumble) {
      this.tumble.engaged = !this.timeline.deployed
      this.tumble.update(delta)
      if (this.parallax) this.parallax.suppressed = this.tumble.dragging
    }
    this.parallax?.update(delta)
    this.inspector?.update()
    // After the timeline, which is what decides — and releases — the layer
    // being read. Ahead of the draw, which is what the order is for.
    //
    // Gated on how far out the plate actually is, not on whether it is the one
    // being read, and the two part company on the way back. `StackOrder.focused`
    // means IN FRONT OF THE STACK; a plate that has travelled most of the way
    // home is not, and drawing it over the fan until the animation ends is a
    // card sitting on top of the deck it is already inside.
    this.stackOrder.focused =
      this.timeline.focusAmount > STACK_REENTRY ? this.timeline.focused : null
    this.stackOrder.update(this.stage.camera)
    // After every source of motion and before the draw: what a layer is under
    // has to be answered for the frame being rendered, not the one before it.
    this.stackOcclusion.update(this.artwork, this.sheets, this.stage.keyLight)
    // Advanced on elapsed time rather than per frame — the grain is an exposure,
    // not a redraw. See `SHUTTER_HZ`.
    this.film.update(delta)
    this.stage.renderer.render(this.stage.scene, this.stage.camera)

    // AFTER the draw, and that is the whole reason it is here rather than
    // beside the motion above. Anything hanging DOM off a plate has to read
    // that plate's world matrix, and the renderer is what brings the whole
    // graph up to date — before this line the pivots still hold last frame's.
    // Called inside the same animation frame, so the DOM it moves is laid out
    // in the paint that shows the frame it was measured from.
    this.onAfterRender?.()

    // After the draw, so the interval spans a whole frame including whatever
    // the GPU was still finishing when the last one returned. That lag is the
    // point: it is the only place the cost of the fragment work shows up.
    const now = performance.now()
    const interval = this.lastFrameAt === 0 ? 0 : now - this.lastFrameAt
    this.lastFrameAt = now
    if (interval > 0) {
      // Decided here, where the reading is, and applied at the top of the next
      // frame, where it costs nothing to look at. See `pendingRatio`.
      const ratio = this.resolution.update(interval, now)
      if (ratio !== null) this.pendingRatio = ratio
    }

    this.onFrame?.(now - started)
  }
}
