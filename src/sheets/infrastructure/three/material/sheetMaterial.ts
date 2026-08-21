import {
  Color,
  DataTexture,
  FrontSide,
  Matrix4,
  MeshDepthMaterial,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  Vector2,
  Vector4,
  type IUniform,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import type { SheetShape, SheetSurface, WeavePattern } from '../../../domain/types'
import {
  DEPTH_SHARED_PRELUDE,
  FRAGMENT_AO_CHUNK,
  FRAGMENT_COLOR_CHUNK,
  FRAGMENT_DEPTH_ALPHA_CHUNK,
  FRAGMENT_EMISSIVE_CHUNK,
  FRAGMENT_GRAIN_CHUNK,
  FRAGMENT_HASH_PRELUDE,
  FRAGMENT_NORMAL_CHUNK,
  FRAGMENT_PRELUDE,
  FRAGMENT_ROUGHNESS_CHUNK,
  VERTEX_DEPTH_POSITION_CHUNK,
  VERTEX_NORMAL_CHUNK,
  VERTEX_POSITION_CHUNK,
  VERTEX_PRELUDE,
} from './sheetShader'

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
  /** Lateral shadow travel per unit of height, in the artwork's frame. */
  uShadowDrift: IUniform<Vector2>
  /** Share of the direct light coming from a source small enough to cast. */
  uCastShare: IUniform<number>
}

/**
 * The camera's film, shared by every layer that is exposed onto it.
 *
 * By reference for the same reason the occlusion field is, and with a stronger
 * claim on it: the grain has to be the SAME value at the same pixel in all
 * eleven programs, or a stack of translucent plates would each roll their own
 * noise and the sum would be neither grain nor anything else. See `FilmGrain`.
 */
export interface FilmGrainUniforms {
  /** Peak-to-peak amplitude at mid density, in output units. 0 switches it off. */
  uGrain: IUniform<number>
  /** Reseeds the field; changes at the shutter rate, not at the frame rate. */
  uGrainSeed: IUniform<Vector2>
  /**
   * One over the DRAWING BUFFER's size, in pixels — not the CSS box, which on a
   * 2x display differs by exactly the factor that would misregister the cells.
   *
   * Here because the grain is the only thing that reads it and the grid is
   * locked to the film plane. It was the backdrop capture's uniform until that
   * was removed; `FilmGrain.resize` now measures the same buffer.
   */
  uViewTexel: IUniform<Vector2>
}

/** Every knob the shader exposes. Animation writes straight into these. */
export interface SheetUniforms extends StackOcclusionUniforms, FilmGrainUniforms {
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
  uPeel: IUniform<number>
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
  uWeave: IUniform<number>
  uWeaveScale: IUniform<number>
  uWeaveStretch: IUniform<number>
  uWeaveDepth: IUniform<number>
  uWeaveContrast: IUniform<number>
  uWeaveTint: IUniform<Color>
  uRibContrast: IUniform<number>
  uRimColor: IUniform<Color>
  uRimStrength: IUniform<number>
  uRimPower: IUniform<number>
  uBevelGlow: IUniform<number>
  uCoreColor: IUniform<Color>
  uAbsorption: IUniform<number>
  uImperfection: IUniform<number>
  /**
   * A final multiplier on the plate's alpha, 1 being untouched.
   *
   * The LAST word on how present a sheet is, and it has to be a uniform rather
   * than `material.opacity` for a reason that is visible the moment you try the
   * obvious thing. `material.opacity` is only where alpha STARTS here: the
   * decal drives it back to 1 wherever there is ink, so the two printed covers
   * ignore it completely, and the frost drives it towards 1 across the body of
   * every ply that has any. Setting the material's opacity to fade the stack
   * fades the layers that were already faint and leaves the two solid covers at
   * full strength — which is exactly backwards.
   *
   * See the fade in `AnimationTimeline` for what spends it.
   */
  uQuiet: IUniform<number>
  uFrost: IUniform<number>
  uFrostColor: IUniform<Color>
  /** Blur radius, as a fraction of the drawing buffer HEIGHT so it is
   * resolution independent — the same frost at 1x and at 2x. */
  uDecalMap: IUniform<Texture>
  /**
   * Where the relief is differentiated from. The decal itself on every layer
   * that can spare its alpha for two jobs at once, and a separate drawing on
   * the ones that cannot — see the emboss branch in the normal chunk.
   */
  uDecalHeightMap: IUniform<Texture>
  /** 0 leaves the computed albedo alone, 1 replaces it with the decal's ink. */
  uDecalInk: IUniform<number>
  /** 0 is a flat print, higher values press the decal into the surface. */
  uDecalRelief: IUniform<number>
  /** Central-difference baseline for the emboss. See `SheetSurface.decalReach`. */
  uDecalReach: IUniform<number>
  /** How far the die that pressed the drawing flattened the tooth around it. */
  uPress: IUniform<number>
}

/**
 * The domain's weave names, as the shader's own integers.
 *
 * A hand-written map and not an index into the union, because the two sides are
 * compiled separately and nothing would catch them drifting apart. Written out,
 * `SHEET_WEAVE_*` in `sheetShader.ts` and this table are one edit away from
 * each other and TypeScript makes adding a family here mandatory.
 */
const WEAVE_IDS: Record<WeavePattern, number> = {
  none: 0,
  'micro-dot': 1,
  plain: 2,
  twill: 3,
  herringbone: 4,
  waffle: 5,
  guilloche: 6,
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
    .replace('void main() {', `${DEPTH_SHARED_PRELUDE}\n${VERTEX_PRELUDE}\nvoid main() {`)
    .replace('#include <begin_vertex>', VERTEX_DEPTH_POSITION_CHUNK)

  // `<alphahash_fragment>` is the hook because it is the one place in three's
  // depth shader that runs after `diffuseColor.a` has been set from the
  // material's opacity and before the depth is written — and because nothing
  // here sets `alphaHash`, so the include it replaces is empty.
  //
  // The hash itself is lifted from the lit fragment prelude, which this shader
  // does not receive: the two are injected into different programs.
  shader.fragmentShader = shader.fragmentShader
    .replace(
      'void main() {',
      `${DEPTH_SHARED_PRELUDE}\n${FRAGMENT_HASH_PRELUDE}\nvoid main() {`,
    )
    .replace('#include <alphahash_fragment>', FRAGMENT_DEPTH_ALPHA_CHUNK)
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
export function createSheetDepthMaterial(
  uniforms: SheetUniforms,
  /**
   * How much of the light this plate actually stops. Reaches the shader as
   * `diffuseColor.a` — three's depth fragment assigns it from the material's
   * own opacity, but only under `BasicDepthPacking`, which is the default this
   * material is deliberately left at. Switch the packing and the stochastic
   * discard silently stops discarding.
   */
  opacity: number,
): MeshDepthMaterial {
  const material = new MeshDepthMaterial()
  material.opacity = opacity
  // The prelude is shared whole, so the occluder arrays are declared here too
  // even though a depth pass never evaluates them — an array with no length
  // does not compile. MeshDepthMaterial carries no defines of its own, unlike
  // the physical material this is the shadow half of.
  material.defines = { SHEET_LAYERS: uniforms.uOccluder.value.length }
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
    .replace('void main() {', `${FRAGMENT_HASH_PRELUDE}\n${FRAGMENT_PRELUDE}\nvoid main() {`)
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
    // Grain first, then the frost composite: the capture the frost scatters is
    // already grained, so the two orders differ. See FRAGMENT_GRAIN_CHUNK.
    .replace(
      '#include <colorspace_fragment>',
      `#include <colorspace_fragment>\n${FRAGMENT_GRAIN_CHUNK}`,
    )
}

export function createSheetMaterial(
  shape: SheetShape,
  surface: SheetSurface,
  decalMap: Texture | null,
  reliefMap: Texture | null,
  occlusion: StackOcclusionUniforms,
  grain: FilmGrainUniforms,
  layerIndex: number,
): { material: MeshPhysicalMaterial; uniforms: SheetUniforms } {
  const uniforms: SheetUniforms = {
    // Spread, so every layer holds the SAME uniform objects the owner writes.
    ...occlusion,
    ...grain,
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
    uPeel: { value: shape.peel },
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
    uWeave: { value: surface.weaveScale > 0 ? WEAVE_IDS[surface.weave] : WEAVE_IDS.none },
    uWeaveScale: { value: surface.weaveScale },
    uWeaveStretch: { value: surface.weaveStretch },
    uWeaveDepth: { value: surface.weaveDepth },
    uWeaveContrast: { value: surface.weaveContrast },
    uWeaveTint: { value: new Color(surface.weaveTint) },
    uRibContrast: { value: surface.ribContrast },
    uRimColor: { value: new Color(surface.rimColor) },
    uRimStrength: { value: surface.rimStrength },
    uRimPower: { value: surface.rimPower },
    uBevelGlow: { value: surface.bevelGlow },
    uCoreColor: { value: new Color(surface.coreColor) },
    uAbsorption: { value: surface.absorption },
    uImperfection: { value: surface.imperfection },
    uQuiet: { value: 1 },
    uFrost: { value: surface.frost },
    uFrostColor: { value: new Color(surface.frostColor) },
    uDecalMap: { value: decalMap ?? BLANK_DECAL },
    // Falls back to the decal, which is what every layer authored before this
    // sampler existed already meant by relief. The blank is flat in alpha, so a
    // layer with neither map differentiates to nothing rather than to noise.
    uDecalHeightMap: { value: reliefMap ?? decalMap ?? BLANK_DECAL },
    uDecalInk: { value: decalMap ? surface.decalInk : 0 },
    uDecalRelief: { value: decalMap ? surface.decalRelief : 0 },
    uDecalReach: { value: surface.decalReach },
    uPress: { value: 0 },
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
    // In the transparent queue even at full opacity, and that is what buys the
    // silhouette its antialiasing. edgeCoverage() in the fragment shader writes
    // the outline into alpha, and alpha is only read where there is a blend to
    // read it -- an opaque plate left out of the queue keeps a hard staircase
    // for an edge. The plates that are opaque are the card's own two faces, so
    // that would be the one outline nobody misses.
    //
    // Safe because the draw order here is never inferred from depth: StackOrder
    // writes an explicit renderOrder on every sheet, back to front, and three
    // sorts the transparent queue by that before it looks at anything else. All
    // that changes is that the opaque layers now take their turn in that order
    // instead of going first as a group.
    transparent: true,
    opacity: surface.opacity,
    // A translucent layer never writes depth. Anything drawn after it that
    // sits behind would be rejected by the depth test rather than blended,
    // and a whole layer would blink out of the stack the moment the draw
    // order changed. Depth writes belong to the opaque layers alone, and they
    // get them for free by being opaque.
    depthWrite: surface.opacity >= 1,
  })

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
  }
  material.userData = { sheetUniforms: uniforms } satisfies SheetMaterialUserData
  material.onBeforeCompile = applySheetShader

  return { material, uniforms }
}
