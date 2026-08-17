import { Euler, Quaternion, Vector3, type Group } from 'three'
import {
  clamp,
  damp,
  easeInOutCubic,
  easeInOutCubicT,
  easeOutCubic,
  easeOutCubicT,
  lerp,
} from '../domain/easing'
import type { SheetObject } from '../infrastructure/three/SheetObject'

const TWO_PI = Math.PI * 2

/**
 * Carrier frequencies of the gust mix, in Hz. Mutually irrational ratios keep
 * the sum from ever locking into a beat you could tap your foot to: gusts
 * arrive irregularly, with calm spells between the compound peaks.
 */
const GUST_FREQS = [0.37, 0.83, 1.9] as const
/** Slow carries the weather; the fast term only adds surface texture. */
const GUST_WEIGHTS = [1, 0.6, 0.28] as const
/**
 * Root flex leads tip flex by this phase, so each gust reads as a wave
 * travelling along the sheet instead of a rigid flap.
 */
const TIP_LAG = 0.55
/** Stack propagation: the deep sheet leads the gust, frost answers last. */
const SHEET_PROPAGATION = 2.1

/**
 * Fraction of the deploy each layer trails the one before it by.
 *
 * Small on purpose. Enough that the stack peels rather than jumps, little
 * enough that all eleven layers are still visibly one gesture — past roughly a
 * third it stops reading as a card coming apart and starts reading as eleven
 * separate cards taking turns.
 */
const STAGGER = 0.15

/**
 * A curve and its inverse, one per direction of travel.
 *
 * Opening leads with its speed and settles: the stack is already halfway apart
 * before the eye has caught up, which is what makes it feel snappy rather than
 * merely quick. Closing keeps the symmetric curve — it eases in, and something
 * being put away should not bolt.
 *
 * The inverse is what makes an interrupted transition safe. The two curves
 * disagree about what a given progress means, so a reversal has to re-solve for
 * the progress that reproduces the CURRENT eased value under the new curve.
 * Without that the artwork jumps the moment you click twice in a row.
 */
const DEPLOY_EASE = {
  open: { ease: easeOutCubic, progressFor: easeOutCubicT },
  close: { ease: easeInOutCubic, progressFor: easeInOutCubicT },
} as const

/**
 * How sharply a layer SLIDES under the pointer. It carries the whole plate, so
 * it is allowed to take a moment to get going — that is what reads as mass.
 */
const HOVER_RESPONSE = 14

/**
 * How sharply a layer LIGHTS UP under the pointer.
 *
 * Deliberately not the same number. Light has no mass, and running the rim off
 * the slide's damping was most of why the hover felt slow: the highlight —
 * the part the eye actually times the response by — was still climbing 200ms
 * after the crossing because it was waiting for the plate to finish moving.
 * At 45 it is effectively there in three frames, which is as close to the
 * crossing as a frame loop can put it, while a damp rather than a hard set
 * keeps a fast sweep from strobing.
 */
const HOVER_GLOW_RESPONSE = 45

/**
 * How sharply the plate GIVES WAY under the drag, and how sharply it comes back.
 *
 * Both are fast, and the reason is a measurement rather than a taste. The stack
 * spans roughly 0.6 of NDC across eleven layers, so a sweep at an ordinary
 * speed is over any ONE of them in about 30ms. A response of 11 — which is a
 * perfectly reasonable "loads gradually, like card stock" — reaches a quarter
 * of its target in that window, and a quarter of a subtle displacement is
 * nothing at all. The gesture this answers is a tenth the length of the gesture
 * those numbers were picked for.
 *
 * So the asymmetry that survives is modest, and it is still in the right
 * direction: a spring with almost no internal damping does not ease home, it
 * snaps, so the return stays the quicker of the two. What it must not become is
 * so quick that a jitter in one frame's measured travel strobes the geometry —
 * this is the only thing standing between the pointer's raw velocity and the
 * shape of the plate.
 *
 * The release is not what makes the plate stop when the hand does. The push is
 * already zero on the first frame after that, so this only decides how long the
 * spring takes to unwind once it is no longer being held.
 */
const BEND_LOAD_RESPONSE = 30
const BEND_RELEASE_RESPONSE = 42

// Flex amplitudes at windAmount 1, in radians/units. With the arc radius
// ≈ length / angle ≈ 1, FLEX_TIP_ANGLE sweeps the tip ~0.09 units tangentially.
const FLEX_ROOT_ANGLE = 0.014
const FLEX_TIP_ANGLE = 0.085
const FLEX_ROLL = 0.02
const FLEX_LIFT = 0.03

/**
 * The shape the wind flexes AROUND. Re-captured from the live uniforms on every
 * frame the wind is idle, so tuning-panel edits (or any other writer) become
 * the new rest pose instead of fighting the gusts.
 */
interface WindRestPose {
  angleStart: number
  angleEnd: number
  rollStart: number
  rollEnd: number
  lift: number
}

/**
 * All motion in one place, and all of it expressed as uniform writes or pivot
 * rotations. Nothing here rebuilds geometry, which is exactly why the shape
 * lives in the vertex shader.
 */
export class AnimationTimeline {
  /**
   * Seconds the stack takes to come apart.
   *
   * Reads faster than it sounds. The opening curve spends more than half its
   * travel in the first third of this, so the number is the moment it comes to
   * rest, not the moment it stops feeling fast.
   *
   * Both durations are the length of the cue that scores them, and the page
   * overwrites them with the decoded lengths once the audio is in. These are
   * the fallback for a page with no sound, not a second source of truth — and
   * they are the DECODED length, 0.651s, not the 0.72s the mp3 container
   * claims. The difference is encoder padding and it is not audible.
   */
  deployDuration = 0.651
  /** Seconds it takes to close again. */
  collapseDuration = 0.651
  /**
   * Where the stack wants to be: 0 is a closed card, 1 is fully exploded.
   * Anything in between works too — drive it from scroll if that is ever
   * wanted, the whole timeline only ever reads the eased progress.
   */
  deployTarget = 0
  /**
   * How much closer the closed card sits, giving the expansion a pull-back it
   * would not otherwise have.
   *
   * What bounds it is the panel's width, not its height: the closed card is
   * square to the camera and spans its full 2.36 units across, where the
   * exploded stack gives most of that back to foreshortening. Measured at 1440
   * x 900 the card covers 72% of the panel at 1.0 and 81% here, which is as far
   * as it goes before the margins stop reading as deliberate.
   */
  closedZoom = 1.2
  /** Speed of the travelling shimmer along the ribs. */
  ribDrift = 0.35
  /** Amplitude of the idle open/close breathing. */
  breatheAmount = 0.035
  /** Amplitude of the idle vertical float, in world units. */
  floatAmount = 0.045
  /**
   * The layer under the pointer, or null. Written from outside every frame —
   * whoever owns the picking decides what "under the pointer" means, and the
   * timeline only decides what it looks like.
   */
  hovered: SheetObject | null = null
  /**
   * Where along that layer the pointer is, 0 at the root and 1 at the tip.
   * Written from outside on the same terms as `hovered`, and undamped on
   * purpose: the pointer's position is already continuous, and the layer it
   * belongs to is fading its own bend in from zero, so a jump on a crossing has
   * nothing visible to jump.
   */
  hoveredAt = 0.5
  /**
   * How hard the pointer is pushing that layer's face and which way, -1 into it
   * to +1 out of it. Written from outside every frame, on the same terms as
   * `hovered`, and zero whenever the pointer is not moving.
   *
   * This is the difference between a bend that is a GESTURE and one that is a
   * state. Nothing here holds it up: the moment the hand stops, the number is
   * zero and the plate is on its way back with no timer having to expire.
   */
  hoverPush = 0
  /**
   * How far a hovered layer slides out of the stack, along its own long axis.
   * Zero leaves only the rim highlight, which is what reduced motion wants: the
   * feedback survives, the movement does not.
   */
  hoverSlide = 0.28
  /** Master intensity of the wind flexion: 0 holds the sheets perfectly still. */
  windAmount = 0.5
  /** Rate multiplier on the gust clock. */
  windSpeed = 1
  /** 0 is a steady breeze; 1 is long calms punctuated by hard gusts. */
  windGustiness = 0.7
  /** Peak tip sweep applied this frame — read-only debug readout. */
  windFlex = 0
  /**
   * Deepest bend on any layer this frame, signed — read-only debug readout.
   *
   * Here because "the deformation is invisible" and "the deformation is not
   * happening" look identical on screen and are different bugs, and estimating
   * which one it is from the shape of the code is how an afternoon gets spent.
   * `__sheets.timeline.bendPeak` in DEV answers it in a second.
   *
   * This is the DRIVE, before each layer's material scales it. A stiff cover
   * reporting 1 here and not visibly moving is working correctly.
   */
  bendPeak = 0
  /**
   * Raised by the swatch card while it owns the shape uniforms: the wind then
   * neither writes flexion nor re-samples the rest pose, so flattening the
   * sheets for the card can never pollute the pose the wind returns to on exit.
   */
  windHold = false

  /**
   * The layer being brought up to fill the frame, or null.
   *
   * Written from outside, like `hovered`, and on the same terms: whoever owns
   * the gesture decides WHICH layer is being read, and the timeline only decides
   * what that looks like. Cleared here rather than by the caller, once the
   * return has actually finished — the framing has to have something to unwind
   * from, and a caller that nulls this on the way out would snap the artwork
   * back to the stack in one frame.
   */
  focused: SheetObject | null = null
  /** 0 leaves the layer in the stack, 1 has it filling the frame. */
  focusTarget = 0
  /**
   * Seconds the layer takes to come up out of the stack, and to go back.
   *
   * The page overwrites both with the length of the cue that scores them, the
   * same way the deploy does. These are the fallback for a page with no audio.
   */
  focusDuration = 0.52
  focusReturnDuration = 0.42
  /**
   * How much larger the artwork gets while a layer is being read.
   *
   * DERIVED, not authored — written by `SceneOrchestrator` every time the
   * canvas is measured, and the reason is that no single number could be right
   * twice. The camera dollies back on a narrow canvas, so the growth that fills
   * a laptop viewport is nearly twice the growth that fills a phone held
   * upright. A constant here would fill exactly one screen and crop or
   * letterbox every other one. See `fitFocusZoom`.
   */
  focusZoom = 1
  /**
   * Where a layer being read travels to, in world space.
   *
   * Written by `SceneOrchestrator` beside `focusZoom`, and it is NOT the point
   * the camera is aimed at: it sits well in front of it, between the lens and
   * the stack. That is what lets one layer leave — the stack stays exactly
   * where the deploy put it and the chosen plate comes forward past it, rather
   * than the whole fan being dragged along.
   */
  readonly framePoint = new Vector3()
  /**
   * What the artwork has to be scaled by, and moved by, for a canvas that just
   * changed size to look as though it had not.
   *
   * Opening a layer takes the canvas out of its 38% column and gives it the
   * whole viewport, and that change is violent on its own: the camera stops
   * dollying back the moment the aspect widens past `FIT_ASPECT`, so the artwork
   * would jump about half again as large in a single frame, off to one side, and
   * only then start growing. These two cancel that jump exactly — the framing
   * STARTS from them and travels away, so the first fullscreen frame is
   * pixel-identical to the last column one and every bit of the growth the user
   * asked for is growth they can see.
   *
   * Written by whoever changed the canvas; identity means nothing changed. See
   * `SceneOrchestrator.reframe`, which is the only thing that knows how to
   * measure them.
   *
   * Held at full strength for as long as the canvas is fullscreen, rather than
   * animated away — the stack is not the thing travelling and must go on
   * looking exactly as it did in the column the whole time. They are dropped
   * on release, in the same frame the canvas goes back.
   */
  framePreserveScale = 1
  readonly framePreserveOffset = new Vector3()
  /**
   * The point the compensation scales the artwork ABOUT, in world space.
   *
   * The camera's aim point, written by `SceneOrchestrator` beside the two
   * above, and the reason it has to exist at all is a 29-pixel jump that the
   * scale and the offset together could not remove.
   *
   * `framePreserveScale` applied to `artwork.scale` scales the artwork about
   * its OWN origin, which holds its size exactly right and does nothing for
   * where that origin lands. And the origin is not on the camera's axis: the
   * twist nudges the stack 0.14 off centre and the lens aims a little below it.
   * A point off the axis projects to a pixel distance of itself over the
   * units-per-pixel, so when the distance and the viewport both change that
   * distance is drawn at a different size — the artwork slides toward the axis
   * by everything the two views disagree about.
   *
   * Which is a term with a closed form rather than a fudge. The ratio of the
   * two units-per-pixel IS `framePreserveScale`, so the displacement from the
   * aim point has to be multiplied by exactly the same number the size is —
   * i.e. the whole artwork, origin included, scales about the aim point. What
   * was measured before this existed: 23.5 px across and 16.3 down on a 1440
   * wide laptop, toward the axis in both, which is the sign this predicts.
   *
   * Under the same flat-plate approximation the offset already makes. The stack
   * is three units deep at seven from the lens, so the near and far plates do
   * not agree about their units-per-pixel and no rigid transform can hold both.
   * This holds the middle, which is where the eye is.
   */
  readonly framePreserveAnchor = new Vector3()
  /**
   * Fired once, on the frame the return finishes and the layer is let go.
   *
   * This is the moment — and the only moment — at which the canvas can be given
   * back to its column without anything being seen to move: the artwork has
   * just arrived at the pose the compensation above says looks exactly like the
   * column view. A frame either side of it and the swap is visible.
   */
  onFocusRelease: (() => void) | null = null

  /**
   * How far out of the stack the read layer is this frame, eased, 0 to 1.
   *
   * Read-only, written every frame. Exposed because the DRAW ORDER has to know:
   * a plate that has left the stack must be drawn over it, and a plate that has
   * come back must be drawn inside it, and the moment between those two is not
   * the moment the animation ends. See `StackOrder.focused`.
   */
  focusAmount = 0

  private time = 0
  private windTime = 0
  private deployProgress = 0
  private focusProgress = 0
  /** Scratch for the framing maths. Reused, never handed out. */
  private readonly hinge = new Vector3()
  private readonly anchored = new Vector3()
  private readonly framed = new Vector3()
  private readonly centred = new Vector3()
  private readonly lifted = new Vector3()
  private readonly liftRotation = new Quaternion()
  private readonly artworkInverse = new Quaternion()
  private readonly worldPosition = new Vector3()
  private readonly worldRotation = new Quaternion()
  private readonly worldScale = new Vector3()
  /** Which curve is in force. Starts closed, as if it had just finished closing. */
  private deployDirection: 1 | -1 = -1
  /** Per-layer hover slide, damped so the plate arrives instead of switching. */
  private readonly hoverAmounts: number[]

  /** Per-layer hover highlight. Same target, its own far quicker response. */
  private readonly hoverGlows: number[]

  /**
   * Per-layer bend centre, tracked while the layer is hovered and HELD once it
   * is not.
   *
   * Reading `hoveredAt` straight through would drag a layer's bow after the
   * pointer while that bow is springing back, so leaving a layer would sweep a
   * relaxing bulge across it on the way to the next one. A card released
   * flattens where it was bent. It does not follow your hand out.
   */
  private readonly hoverCenters: number[]

  /** Per-layer bend, signed and sprung. See the two response constants. */
  private readonly bends: number[]
  private readonly restPoses: WindRestPose[]
  /**
   * The authored nudge, which exists to answer the twist: the lower layers
   * swing further left than the upper ones swing right. A closed stack has no
   * twist to answer, so the nudge rides the deploy and the card sits dead
   * centre — which is also what buys the margin the closed zoom needs.
   *
   * A vector rather than the single horizontal number it was, because the
   * layout it compensates can now be turned — see `setLayoutRotation`. What is
   * off centre is a property of the LAYOUT, so when the layout turns about the
   * view axis this has to turn with it or it goes on correcting a direction the
   * stack no longer leans in. Written from outside, by whoever knows the turn.
   */
  readonly centreNudge = new Vector3()
  /**
   * The two orientations, slerped rather than interpolated per Euler axis.
   *
   * The sweep between them is most of a quarter turn on X while Y unwinds, and
   * three angles interpolated independently do not describe a rotation — the
   * artwork would wobble off the shortest path on the way and arrive correct,
   * which is the worst kind of wrong to debug.
   */
  private readonly closedOrientation: Quaternion
  private readonly explodedOrientation: Quaternion

  constructor(
    private readonly sheets: readonly SheetObject[],
    private readonly floatGroup: Group,
    /**
     * Carries the deploy outright — orientation, zoom and centring — and
     * nothing else writes to it.
     */
    private readonly artwork: Group,
    /** Orientation of the closed card, as Euler angles in the artwork's frame. */
    closedPose: readonly [number, number, number],
  ) {
    this.centreNudge.copy(artwork.position)
    this.explodedOrientation = artwork.quaternion.clone()
    this.closedOrientation = new Quaternion().setFromEuler(new Euler(...closedPose))
    this.hoverAmounts = sheets.map(() => 0)
    this.hoverGlows = sheets.map(() => 0)
    this.hoverCenters = sheets.map(() => 0.5)
    this.bends = sheets.map(() => 0)

    // The wind starts out flexing around the authored composition.
    this.restPoses = sheets.map((sheet) => ({
      angleStart: sheet.uniforms.uAngleStart.value,
      angleEnd: sheet.uniforms.uAngleEnd.value,
      rollStart: sheet.uniforms.uRollStart.value,
      rollEnd: sheet.uniforms.uRollEnd.value,
      lift: sheet.uniforms.uLift.value,
    }))
  }

  /** True once the stack is on its way open, not once it has arrived. */
  get deployed(): boolean {
    return this.deployTarget > 0.5
  }

  /** Opens a closed stack, closes an open one. Mid-flight it just reverses. */
  toggleDeploy(): void {
    this.deployTarget = this.deployed ? 0 : 1
  }

  /** Snaps the stack shut with no animation. */
  restart(): void {
    this.deployTarget = 0
    this.deployProgress = 0
    this.deployDirection = -1
  }

  /** The curve currently in force, chosen by which way the stack is travelling. */
  private curve(): (typeof DEPLOY_EASE)['open'] {
    return this.deployDirection > 0 ? DEPLOY_EASE.open : DEPLOY_EASE.close
  }

  /**
   * Advances the framing and returns how far along it is, eased.
   *
   * One curve in both directions, unlike the deploy, and that is what makes a
   * reversal free here: opening and closing agree about what a given progress
   * means, so turning around mid-flight is simply walking back down the same
   * curve. The deploy needs its inverse precisely because its two curves do not
   * agree.
   */
  private focusValue(delta: number): number {
    const direction = Math.sign(this.focusTarget - this.focusProgress)
    if (direction !== 0) {
      const duration = Math.max(
        direction > 0 ? this.focusDuration : this.focusReturnDuration,
        1e-4,
      )
      const stepped = this.focusProgress + (direction * delta) / duration
      this.focusProgress = clamp(
        direction > 0
          ? Math.min(stepped, this.focusTarget)
          : Math.max(stepped, this.focusTarget),
        0,
        1,
      )
    }

    if (this.focusProgress === 0) {
      const released = this.focused
      this.focused = null
      if (released) {
        // Put the pivot back exactly, rather than leaving it wherever the last
        // partial frame lerped it to. Its rotation is rewritten every frame by
        // `setFanOpenness` and heals itself; these two are not, so a residue
        // here would survive for the rest of the session.
        released.pivot.position.set(...released.layer.placement.pivot)
        released.pivot.scale.setScalar(1)
        this.onFocusRelease?.()
      }
      return 0
    }
    return easeInOutCubic(this.focusProgress)
  }

  /**
   * Takes ONE layer out of the stack and brings it forward to fill the frame,
   * square to the camera, leaving the other ten exactly where they were.
   *
   * This writes the layer's own PIVOT rather than the artwork, and that is the
   * whole design. Scaling the artwork frames the chosen layer perfectly well —
   * and drags all eleven along with it, so what grows is the stack. A plate
   * being pulled out of a deck is one plate moving against nine that do not,
   * and the only way to say that is to move the one.
   *
   * Three things have to be solved, all of them because the pivot sits UNDER
   * the artwork and inherits everything it does:
   *
   * ORIENTATION. `closedOrientation` is what square-to-camera means, expressed
   * on the artwork. The plate's world orientation is the artwork's turn
   * composed with the pivot's, so the pivot has to carry exactly the part the
   * artwork is not already contributing — hence the inverse.
   *
   * SCALE. The artwork is already drawing the stack at some scale, the canvas
   * compensation included. `focusZoom` is a WORLD size, so the pivot carries
   * the ratio between them and not the figure itself.
   *
   * POSITION. The plate does not sit at its pivot: the carrier is pushed back
   * by the hinge and the mesh sits at its own deployed offset inside that. Put
   * the pivot on the frame point and the plate lands somewhere else entirely —
   * by a whole card's length on the layers with the largest hinge offsets.
   *
   * Everything is written absolutely, never accumulated. `lerpVectors` from the
   * authored hinge rather than `lerp` from wherever the last frame left it: a
   * relative walk would creep to the target over a few seconds no matter what
   * the progress said.
   */
  private liftLayer(sheet: SheetObject, focus: number): void {
    // Against the artwork's WORLD transform, not its local one. Two groups sit
    // above it — the idle float and the pointer parallax — and both turn it. A
    // few degrees of parallax swings a plate resting five units from the lens by
    // about a fifteenth of the frame, which is an edge appearing down one side
    // of a card that is supposed to be filling the screen.
    //
    // Cancelling them also holds the read plate perfectly square and perfectly
    // still, which is what a card held up to be read should be. It does not go
    // dead: the wind still flexes it and the ribs still drift across it, so the
    // life comes from the surface rather than from the frame wandering.
    //
    // A frame behind on both, since the orchestrator writes them after this
    // runs — a hundredth of a degree, and not worth reordering a working loop.
    this.artwork.updateWorldMatrix(true, false)
    this.artwork.matrixWorld.decompose(this.worldPosition, this.worldRotation, this.worldScale)

    const artworkScale = this.worldScale.x
    if (artworkScale === 0) return

    this.artworkInverse.copy(this.worldRotation).invert()
    this.liftRotation.multiplyQuaternions(this.artworkInverse, this.closedOrientation)
    const scale = this.focusZoom / artworkScale

    // The frame point, brought into the artwork's frame — which is where the
    // pivot lives and therefore the only frame the answer can be given in.
    this.framed
      .copy(this.framePoint)
      .sub(this.worldPosition)
      .applyQuaternion(this.artworkInverse)
      .divideScalar(artworkScale)

    // How far the plate sits from its own pivot once it has been turned and
    // grown. Taken off the mesh rather than the pick proxy: the mesh is what is
    // drawn, and it is the thing that has to land in the middle of the screen.
    const [x, y, z] = sheet.layer.placement.pivot
    this.hinge.set(x, y, z)
    this.centred
      .copy(sheet.mesh.position)
      .sub(this.hinge)
      .multiplyScalar(scale)
      .applyQuaternion(this.liftRotation)
    this.lifted.copy(this.framed).sub(this.centred)

    // The rotation is safe to walk from where it is, because `setFanOpenness`
    // rewrites it from the authored fan angle every single frame.
    sheet.pivot.quaternion.slerp(this.liftRotation, focus)
    sheet.pivot.position.lerpVectors(this.hinge, this.lifted, focus)
    sheet.pivot.scale.setScalar(lerp(1, scale, focus))
  }

  /**
   * Composed gust signal in [-1, 1]. `phase` shifts the whole mix in time; each
   * frequency slides a little further than the last, which smears the peaks so
   * no two sheets ever crest into the same shape.
   */
  private gust(phase: number): number {
    let sum = 0
    let norm = 0
    for (let k = 0; k < GUST_FREQS.length; k++) {
      sum += GUST_WEIGHTS[k]! * Math.sin(TWO_PI * GUST_FREQS[k]! * this.windTime - phase * (1 + k * 0.7))
      norm += GUST_WEIGHTS[k]!
    }
    const signal = sum / norm
    // Cubing a normalized signal quiets everything under ~70% strength and lets
    // only the composed peaks through; gustiness picks how stormy that blend is.
    return lerp(signal, signal * signal * signal, this.windGustiness)
  }

  update(delta: number): void {
    this.time += delta
    this.windTime += delta * this.windSpeed

    // Travel at a fixed rate towards the target and ease the RESULT, rather
    // than damping towards it: a damped stack never actually arrives, and a
    // half-open card is exactly the state this piece must not sit in.
    const direction = Math.sign(this.deployTarget - this.deployProgress)
    if (direction !== 0 && direction !== this.deployDirection) {
      // Reversal. Hand the new curve the progress that reproduces the value the
      // old one is showing right now, or the stack jumps on the second click.
      const shown = this.curve().ease(this.deployProgress)
      this.deployDirection = direction > 0 ? 1 : -1
      this.deployProgress = clamp(this.curve().progressFor(shown), 0, 1)
    }

    if (direction !== 0) {
      const duration = Math.max(direction > 0 ? this.deployDuration : this.collapseDuration, 1e-4)
      const stepped = this.deployProgress + (direction * delta) / duration
      this.deployProgress = clamp(
        direction > 0 ? Math.min(stepped, this.deployTarget) : Math.max(stepped, this.deployTarget),
        0,
        1,
      )
    }

    // BEFORE the artwork is written, and the order is load-bearing rather than
    // tidy. The frame this settles at zero is the frame it hands the canvas
    // back to its column, and handing the canvas back is what makes the
    // compensation wrong — it was measured for a viewport that no longer
    // exists. Advance it afterwards and the artwork spends exactly one frame
    // drawn at the fullscreen compensation on a canvas that is already a
    // column: a third too small, off to one side, for 16ms. Which is a blink,
    // and looks like one.
    const focus = this.focusValue(delta)
    this.focusAmount = focus

    const reveal = this.curve().ease(this.deployProgress)
    this.artwork.quaternion.slerpQuaternions(
      this.closedOrientation,
      this.explodedOrientation,
      reveal,
    )
    // The compensation rides at full strength for as long as the canvas is
    // fullscreen. The stack is not what is travelling: it has to go on looking
    // exactly as it did in its column while one of its layers leaves.
    this.artwork.scale.setScalar(lerp(this.closedZoom, 1, reveal) * this.framePreserveScale)
    // The aim point brought into the artwork's own parent frame, which is the
    // only frame the position below can be given in.
    //
    // By subtracting the float alone. Two groups sit above the artwork and both
    // of them TURN it, but a rotation about the origin moves the aim point and
    // the artwork together — it very nearly cancels, because the aim point sits
    // 0.12 from the origin and a few degrees of parallax across 0.12 units is
    // under a pixel. The float's LIFT does not cancel: it slides the artwork
    // bodily off the axis by up to 0.045, which is a few pixels of the term
    // this is correcting, so it is the one that gets taken off.
    //
    // A frame behind, since the float is advanced at the end of this method. At
    // 0.045 amplitude and 0.55 Hz that is 0.0026 units of lag, which is a fifth
    // of a pixel and not worth reordering a working loop for.
    this.anchored.copy(this.framePreserveAnchor).sub(this.floatGroup.position)
    // Set outright rather than assigned per axis: the compensation writes all
    // three, so leaving y and z holding last frame's value would drift.
    //
    // Scaled about the AIM POINT rather than left where the deploy puts it, and
    // that is the difference between a swap nobody sees and one that jumps 29
    // pixels — see `framePreserveAnchor` for the whole of why. At a preserve
    // scale of 1 this collapses to the plain pose exactly, so the term costs
    // nothing and says nothing whenever no canvas has changed size.
    this.artwork.position
      .copy(this.centreNudge)
      .multiplyScalar(reveal)
      .sub(this.anchored)
      .multiplyScalar(this.framePreserveScale)
      .add(this.anchored)
      .add(this.framePreserveOffset)

    const windAmount = this.windAmount

    if (windAmount <= 0 && !this.windHold) {
      // The rest pose is whatever the uniforms happen to hold right now, so a
      // tuning-panel drag (or any other writer) lands as the new rest the
      // instant the wind is not actively overwriting those uniforms.
      for (let i = 0; i < this.sheets.length; i++) {
        const uniforms = this.sheets[i]!.uniforms
        const rest = this.restPoses[i]!
        rest.angleStart = uniforms.uAngleStart.value
        rest.angleEnd = uniforms.uAngleEnd.value
        rest.rollStart = uniforms.uRollStart.value
        rest.rollEnd = uniforms.uRollEnd.value
        rest.lift = uniforms.uLift.value
      }
    }

    this.windFlex = 0
    this.bendPeak = 0

    for (let i = 0; i < this.sheets.length; i++) {
      const sheet = this.sheets[i]!
      const phase = sheet.layer.animationPhase

      // Layers trail each other slightly so the stack peels apart in order
      // instead of snapping open as one block.
      const local = clamp((reveal - phase * STAGGER) / (1 - STAGGER), 0, 1)
      const breathe = 1 + Math.sin(this.time * 0.42 + phase * TWO_PI) * this.breatheAmount

      // Hover is scaled by the deploy, not gated by it: while the stack is
      // closed it is one card, and a single layer of it lighting up under the
      // pointer would be a lie about what the user is looking at.
      const hovered = sheet === this.hovered
      const target = hovered ? 1 : 0
      const hover = damp(this.hoverAmounts[i]!, target, HOVER_RESPONSE, delta)
      const glow = damp(this.hoverGlows[i]!, target, HOVER_GLOW_RESPONSE, delta)
      this.hoverAmounts[i] = hover
      this.hoverGlows[i] = glow
      if (hovered) this.hoverCenters[i] = this.hoveredAt

      // The drag. Gated on `local` rather than `reveal` because this is a shape
      // uniform and the closed card is the strict case: eleven layers sit
      // 0.0019 apart in there, and a bend of any size at all would push one
      // straight through the face of the next.
      //
      // Loading and releasing are told apart by which way the magnitude is
      // going, so a push that reverses partway — the hand turning around
      // mid-sweep — counts as loading the other direction rather than as a
      // release, which is what it is.
      const push = hovered ? this.hoverPush * local : 0
      const bent = this.bends[i]!
      const bend = damp(
        bent,
        push,
        Math.abs(push) > Math.abs(bent) ? BEND_LOAD_RESPONSE : BEND_RELEASE_RESPONSE,
        delta,
      )
      this.bends[i] = bend
      if (Math.abs(bend) > Math.abs(this.bendPeak)) this.bendPeak = bend

      // Position, twist and shape all ride the same number, which is what keeps
      // the layer from arriving somewhere before it has finished unbending. The
      // highlight is the one thing that does not wait for them.
      // Scaled by the deploy for the same reason the slide is: inside a closed
      // card every layer is already flat, so there is nothing to unfold and
      // nothing that may move.
      const flatten = hover * reveal
      // How much this layer is the one being read. Kept apart from `flatten`
      // deliberately: see `folded` below.
      const lift = sheet === this.focused ? focus : 0

      sheet.setPose(
        local,
        flatten,
        // The layer being read carries its own rim, at full strength. It is
        // about to be the only thing on screen, and the highlight is what keeps
        // its edge legible once its neighbours are no longer there to define it.
        clamp(glow * reveal + lift, 0, 1),
        this.hoverSlide,
        this.hoverCenters[i]!,
        bend,
      )
      sheet.setFanOpenness(local * breathe)
      // After the fan angle, which this overrides outright, and after
      // `setPose`, which is what put the mesh at the offset this measures from.
      if (lift > 0) this.liftLayer(sheet, lift)
      // These two are what make a closed stack believable. `uCurl` scales the
      // lift and the roll and `uOpen` scales the arc, so at 0 every crest,
      // twist and bow relaxes into a flat plate — which is the only way eleven
      // layers can lie inside one card without a crest pushing through the face
      // above it. Nothing has to know which layers are folded.
      //
      // The arc has to reach nothing, not merely very little. A closed card is
      // 0.021 units thick and its layers sit 0.0019 apart, while an arc left at
      // even a tenth of its authored angle bows the plate by w·a/8 ≈ 0.015 —
      // eight times the gap it has to stay inside. That is a printed face with
      // a blue film showing through the middle of it. The shader floors the
      // angle at 1e-3 anyway, which bows a layer by 0.0002 and stays put.
      // The hovered layer also RELAXES. Drawing a sheet out of the stack is
      // only half of picking one up; the other half is that it stops holding
      // the shape the stack pressed into it and lies flat in the hand, which is
      // the moment you can actually read what is on it.
      //
      // It costs nothing new to express, because the closed stack already
      // needed a way to flatten every fold at once and these two uniforms are
      // it. `uCurl` takes the lift, the roll and the peel; `uOpen` takes the
      // arc. Nothing here has to know which layers are folded or how — a sheet
      // with a wave, a sheet with a peel and a sheet with neither all go flat
      // through the same number.
      //
      // On the same damping as the slide rather than its own, because they are
      // one gesture. A layer that finished travelling and then unfolded would
      // read as two things happening to it in sequence, and the piece already
      // ties position, twist and shape to a single number for that reason.
      //
      // Multiplying rather than replacing keeps the closed-stack floor below
      // intact: this can only ever make the arc smaller, never larger.
      // The layer being read goes flat as well — a sheet held up to be looked
      // at is not still holding the shape the stack pressed into it. Through
      // the FOLD alone, though, and not through `flatten`: that parameter also
      // hands the plate the hover's slide and lift, and either of those would
      // carry it straight off the centre the framing just put it on.
      const folded = (1 - flatten) * (1 - lift)
      sheet.uniforms.uCurl.value = local * folded
      sheet.uniforms.uOpen.value = local * breathe * folded
      sheet.uniforms.uRibPhase.value = this.time * this.ribDrift + phase * TWO_PI

      // Wind flexion: deltas around the rest pose. The card (`windHold`) owns
      // these uniforms outright; a zeroed amount leaves them exactly as-is.
      if (windAmount <= 0 || this.windHold) continue

      // The wave enters at the deep sheet and answers last on frost; within a
      // sheet the root leads and the tip trails — that differential IS the
      // travelling wave down the blade.
      const lead = phase * SHEET_PROPAGATION
      const gustRoot = this.gust(lead)
      const gustTip = this.gust(lead + TIP_LAG)

      // Flex fades in with each sheet's reveal so folded sheets never twitch.
      const amount = windAmount * local

      const uniforms = sheet.uniforms
      const rest = this.restPoses[i]!
      uniforms.uAngleStart.value = rest.angleStart + gustRoot * FLEX_ROOT_ANGLE * amount
      uniforms.uAngleEnd.value = rest.angleEnd + gustTip * FLEX_TIP_ANGLE * amount
      // Counter-sway: the roll works gently against the sweep, the tip half of
      // the root — the blade twists a touch instead of rotating rigidly.
      uniforms.uRollStart.value = rest.rollStart - gustRoot * FLEX_ROLL * amount
      uniforms.uRollEnd.value = rest.rollEnd - gustTip * FLEX_ROLL * 0.5 * amount
      // Slight vertical bob, riding the average of the wave.
      uniforms.uLift.value = rest.lift + (gustRoot + gustTip) * 0.5 * FLEX_LIFT * amount

      const sweep = Math.abs(gustTip * FLEX_TIP_ANGLE * amount)
      if (sweep > this.windFlex) this.windFlex = sweep
    }

    this.floatGroup.position.y = Math.sin(this.time * 0.55) * this.floatAmount
    this.floatGroup.rotation.z = Math.sin(this.time * 0.4) * 0.012
    this.floatGroup.rotation.x = Math.sin(this.time * 0.31 + 1.2) * 0.02
  }
}
