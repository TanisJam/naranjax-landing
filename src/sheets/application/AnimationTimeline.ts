import { Euler, Quaternion, type Group } from 'three'
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

/** How sharply a layer answers the pointer. High: hover should feel immediate. */
const HOVER_RESPONSE = 14

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
   */
  deployDuration = 0.75
  /** Seconds it takes to close again. */
  collapseDuration = 0.62
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
   * Raised by the swatch card while it owns the shape uniforms: the wind then
   * neither writes flexion nor re-samples the rest pose, so flattening the
   * sheets for the card can never pollute the pose the wind returns to on exit.
   */
  windHold = false

  private time = 0
  private windTime = 0
  private deployProgress = 0
  /** Which curve is in force. Starts closed, as if it had just finished closing. */
  private deployDirection: 1 | -1 = -1
  /** Per-layer hover, damped so the highlight arrives instead of switching. */
  private readonly hoverAmounts: number[]
  private readonly restPoses: WindRestPose[]
  /**
   * The authored horizontal nudge, which exists to answer the twist: the lower
   * layers swing further left than the upper ones swing right. A closed stack
   * has no twist to answer, so the nudge rides the deploy and the card sits
   * dead centre — which is also what buys the margin the closed zoom needs.
   */
  private readonly centreNudge: number
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
    this.centreNudge = artwork.position.x
    this.explodedOrientation = artwork.quaternion.clone()
    this.closedOrientation = new Quaternion().setFromEuler(new Euler(...closedPose))
    this.hoverAmounts = sheets.map(() => 0)

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

    const reveal = this.curve().ease(this.deployProgress)
    this.artwork.quaternion.slerpQuaternions(
      this.closedOrientation,
      this.explodedOrientation,
      reveal,
    )
    this.artwork.scale.setScalar(lerp(this.closedZoom, 1, reveal))
    this.artwork.position.x = this.centreNudge * reveal

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
      const hover = damp(this.hoverAmounts[i]!, sheet === this.hovered ? 1 : 0, HOVER_RESPONSE, delta)
      this.hoverAmounts[i] = hover

      // Position, twist and shape all ride the same number, which is what keeps
      // the layer from arriving somewhere before it has finished unbending.
      sheet.setPose(local, hover * reveal, this.hoverSlide)
      sheet.setFanOpenness(local * breathe)
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
      sheet.uniforms.uCurl.value = local
      sheet.uniforms.uOpen.value = local * breathe
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
