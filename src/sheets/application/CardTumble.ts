import type { Group } from 'three'
import { clamp, damp } from '../domain/easing'

const TAU = Math.PI * 2

/**
 * Turns per drag of one canvas height, on either axis.
 *
 * One denominator for both, which is what makes the gesture isotropic: a
 * diagonal drag has to turn the card by the same amount per pixel travelled
 * whichever way it leans, or the card appears to weigh less sideways than it
 * does up and down. Height rather than width for the same reason a wide window
 * does not make a mouse more sensitive — the shorter axis is the one a hand
 * measures a screen by.
 *
 * At 0.75 a drag across the whole canvas is three quarters of a turn, so both
 * faces and both edges are reachable without releasing, and nothing spins away
 * from under a small correction.
 */
const SPEED = 0.75

/**
 * How far the card can be tipped, in radians — 72°.
 *
 * Short of the pole on purpose. Past it the near edge passes overhead and the
 * card comes back inverted, which is a thing you can do to an object you are
 * examining and never a thing you meant to do.
 */
const PITCH_LIMIT = 1.25

/** Damping while the hand is on it, and after it lets go. */
const FOLLOW = 18
const SETTLE = 6

/**
 * Travel, in CSS pixels, past which a contact was a turn rather than a click.
 *
 * The same ten `LayerPicker` uses, and for the same reason: it is a description
 * of a hand holding still, not a threshold anyone tuned.
 */
const TAP_SLOP = 10

/**
 * Drag-to-turn for the closed card.
 *
 * The card ships shut and square to the lens, which says what it is and nothing
 * about what it is MADE of — and the whole piece is eleven laminated plies seen
 * edge-on. So the first gesture is not the click that takes it apart; it is
 * picking the thing up and turning it over.
 *
 * Its own group, above the idle float and below the pointer parallax, and it
 * only ever ROTATES. That is what lets the timeline go on writing the artwork's
 * position in a frame it can still predict — see the aim-point correction
 * there, which cancels a rotation about the origin and does not cancel a
 * translation.
 *
 * Engaged only while the card is shut. Once it comes apart the same drag means
 * something else — riffling the deck, which `LayerPicker` answers — and the
 * fan has a composed orientation that a turned camera would be arguing with.
 */
export class CardTumble {
  private yaw = 0
  private pitch = 0
  private currentYaw = 0
  private currentPitch = 0

  private engagedNow = true
  private pointer = -1
  private lastX = 0
  private lastY = 0
  private travel = 0

  /**
   * Whether the contact that just ended turned the card.
   *
   * For whoever handles the click the browser synthesises on release. A mouse
   * drag and a mouse click are the same three events in the same order, and
   * this is the only thing between them — without it, every turn of the card
   * would end by taking it apart.
   *
   * Cleared on the next contact rather than on release, because the click that
   * has to read it has not arrived yet when the pointer comes up.
   */
  dragged = false

  constructor(
    private readonly element: HTMLElement,
    private readonly group: Group,
  ) {
    // Yaw first, then pitch about the axis the yaw already turned. The default
    // XYZ order tips the card about a fixed axis and the two rotations start
    // fighting as soon as either is large — the card rolls when you asked it to
    // turn. YXZ is the turntable, which is what a thing held in front of you is.
    group.rotation.order = 'YXZ'

    // The card ships shut, so the affordance is true from the first frame. The
    // setter below only fires on a CHANGE, and "engaged" never changes into the
    // state it starts in — without this the cursor first says the card can be
    // picked up at the moment it is being put down.
    this.syncCursor()

    element.addEventListener('pointerdown', this.onPointerDown, { passive: true })
    element.addEventListener('pointermove', this.onPointerMove, { passive: true })
    element.addEventListener('pointerup', this.onPointerRelease, { passive: true })
    element.addEventListener('pointercancel', this.onPointerRelease, { passive: true })
  }

  /** True while a contact is turning the card. */
  get dragging(): boolean {
    return this.pointer !== -1
  }

  /**
   * Whether a drag turns the card at all. False unwinds it back to square by
   * the shortest way — see the wrap in `update`, which is what makes "the
   * shortest way" true however many turns it has been given.
   */
  get engaged(): boolean {
    return this.engagedNow
  }

  set engaged(value: boolean) {
    if (value === this.engagedNow) return
    this.engagedNow = value
    if (!value) {
      this.pointer = -1
      this.yaw = 0
      this.pitch = 0
    }
    this.syncCursor()
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    // Unconditionally, and ahead of the gate: a turn that ended while the card
    // was shut must not go on suppressing clicks after it opens.
    this.dragged = false
    this.travel = 0
    if (!this.engagedNow) return

    this.pointer = event.pointerId
    this.lastX = event.clientX
    this.lastY = event.clientY
    // So the turn survives running off the canvas, which a hand crossing the
    // card sideways does constantly.
    this.element.setPointerCapture(event.pointerId)
    this.syncCursor()
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointer) return

    const rect = this.element.getBoundingClientRect()
    if (rect.height === 0) return

    const dx = event.clientX - this.lastX
    const dy = event.clientY - this.lastY
    this.lastX = event.clientX
    this.lastY = event.clientY

    // Path length rather than net displacement: a hand that turns the card and
    // brings it back is still not a click, however close to home it lands.
    this.travel += Math.hypot(dx, dy)
    if (this.travel > TAP_SLOP) this.dragged = true

    const rate = (TAU * SPEED) / rect.height
    this.yaw += dx * rate
    this.pitch = clamp(this.pitch + dy * rate, -PITCH_LIMIT, PITCH_LIMIT)
  }

  private readonly onPointerRelease = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointer) return
    this.pointer = -1
    this.syncCursor()
  }

  update(delta: number): void {
    // Both angles carried through the same wrap, so the DIFFERENCE between
    // where the card is and where it is going never changes — this is a change
    // of representation and not of pose. What it buys is the unwind: after
    // three turns the same way, `currentYaw` still reads within half a turn of
    // square, so easing it to zero takes the short way home instead of
    // rewinding everything the hand did.
    const wrap = Math.round(this.currentYaw / TAU) * TAU
    if (wrap !== 0) {
      this.currentYaw -= wrap
      this.yaw -= wrap
    }

    const speed = this.dragging ? FOLLOW : SETTLE
    this.currentYaw = damp(this.currentYaw, this.yaw, speed, delta)
    this.currentPitch = damp(this.currentPitch, this.pitch, speed, delta)
    this.group.rotation.y = this.currentYaw
    this.group.rotation.x = this.currentPitch
  }

  private syncCursor(): void {
    if (!this.engagedNow) delete this.element.dataset.grab
    else this.element.dataset.grab = this.dragging ? 'held' : 'free'
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown)
    this.element.removeEventListener('pointermove', this.onPointerMove)
    this.element.removeEventListener('pointerup', this.onPointerRelease)
    this.element.removeEventListener('pointercancel', this.onPointerRelease)
    delete this.element.dataset.grab
  }
}
