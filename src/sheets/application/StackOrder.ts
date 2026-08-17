import { Vector3, type Camera, type Object3D } from 'three'
import type { SheetObject } from '../infrastructure/three/SheetObject'

const stackAxis = new Vector3()
const viewDirection = new Vector3()

/**
 * Draw order for the translucent stack.
 *
 * Three sorts transparent objects by the projected position of the mesh
 * ORIGIN — one point per object. A card is 2.36 x 1.49 units wide and its
 * neighbours sit 0.31 away, so two layers overlap in depth along a given view
 * ray long before their origins say they do, and the derived order flips from
 * one frame to the next as the pointer parallax turns the piece. Every flip
 * changes which layer blends over which, which is what reads as the stack
 * popping.
 *
 * The order does not have to be derived at all. The layers are spread along a
 * single axis and do not interpenetrate, so back-to-front is fully determined
 * by which END of that axis faces the camera — one dot product, not eleven
 * comparisons of an approximation. That makes the order exact and, more to the
 * point, stable: it changes only when the camera genuinely crosses the plane of
 * the stack, and then every layer changes together.
 */
export class StackOrder {
  /**
   * The layer that is OUT IN FRONT of the stack, or null.
   *
   * It draws after every other one, and that is not a preference about which
   * looks better on top — it is the only correct answer. Seven of the eleven
   * layers are translucent and write no depth, so being genuinely in front of
   * them buys nothing: whichever is drawn LAST blends over the other. A plate
   * that has come forward out of the fan and is being read would otherwise be
   * veiled by the films it left behind.
   *
   * Which is why this is not simply "the layer being read". A plate on its way
   * back is being read right up until the animation ends, and it stops being IN
   * FRONT well before that — see `STACK_REENTRY`, which is where the caller
   * lets go of it. Holding it here for the whole return is what produced the
   * complaint this is written against: the card came home, sat visibly on top
   * of the stack it belonged in, and then snapped into place a moment later.
   */
  focused: SheetObject | null = null

  /** 0 until the first update, so the first pass always writes the order. */
  private facing = 0
  /** What `focused` was when the order was last written. See `update`. */
  private ordered: SheetObject | null = null

  constructor(
    private readonly sheets: readonly SheetObject[],
    private readonly artwork: Object3D,
  ) {}

  update(camera: Camera): void {
    // The motion for this frame has already been written to the groups above
    // the artwork but not yet flushed, and the order has to agree with the
    // frame being drawn rather than trail it by one.
    this.artwork.updateWorldMatrix(true, false)

    // Second basis column of the world matrix: the artwork's own +Y in world
    // space, which is the axis the layers are stacked along. Read directly
    // rather than via the quaternion — the deploy zoom scales the artwork
    // uniformly, so normalizing is all that separates this from the axis.
    const basis = this.artwork.matrixWorld.elements
    stackAxis.set(basis[4]!, basis[5]!, basis[6]!).normalize()
    camera.getWorldDirection(viewDirection)

    // Positive means depth grows with height, so the top layer is the far one
    // and index order is already back to front. Negative reverses the stack.
    const facing = stackAxis.dot(viewDirection) >= 0 ? 1 : -1
    // Which layer is being read is the second thing that can change the order,
    // and it has to be checked alongside the facing rather than instead of it:
    // this pass writes every layer, so skipping it would leave the one that was
    // last lifted still drawing over the stack after it went back.
    if (facing === this.facing && this.focused === this.ordered) return
    this.facing = facing
    this.ordered = this.focused

    for (let i = 0; i < this.sheets.length; i++) {
      this.sheets[i]!.mesh.renderOrder = i * facing
    }

    // Clear of the whole range, which runs to ±(length - 1) either way.
    if (this.focused) this.focused.mesh.renderOrder = this.sheets.length
  }
}
