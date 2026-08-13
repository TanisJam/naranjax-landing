import {
  Color,
  CustomBlending,
  DataTexture,
  FrontSide,
  Matrix4,
  MeshDepthMaterial,
  MeshPhysicalMaterial,
  OneFactor,
  SRGBColorSpace,
  Vector2,
  Vector4,
  ZeroFactor,
  type IUniform,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import type { SheetShape, SheetSurface } from '../../../domain/types'
import {
  FRAGMENT_AO_CHUNK,
  FRAGMENT_BACKDROP_CHUNK,
  FRAGMENT_COLOR_CHUNK,
  FRAGMENT_EMISSIVE_CHUNK,
  FRAGMENT_NORMAL_CHUNK,
  FRAGMENT_PRELUDE,
  FRAGMENT_ROUGHNESS_CHUNK,
  VERTEX_DEPTH_POSITION_CHUNK,
  VERTEX_NORMAL_CHUNK,
  VERTEX_POSITION_CHUNK,
  VERTEX_PRELUDE,
} from './sheetShader'

/** The captured frame every frosted layer scatters. See `BackdropCapture`. */
export interface BackdropUniforms {
  uBackdrop: IUniform<Texture>
  uBackdropTexel: IUniform<Vector2>
}

/**
 * The stack's occlusion field, held by one owner and read by every layer.
 *
 * Shared by REFERENCE rather than copied: `applySheetShader` merges a layer's
 * uniforms straight into its program, so writing these once per frame reaches
 * all eleven materials with no per-layer bookkeeping. See `StackOcclusion`.
 */
export interface StackOcclusionUniforms {
  /** Per layer: centre.x, centre.z, and the plate's own +X axis in xz. */
  uOccluder: IUniform<Vector4[]>
  /** Per layer: half length, half width, centre.y, how much light it stops. */
  uOccluderExtent: IUniform<Vector4[]>
  uOcclusionStrength: IUniform<number>
  uStackShadow: IUniform<number>
}

/**
 * How wide the frost scatters at full strength, as a fraction of the drawing
 * buffer height.
 *
 * Small in absolute terms and it has to be. What frosting destroys is DETAIL,
 * and the detail in this stack — the print on the far card, the engraving, the
 * weave — is only a few pixels across at this camera distance. A radius wide
 * enough to be obvious as an effect drags whole layers into each other and the
 * stack turns to soup; this one is set where the text behind stops being
 * readable and the colour fields behind barely move at all, which is exactly
 * what a sheet of etched glass does to a page held behind it.
 */
const FROST_MAX_SPREAD = 0.013

/** Every knob the shader exposes. Animation writes straight into these. */
export interface SheetUniforms extends StackOcclusionUniforms, BackdropUniforms {
  /**
   * Mesh space to the ARTWORK's space, where the stack is genuinely stacked
   * along +Y. Rewritten each frame by `StackOcclusion`, which is also the only
   * thing that reads it.
   */
  uStackMatrix: IUniform<Matrix4>
  /** This layer's index, so it can exclude itself from its own occluders. */
  uLayerIndex: IUniform<number>
  uLength: IUniform<number>
  uWidth: IUniform<number>
  uTipScale: IUniform<number>
  uAngleStart: IUniform<number>
  uAngleEnd: IUniform<number>
  uCrownStart: IUniform<number>
  uCrownEnd: IUniform<number>
  uRollStart: IUniform<number>
  uRollEnd: IUniform<number>
  uLift: IUniform<number>
  uBow: IUniform<number>
  uThickness: IUniform<number>
  uCornerRadius: IUniform<number>
  uRibFrequency: IUniform<number>
  uRibAmplitude: IUniform<number>
  uRibPhase: IUniform<number>
  uRibShading: IUniform<number>
  /** Morphs the arc angle. 1 is the designed shape, 0 is a flat plate. */
  uOpen: IUniform<number>
  /** Scales lift and roll together. 0 straightens the sheet out completely. */
  uCurl: IUniform<number>
  /** Where along the sweep the hover bend is centred, in the same 0..1 as `u`. */
  uBendCenter: IUniform<number>
  /**
   * Height of that bend, in the sheet's own units. 0 skips it outright, which
   * is what every layer the pointer is not on is doing at any given moment.
   */
  uBendAmount: IUniform<number>
  uColorA: IUniform<Color>
  uColorB: IUniform<Color>
  uGradient: IUniform<Vector4>
  uDotScale: IUniform<number>
  uDotDepth: IUniform<number>
  uDotContrast: IUniform<number>
  uDotTint: IUniform<Color>
  uRibContrast: IUniform<number>
  uRimColor: IUniform<Color>
  uRimStrength: IUniform<number>
  uRimPower: IUniform<number>
  uBevelGlow: IUniform<number>
  uCoreColor: IUniform<Color>
  uAbsorption: IUniform<number>
  uFrost: IUniform<number>
  uFrostColor: IUniform<Color>
  /** Blur radius, as a fraction of the drawing buffer HEIGHT so it is
   * resolution independent — the same frost at 1x and at 2x. */
  uFrostSpread: IUniform<number>
  uDecalMap: IUniform<Texture>
  /** 0 leaves the computed albedo alone, 1 replaces it with the decal's ink. */
  uDecalInk: IUniform<number>
  /** 0 is a flat print, higher values press the decal into the surface. */
  uDecalRelief: IUniform<number>
}

/**
 * Bound on every layer that carries no decal.
 *
 * All layers share one compiled program, so the sampler is always declared and
 * always has to resolve to something. Guarding it with a define instead would
 * split the program per layer, which is the exact cost `applySheetShader`'s
 * module-scope identity exists to avoid.
 */
const BLANK_DECAL = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
BLANK_DECAL.colorSpace = SRGBColorSpace
BLANK_DECAL.needsUpdate = true

interface SheetMaterialUserData {
  sheetUniforms: SheetUniforms
}

/**
 * The same shape, evaluated for the shadow pass.
 *
 * Three renders shadows with its own shared `MeshDepthMaterial`, which never
 * sees `onBeforeCompile` — that hook belongs to one material and the depth
 * material is a different one. Since every vertex of this geometry is built in
 * the vertex shader and the `position` attribute is a buffer of zeros, an
 * unpatched depth pass writes the whole plate as a point at the origin: a
 * caster that casts nothing, for the full price of the shadow map.
 *
 * Module scope for the same reason `applySheetShader` is: three derives the
 * program cache key from `onBeforeCompile.toString()`.
 */
function applySheetDepthShader(
  this: MeshDepthMaterial,
  shader: WebGLProgramParametersWithUniforms,
): void {
  const { sheetUniforms } = this.userData as SheetMaterialUserData
  // The same uniform OBJECTS the lit material holds, not copies of their
  // values. Animation writes straight into them, so the plate the shadow is
  // cast from stays the plate that is drawn — including mid-deploy, where the
  // thickness and the pose change every frame.
  Object.assign(shader.uniforms, sheetUniforms)

  shader.vertexShader = shader.vertexShader
    .replace('void main() {', `${VERTEX_PRELUDE}\nvoid main() {`)
    .replace('#include <begin_vertex>', VERTEX_DEPTH_POSITION_CHUNK)
}

/**
 * Depth material for a layer that casts, sharing that layer's uniforms.
 *
 * Built here rather than inside `createSheetMaterial` because whether a layer
 * casts is a property of its PLACEMENT, not of its surface — and only one layer
 * in the stack does. See `castsShadow` in the domain types.
 *
 * Left at three's default `BasicDepthPacking`: the shadow map is read back with
 * whatever packing the renderer's own depth material uses, and a custom
 * material that disagrees decodes to garbage rather than to a shadow.
 */
export function createSheetDepthMaterial(uniforms: SheetUniforms): MeshDepthMaterial {
  const material = new MeshDepthMaterial()
  // The prelude is shared whole, so the occluder arrays are declared here too
  // even though a depth pass never evaluates them — an array with no length
  // does not compile. MeshDepthMaterial carries no defines of its own, unlike
  // the physical material this is the shadow half of.
  material.defines = { SHEET_LAYERS: uniforms.uOccluder.value.length, FROST_TAPS: 10 }
  material.userData = { sheetUniforms: uniforms } satisfies SheetMaterialUserData
  material.onBeforeCompile = applySheetDepthShader
  return material
}

/**
 * Defined once at module scope on purpose: three derives the program cache key
 * from `onBeforeCompile.toString()`, so a shared reference lets all four sheets
 * reuse a single compiled program while keeping their own uniform values.
 */
function applySheetShader(
  this: MeshPhysicalMaterial,
  shader: WebGLProgramParametersWithUniforms,
): void {
  const { sheetUniforms } = this.userData as SheetMaterialUserData
  Object.assign(shader.uniforms, sheetUniforms)

  shader.vertexShader = shader.vertexShader
    .replace('void main() {', `${VERTEX_PRELUDE}\nvoid main() {`)
    .replace('#include <beginnormal_vertex>', VERTEX_NORMAL_CHUNK)
    .replace('#include <begin_vertex>', VERTEX_POSITION_CHUNK)

  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `${FRAGMENT_PRELUDE}\nvoid main() {`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR_CHUNK}`)
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGHNESS_CHUNK}`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL_CHUNK}`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n${FRAGMENT_EMISSIVE_CHUNK}`,
    )
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FRAGMENT_AO_CHUNK}`)
    .replace(
      '#include <colorspace_fragment>',
      `#include <colorspace_fragment>\n${FRAGMENT_BACKDROP_CHUNK}`,
    )
}

export function createSheetMaterial(
  shape: SheetShape,
  surface: SheetSurface,
  decalMap: Texture | null,
  occlusion: StackOcclusionUniforms,
  backdrop: BackdropUniforms,
  layerIndex: number,
): { material: MeshPhysicalMaterial; uniforms: SheetUniforms } {
  const uniforms: SheetUniforms = {
    // Spread, so every layer holds the SAME uniform objects the owner writes.
    ...occlusion,
    ...backdrop,
    uStackMatrix: { value: new Matrix4() },
    uLayerIndex: { value: layerIndex },
    uLength: { value: shape.length },
    uWidth: { value: shape.width },
    uTipScale: { value: shape.tipScale },
    uAngleStart: { value: shape.angleStart },
    uAngleEnd: { value: shape.angleEnd },
    uCrownStart: { value: shape.crownStart },
    uCrownEnd: { value: shape.crownEnd },
    uRollStart: { value: shape.rollStart },
    uRollEnd: { value: shape.rollEnd },
    uLift: { value: shape.lift },
    uBow: { value: shape.bow },
    uThickness: { value: shape.thickness },
    uCornerRadius: { value: shape.cornerRadius },
    uRibFrequency: { value: shape.ribFrequency },
    uRibAmplitude: { value: shape.ribAmplitude },
    uRibPhase: { value: 0 },
    uRibShading: { value: surface.ribShading },
    uOpen: { value: 1 },
    uCurl: { value: 1 },
    uBendCenter: { value: 0.5 },
    uBendAmount: { value: 0 },
    uColorA: { value: new Color(surface.colorA) },
    uColorB: { value: new Color(surface.colorB) },
    uGradient: {
      value: new Vector4(
        surface.gradient.bias,
        surface.gradient.alongSweep,
        surface.gradient.alongArc,
        surface.gradient.alongY,
      ),
    },
    uDotScale: { value: surface.dotScale },
    uDotDepth: { value: surface.dotDepth },
    uDotContrast: { value: surface.dotContrast },
    uDotTint: { value: new Color(surface.dotTint) },
    uRibContrast: { value: surface.ribContrast },
    uRimColor: { value: new Color(surface.rimColor) },
    uRimStrength: { value: surface.rimStrength },
    uRimPower: { value: surface.rimPower },
    uBevelGlow: { value: surface.bevelGlow },
    uCoreColor: { value: new Color(surface.coreColor) },
    uAbsorption: { value: surface.absorption },
    uFrost: { value: surface.frost },
    uFrostColor: { value: new Color(surface.frostColor) },
    // Zero on a layer that does not frost its backdrop, which is also what
    // switches the composite off — see the branch in FRAGMENT_BACKDROP_CHUNK.
    uFrostSpread: { value: surface.frostsBackdrop ? surface.frost * FROST_MAX_SPREAD : 0 },
    uDecalMap: { value: decalMap ?? BLANK_DECAL },
    uDecalInk: { value: decalMap ? surface.decalInk : 0 },
    uDecalRelief: { value: decalMap ? surface.decalRelief : 0 },
  }

  const material = new MeshPhysicalMaterial({
    // White, because the gradient multiplies into diffuseColor in the shader.
    color: 0xffffff,
    roughness: surface.roughness,
    metalness: surface.metalness,
    clearcoat: surface.clearcoat,
    clearcoatRoughness: surface.clearcoatRoughness,
    iridescence: surface.iridescence,
    iridescenceIOR: 1.3,
    ior: surface.ior,
    transmission: surface.transmission,
    thickness: surface.transmission > 0 ? surface.refractionDepth : 0,
    attenuationColor: new Color(surface.attenuationColor),
    attenuationDistance: surface.attenuationDistance,
    specularIntensity: surface.specularIntensity,
    // The shell is closed, so back faces never need to be drawn.
    side: FrontSide,
    transparent: surface.opacity < 1,
    opacity: surface.opacity,
    // A translucent layer never writes depth. Anything drawn after it that
    // sits behind would be rejected by the depth test rather than blended,
    // and a whole layer would blink out of the stack the moment the draw
    // order changed. Depth writes belong to the opaque layers alone, and they
    // get them for free by being opaque.
    depthWrite: surface.opacity >= 1,
  })

  // A frosted layer has already done the blend itself, in the shader, against a
  // scattered copy of the frame — so the hardware must not do it a second time.
  // `One / Zero` writes the composite straight through. Left on the default and
  // the sharp destination comes back underneath the diffused one, which reads as
  // a ghost of the layer behind rather than as glass.
  if (surface.frostsBackdrop) {
    material.blending = CustomBlending
    material.blendSrc = OneFactor
    material.blendDst = ZeroFactor
    material.blendSrcAlpha = OneFactor
    material.blendDstAlpha = ZeroFactor
    // Still in the transparent queue: that is what honours the back-to-front
    // `renderOrder` the capture depends on, and what keeps these off the
    // early-z sort that would run them nearest-first.
    material.transparent = true
    material.depthWrite = false
  }

  // What replaces those depth writes is back-face culling, which is already on.
  //
  // A sheet still has to occlude ITSELF — you never see a sheet's far wall
  // through its own near face. In the original piece the sheets were curved
  // vaults: from a shallow angle you look straight down a tunnel and the far
  // wall's front faces really are visible, so only a depth write could hide
  // them. These layers are near-flat plates. The far shell's faces point away
  // from the camera and `FrontSide` discards them outright, which is exact
  // rather than order-dependent, and costs a pass that was happening anyway.

  // The occluder arrays need a compile-time length. Identical across every
  // layer, so all eleven still share one compiled program — three folds the
  // defines into the cache key alongside `onBeforeCompile.toString()`.
  //
  // ADDED to what the material already carries, never assigned over it.
  // MeshPhysicalMaterial ships with STANDARD and PHYSICAL defined, and those
  // two gate most of what makes it physical — replacing the object drops them
  // and quietly compiles a different lighting model. It cost real measurement
  // to find, because the result still renders and merely comes out a few
  // luminance points brighter.
  material.defines = {
    ...material.defines,
    SHEET_LAYERS: occlusion.uOccluder.value.length,
    // Enough taps that the spiral reads as a blur rather than as a ring of
    // ghosts, and no more: this runs on seven overlapping full-screen layers,
    // so every tap is paid for seven times over.
    FROST_TAPS: 10,
  }
  material.userData = { sheetUniforms: uniforms } satisfies SheetMaterialUserData
  material.onBeforeCompile = applySheetShader

  return { material, uniforms }
}
