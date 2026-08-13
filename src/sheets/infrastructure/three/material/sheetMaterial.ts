import {
  Color,
  DataTexture,
  FrontSide,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  Vector4,
  type IUniform,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import type { SheetShape, SheetSurface } from '../../../domain/types'
import {
  FRAGMENT_COLOR_CHUNK,
  FRAGMENT_EMISSIVE_CHUNK,
  FRAGMENT_NORMAL_CHUNK,
  FRAGMENT_PRELUDE,
  FRAGMENT_ROUGHNESS_CHUNK,
  VERTEX_NORMAL_CHUNK,
  VERTEX_POSITION_CHUNK,
  VERTEX_PRELUDE,
} from './sheetShader'

/** Every knob the shader exposes. Animation writes straight into these. */
export interface SheetUniforms {
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
}

export function createSheetMaterial(
  shape: SheetShape,
  surface: SheetSurface,
  decalMap: Texture | null,
): { material: MeshPhysicalMaterial; uniforms: SheetUniforms } {
  const uniforms: SheetUniforms = {
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

  // What replaces those depth writes is back-face culling, which is already on.
  //
  // A sheet still has to occlude ITSELF — you never see a sheet's far wall
  // through its own near face. In the original piece the sheets were curved
  // vaults: from a shallow angle you look straight down a tunnel and the far
  // wall's front faces really are visible, so only a depth write could hide
  // them. These layers are near-flat plates. The far shell's faces point away
  // from the camera and `FrontSide` discards them outright, which is exact
  // rather than order-dependent, and costs a pass that was happening anyway.

  material.userData = { sheetUniforms: uniforms } satisfies SheetMaterialUserData
  material.onBeforeCompile = applySheetShader

  return { material, uniforms }
}
