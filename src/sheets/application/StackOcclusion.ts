import { Matrix4, Vector2, Vector3, Vector4 } from 'three'
import type { DirectionalLight, Object3D } from 'three'
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
 *
 * Raised from 0.7 because that escape route was narrowed. The whole reason this
 * is not 1 is the width of the panels, and the fill panels have since lost a
 * third of their strength apiece — the share of direct light arriving from a
 * source wide enough to reach in sideways fell from 0.63 to 0.54. Less light
 * getting under a plate means more of the shadow is real, so more of it is the
 * term's to carry.
 *
 * The chain behind this number is softer than the one behind `CAST_SHARE`
 * below, and it is worth saying so: that one is a ratio of measured
 * contributions and this one is a fitted level moved in proportion to them. It
 * is the more likely of the two to want adjusting by eye.
 */
const STACK_SHADOW = 0.78

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
 * So this is a fitted number, alongside `CAST_SHARE` below. Everything else —
 * the coverage, the falloff, the contact hardening, the per-layer weight, the
 * direction shadows fall in — is derived.
 *
 * Raised from 0.55 when the shadow half learned where the light is. An offset
 * shadow does not accumulate the way the symmetric one did: a plate five gaps
 * up throws its darkness clear of the stack instead of stacking onto it, which
 * is correct and cost the frame 7.4 luminance points. This is that level put
 * back, and it lands where the change reads as direction rather than as
 * exposure — 237k pixels darker against 237k brighter.
 */
const OCCLUSION_STRENGTH = 0.72

const stackMatrix = new Matrix4()
const artworkInverse = new Matrix4()
const lightDirection = new Vector3()

/**
 * Floor on how vertical the key has to stay before its shadows stop being
 * projected at all.
 *
 * The drift is the light's lateral direction divided by its vertical one, so a
 * light sinking toward the horizon sends it to infinity and every plate would
 * shadow the whole stack sideways. Clamping the denominator caps the throw
 * instead, which is the same thing a real grazing light does once its shadow
 * runs off the end of what it can land on.
 */
const MIN_LIGHT_ELEVATION = 0.35

/**
 * How much of the direct light comes from a source small enough to throw an
 * edge, as opposed to a panel that is blocked the way sky is.
 *
 * DERIVED, not chosen, and it has to be recomputed every time an intensity in
 * `stage.ts` moves — which is exactly what went wrong once already: the rig was
 * rebalanced and this was left behind, so the frame spent a pass claiming less
 * of its shadow came from a directional source than actually did.
 *
 * A light's contribution is linear in its intensity, so the knockout
 * measurements in `stage.ts` — key 40.76 at 9, rim 10.53 at 5.5, bounce 4.04 at
 * 3.2, directional 7.37 at 1.3 — carry straight to any later rig. At the
 * current one:
 *
 *   key   5.8 -> 26.3      rim  3.4 -> 6.5
 *   spec  5.2 -> 29.5      bounce 1.6 -> 2.0
 *
 * which puts the only source that can throw an edge at 29.5 of a direct total
 * of 64.3. The panels lost a third each and the directional gained, so this
 * came up from the 0.42 the previous rig justified.
 *
 * The extrapolation is not exact — the knockouts were read off a tone-mapped
 * frame, which is not quite linear in the light that produced it — but the
 * error is far under the width of what this controls.
 *
 * It matters which way this leans. At 1 the whole stack is shadowed by one
 * distant source, every plate throws its darkness clear of its neighbours, and
 * the middle of the stack goes flat — measured at 12 luminance points brighter
 * than the symmetric term it replaced. At 0 the shadow has no direction at all,
 * which is where this started.
 */
const CAST_SHARE = 0.46

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
      uShadowDrift: { value: new Vector2() },
      uCastShare: { value: CAST_SHARE },
    }

    this.extents = layers.map(({ shape, placement, surface }) => {
      // What the plate stops. Opacity is the honest proxy: a foil at 0.42
      // passes light through and has no business darkening the layer under it
      // the way a printed card does.
      //
      // Signed, and the sign is the message: NEGATIVE means the renderer is
      // already drawing this plate's shadow into a real shadow map. Such a
      // plate still blocks sky, so it keeps its place in the ambient half —
      // but the shadow half has to skip it, or everything beneath it is
      // darkened twice, once analytically and once for real.
      const stops = placement.castsShadow ? -surface.opacity : surface.opacity
      return [
        shape.length * 0.5 * placement.scale,
        shape.width * 0.5 * placement.scale,
        stops,
      ] as const
    })
  }

  update(artwork: Object3D, sheets: readonly SheetObject[], key: DirectionalLight): void {
    // Descendants included: the poses being read were written to the meshes
    // this frame and have not been flushed. The renderer would do it later,
    // which is a frame too late for a term the same frame consumes.
    artwork.updateWorldMatrix(true, true)
    artworkInverse.copy(artwork.matrixWorld).invert()

    // Which way the key lies, in the artwork's own frame.
    //
    // Rewritten every frame and not once at build: the lights are bolted to the
    // world while the artwork turns under the pointer, floats, and sits at its
    // resting tilt. A shadow direction fixed in the stack's frame would swing
    // with the piece, which is precisely the thing a light does not do.
    //
    // Direction TO the light, since a DirectionalLight is aimed from its
    // position at its target and the target here is the origin. The transform
    // drops translation by construction — only the rotation of the artwork can
    // reach a direction.
    lightDirection
      .copy(key.position)
      .normalize()
      .transformDirection(artworkInverse)

    const elevation = Math.max(Math.abs(lightDirection.y), MIN_LIGHT_ELEVATION)
    this.uniforms.uShadowDrift.value.set(
      lightDirection.x / elevation,
      lightDirection.z / elevation,
    )

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
