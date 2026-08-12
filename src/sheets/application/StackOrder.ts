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
  /** 0 until the first update, so the first pass always writes the order. */
  private facing = 0

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
    if (facing === this.facing) return
    this.facing = facing

    for (let i = 0; i < this.sheets.length; i++) {
      this.sheets[i]!.mesh.renderOrder = i * facing
    }
  }
}
