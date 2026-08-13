import { Matrix4, Vector4 } from 'three'
import type { Object3D } from 'three'
import type { SheetLayer } from '../domain/types'
import type { StackOcclusionUniforms } from '../infrastructure/three/material/sheetMaterial'
import type { SheetObject } from '../infrastructure/three/SheetObject'

/**
 * How much of the stack's own shadow the direct lights are asked to carry.
 *
 * Not 1, and the reason is structural rather than a matter of taste. Physically
 * a plate lying under another is in that plate's shadow, but the three lights
 * that do the work here — key, rim and bounce — are all `RectAreaLight`, which
 * casts no shadow at any setting. Killing the single directional light in the
 * scene moves the frame by about four luminance points, so shadowing that
 * relied on it alone could never read. This term stands in for the rest.
 *
 * Partial because those lights are LARGE and reach well in from the sides: a
 * plate under another loses its sky, not its light. Taken to 1 the middle of
 * the stack goes near-black, which is what an enclosed volume would do and not
 * what an open fan of plates does.
 */
const STACK_SHADOW = 0.7

/**
 * Global scale on every occluder's contribution.
 *
 * The raw form factor is far too strong to use undamped, and that is a correct
 * result rather than a bug in it: two plates 2.36 across sitting 0.31 apart
 * really do block most of each other's hemisphere, and the honest product over
 * ten of them lands near 5% visibility for a layer in the middle. A stack of
 * plates does not look like that, because it is open at every edge and the
 * layers are translucent — light arrives from the sides and through the film,
 * neither of which a coaxial form factor knows about.
 *
 * So this is the one fitted number in the whole term. Everything else — the
 * coverage, the falloff, the contact hardening, the per-layer weight — is
 * derived from the composition.
 */
const OCCLUSION_STRENGTH = 0.55

const stackMatrix = new Matrix4()
const artworkInverse = new Matrix4()

/**
 * Writes the occlusion field the sheets shade themselves with.
 *
 * The stack had none, and that absence is what made eleven plates read as
 * eleven flat colours rather than as one object taken apart: nothing in the
 * scene was darker for having a neighbour above it. `stackVisibility` in the
 * shader has how a layer consumes this, and why the work is analytic rather
 * than screen-space — seven of the eleven layers are translucent and write no
 * depth, so a depth-buffer pass is blind to most of the occluders.
 *
 * Built from the domain rather than from the sheets, because the sheets need
 * these uniforms to exist before they can be created: every material merges
 * them into its own program at compile time.
 */
export class StackOcclusion {
  readonly uniforms: StackOcclusionUniforms

  /** Half length, half width and light stopped. Fixed once, per layer. */
  private readonly extents: ReadonlyArray<readonly [number, number, number]>

  constructor(layers: readonly SheetLayer[]) {
    this.uniforms = {
      uOccluder: { value: layers.map(() => new Vector4()) },
      uOccluderExtent: { value: layers.map(() => new Vector4()) },
      uOcclusionStrength: { value: OCCLUSION_STRENGTH },
      uStackShadow: { value: STACK_SHADOW },
    }

    this.extents = layers.map(({ shape, placement, surface }) => [
      shape.length * 0.5 * placement.scale,
      shape.width * 0.5 * placement.scale,
      // What the plate stops. Opacity is the honest proxy: a foil at 0.16
      // passes most of the light through and has no business darkening the
      // layer under it the way a printed card does.
      surface.opacity,
    ])
  }

  update(artwork: Object3D, sheets: readonly SheetObject[]): void {
    // Descendants included: the poses being read were written to the meshes
    // this frame and have not been flushed. The renderer would do it later,
    // which is a frame too late for a term the same frame consumes.
    artwork.updateWorldMatrix(true, true)
    artworkInverse.copy(artwork.matrixWorld).invert()

    const occluders = this.uniforms.uOccluder.value
    const extents = this.uniforms.uOccluderExtent.value

    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i]!
      // Into the artwork's frame, where the stack axis is +Y and stays there.
      // The float, the parallax and the resting pose all sit ABOVE the artwork
      // and move every layer together, so none of them can change what a layer
      // is under — and none of them has to be undone here.
      stackMatrix.multiplyMatrices(artworkInverse, sheet.mesh.matrixWorld)
      sheet.uniforms.uStackMatrix.value.copy(stackMatrix)

      const m = stackMatrix.elements
      // First basis column is the plate's own +X. Normalised, because the
      // layers are drawn at a scale slightly under 1 and the shader wants a
      // direction rather than a direction times 0.98.
      const ax = m[0]!
      const az = m[2]!
      const axisLength = Math.hypot(ax, az) || 1

      occluders[i]!.set(m[12]!, m[14]!, ax / axisLength, az / axisLength)

      const [halfLength, halfWidth, weight] = this.extents[i]!
      extents[i]!.set(halfLength, halfWidth, m[13]!, weight)
    }
  }
}
