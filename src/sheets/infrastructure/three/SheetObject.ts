import {
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type MeshDepthMaterial,
  type MeshPhysicalMaterial,
  type Texture,
} from 'three'
import { clamp, lerp } from '../../domain/easing'
import type { SheetDecal, SheetLayer } from '../../domain/types'
import { createShellGeometry } from './geometry/shellGeometry'
import { createCardFaceTexture, createCardReliefTexture } from './material/cardFaceTexture'
import { createLayerArtTexture } from './material/layerArtTexture'
import { createLayerMotifTexture } from './material/layerMotifTexture'
import {
  createSheetDepthMaterial,
  createSheetMaterial,
  type FilmGrainUniforms,
  type SheetUniforms,
  type StackOcclusionUniforms,
} from './material/sheetMaterial'

/**
 * The domain names the artwork; this is the only place that knows which
 * painter draws it. Keeping the mapping here is what lets `composition.ts`
 * stay free of Three.js entirely.
 */
function paintDecalTexture(layer: SheetLayer): Texture | null {
  // Artwork outranks the motif, and it is asked first for that reason: a layer
  // that has both is a layer whose brand ships a drawing of the feature, and no
  // motif this file can draw is a better answer than that drawing.
  if (layer.artwork !== undefined) return createLayerArtTexture(layer.artwork)

  switch (layer.decal) {
    case 'none':
      return null
    case 'card-front':
      return createCardFaceTexture('front')
    case 'card-back':
      return createCardFaceTexture('back')
    default:
      return createLayerMotifTexture(layer.decal)
  }
}

/**
 * What two layers have to agree on before they can share one texture.
 *
 * The artwork when there is one, the motif name otherwise — which is exactly
 * the order `paintDecalTexture` decides in, and it has to be, because a key
 * that ignored the artwork would hand the second layer of a shared motif the
 * first one's drawing.
 */
function decalKey(layer: SheetLayer): string {
  return layer.artwork ?? layer.decal
}

/**
 * One texture per kind of artwork, however many layers wear it.
 *
 * Three motifs appear on two plates each, and every plate was painting its own
 * copy — harmless while a decal was 3.5 MB, and no longer so now that the
 * authored art carries four times the texels. The bytes were the reason to look;
 * the reason it is right regardless is that two layers showing the same motif
 * are showing the same motif, and nothing downstream ever wanted them to differ.
 *
 * Refcounted rather than leaked, because `dispose` is a real path — the
 * inspector rebuilds the stack — and a shared texture freed by the first layer
 * to let go of it would take the artwork off the others with it.
 */
interface SharedTexture {
  texture: Texture
  holders: number
}

const DECAL_CACHE = new Map<string, SharedTexture>()

function acquireDecalTexture(layer: SheetLayer): Texture | null {
  const key = decalKey(layer)
  const cached = DECAL_CACHE.get(key)
  if (cached !== undefined) {
    cached.holders += 1
    return cached.texture
  }

  const texture = paintDecalTexture(layer)
  if (texture === null) return null

  DECAL_CACHE.set(key, { texture, holders: 1 })
  return texture
}

function releaseDecalTexture(key: string): void {
  const cached = DECAL_CACHE.get(key)
  if (cached === undefined) return

  cached.holders -= 1
  if (cached.holders > 0) return

  cached.texture.dispose()
  DECAL_CACHE.delete(key)
}

/**
 * The height field a decal cannot supply for itself.
 *
 * Only the printed cards have one. Every other motif in this stack carries its
 * relief in its own alpha, because every other motif leaves some of the sheet
 * unprinted; a card face covers its rect and has no alpha left to vary. Null
 * everywhere else is not a gap — it is the material falling back to the decal,
 * which is where those layers' relief has always come from.
 */
function createDecalRelief(decal: SheetDecal): Texture | null {
  switch (decal) {
    case 'card-front':
      return createCardReliefTexture('front')
    case 'card-back':
      return createCardReliefTexture('back')
    default:
      return null
  }
}

/**
 * What a hovered layer multiplies its rim and bevel glow by.
 *
 * Modest, and it has to be. Those values are already tuned to about a
 * eleventh of what they would be on a single sheet, because eleven translucent
 * plates each firing a fresnel rim sum into the same pixels — a hover gain that
 * looks right on one layer alone blows out its neighbours through it.
 */
const HOVER_RIM_GAIN = 3.2

/**
 * How far the hovered layer rises out of the stack, per unit of slide.
 *
 * A fixed ratio rather than a second knob, because the two together are one
 * direction: out along the sheet and up out of the line of its neighbours. A
 * pure slide reads as the layer being longer than the others; the lift is what
 * says it left the stack. Held well under the 0.31 gap so a raised layer never
 * reaches the one above it.
 */
const HOVER_LIFT_RATIO = 0.25

/**
 * How far the plate gives way under a full-strength drag, per unit of slide.
 *
 * Measured against the slide rather than authored outright, for the same reason
 * the lift is: they are one gesture, and the slide is where its size is set. It
 * also means reduced motion gets this for free — a zeroed slide leaves the rim
 * highlight and takes every displacement with it, this one included.
 *
 * Larger than the lift, which looks backwards for a secondary motion and is
 * not. The lift is a translation and the eye catches a whole plate leaving a
 * row at once; the bend has to bow a surface enough to turn its normal, and a
 * displacement that would be obvious as travel is nothing as curvature.
 *
 * Signed, unlike the lift, so the ceiling is the gap in BOTH directions. At the
 * authored slide of 0.28 the furthest it goes is 0.168, and the worst case is
 * outward where it rides on top of the 0.07 lift: 0.238 against a 0.31 gap.
 */
const DRAG_BEND_RATIO = 0.6

/**
 * How much wider than the plate its pick proxy is.
 *
 * Slightly generous, so the gap between two layers is not a dead band the
 * pointer falls into on the way from one to the next. Named because the bend
 * has to undo it: an overhanging target means a hit at its very edge reports a
 * position just off the end of the sheet it stands for.
 */
const HIT_AREA_MARGIN = 1.04

/**
 * The share of its own tooth a plate keeps while it is being read.
 *
 * See `setReadFocus`. This started at a quarter, which was the wrong instrument
 * used at the wrong strength: taking the tooth off the WHOLE plate to let the
 * drawing read is buying a clean engraving with the plate's material, and the
 * material is half of what the piece is about. What actually clears the bed
 * under the drawing is `READ_PRESS`, locally, so this only has to do the small
 * part it was ever entitled to — a plate turned square to a reading light is
 * calmer across its whole face than one raked at the fan's angle.
 */
const READ_TOOTH = 0.7

/**
 * How completely the die flattens the tooth where it pressed, while reading.
 *
 * Nearly all of it. The cleared bed is the reference the artwork was drawn
 * against — line work standing off a smooth field — and a bed that keeps a
 * tenth of its grain is what makes an engraving read as precise rather than as
 * a shape fighting a grid. Short of 1 so the flattening is a press and not a
 * hole cut in the material.
 */
const READ_PRESS = 0.92

/**
 * Invisible material shared by every hit area. `visible: false` on the MATERIAL
 * and not on the object is the whole trick: three skips an invisible object
 * while raycasting, but an object with an invisible material still tests.
 */
const HIT_AREA_MATERIAL = new MeshBasicMaterial({ visible: false })

/**
 * One sheet, wrapped in the hinge hierarchy that makes the fan animatable.
 *
 *   pivot (positioned at the hinge, this is what rotates)
 *     └── carrier (offset back by -hinge, so the mesh keeps its own origin)
 *           └── mesh
 *
 * Without the pivot/carrier pair the sheets would rotate around their centres
 * and the whole fan motion falls apart. This is the part worth getting right
 * before any animation code exists.
 */
export class SheetObject {
  readonly pivot: Group
  readonly mesh: Mesh
  readonly uniforms: SheetUniforms
  readonly layer: SheetLayer

  /**
   * Public so the tuning panel can drive the PBR fields that live on the
   * material rather than in `uniforms` (roughness, transmission, …).
   */
  readonly material: MeshPhysicalMaterial

  /**
   * Flat stand-in for the plate, used for pointer picking and nothing else.
   *
   * The real mesh cannot be picked at any price: its `position` attribute is a
   * buffer of zeros and the entire shape is built in the vertex shader, so the
   * CPU does not know where a single vertex of it ends up. Three would raycast
   * against a plate collapsed to a point at the origin.
   *
   * A plane is a fair stand-in because these layers ARE plates — they lie in
   * their own XZ, the spine runs along X and the arc across Z.
   *
   * With one honest exception, added when the sheets learned to peel. A peeled
   * tail rises about 0.25 against a 0.31 layer gap, so over the last quarter of
   * a peeled sheet the proxy is no longer near the surface it stands for — it
   * is nearer the layer above. Hovering a raised flap can therefore pick its
   * neighbour. Left as it is on purpose: following the peel means a curved
   * proxy rebuilt whenever the shape moves, which is the CPU-side geometry this
   * whole design exists to avoid, and the cost falls on a flap at the far edge
   * of three of the eleven layers rather than on the body of any of them.
   *
   * It sits BESIDE the mesh under the carrier rather than under the mesh, which
   * is what keeps the hover from moving its own target. `setPose` has the whole
   * reasoning.
   */
  readonly hitArea: Mesh

  private readonly decalMap: Texture | null
  private readonly reliefMap: Texture | null

  /**
   * Only the caster carries one; see `createSheetDepthMaterial`. Held so it can
   * be disposed, which is the only reason a non-caster's `null` matters.
   */
  private readonly depthMaterial: MeshDepthMaterial | null

  /** The two poses the deploy interpolates between. */
  private readonly assembledPosition: Vector3
  private readonly explodedPosition: Vector3

  /**
   * The exploded offset as composed, before any layout turn — see
   * `setLayoutRotation`. Kept so the turn is applied to the AUTHORED layout
   * every time rather than to whatever the last turn left behind, which would
   * accumulate across resizes.
   */
  private readonly composedOffset: Vector3

  /**
   * This plate's own twist, at full openness, and its inverse.
   *
   * The offset above is read inside the pivot, so the pivot's twist is applied
   * to it before it reaches the artwork. A layout turn has to be expressed
   * where the eye sees it — in the artwork — so it is sandwiched: twist in,
   * turn, twist back out. See `setLayoutRotation`.
   */
  private readonly twist: Quaternion
  private readonly untwist: Quaternion

  /** Authored highlight levels, which hover scales rather than replaces. */
  private readonly baseRim: number
  private readonly baseBevelGlow: number

  /**
   * How readily this plate gives way, from its material. Applied here and not
   * in the timeline on purpose: the timeline decides what the POINTER is doing,
   * which is the same for every layer, and what a layer makes of that is a
   * property of the layer.
   */
  private readonly flex: number

  constructor(
    layer: SheetLayer,
    /**
     * The stack's shared occlusion field, and this layer's place in it. A sheet
     * cannot shade itself against its neighbours without knowing them, so this
     * is where the one dependency on the rest of the stack enters — by
     * reference, written once a frame by `StackOcclusion`.
     */
    occlusion: StackOcclusionUniforms,
    /**
     * The camera's film. Shared by every layer and written by nobody here —
     * grain belongs to the frame, not to a sheet. See `FilmGrain`.
     */
    grain: FilmGrainUniforms,
    layerIndex: number,
  ) {
    this.layer = layer

    const { shape, placement } = layer
    const bevelRadius = shape.thickness * 0.5

    const geometry = createShellGeometry({
      interiorU: shape.tessellation.u,
      interiorV: shape.tessellation.v,
      bevelSegments: 5,
      bandU: bevelRadius / shape.length,
      bandV: bevelRadius / shape.width,
      // Generous: the shape morphs at runtime and no CPU positions exist to
      // measure. Meshes are frustum-culled off anyway, this is for the
      // transmission pass.
      boundingRadius: Math.max(shape.length, shape.width) * 1.2,
    })

    this.decalMap = acquireDecalTexture(layer)
    this.reliefMap = createDecalRelief(layer.decal)

    const { material, uniforms } = createSheetMaterial(
      shape,
      layer.surface,
      this.decalMap,
      this.reliefMap,
      occlusion,
      grain,
      layerIndex,
    )
    this.material = material
    this.uniforms = uniforms

    this.assembledPosition = new Vector3(...placement.assembledOffset)
    this.composedOffset = new Vector3(...placement.offset)
    this.explodedPosition = this.composedOffset.clone()
    this.twist = new Quaternion().setFromEuler(new Euler(...placement.fanRotation))
    this.untwist = this.twist.clone().invert()
    this.baseRim = layer.surface.rimStrength
    this.baseBevelGlow = layer.surface.bevelGlow
    this.flex = layer.surface.flex

    const mesh = new Mesh(geometry, material)
    mesh.name = layer.id
    // Draw order is not authored here: `StackOrder` writes it every time the
    // camera crosses the plane of the stack.
    // Starts closed; the timeline owns this from the first frame on.
    mesh.position.copy(this.assembledPosition)
    mesh.scale.setScalar(placement.scale)
    mesh.castShadow = placement.castsShadow
    mesh.receiveShadow = true
    // Without this the shadow pass draws a point at the origin — the geometry
    // holds no positions and three's own depth material cannot build them.
    this.depthMaterial = placement.castsShadow
      ? createSheetDepthMaterial(uniforms, layer.surface.opacity)
      : null
    if (this.depthMaterial) mesh.customDepthMaterial = this.depthMaterial
    // `position` is a zero buffer; nothing on the CPU knows where this ends up.
    mesh.frustumCulled = false

    this.mesh = mesh

    const hitArea = new Mesh(
      new PlaneGeometry(shape.length * HIT_AREA_MARGIN, shape.width * HIT_AREA_MARGIN),
      HIT_AREA_MATERIAL,
    )
    hitArea.name = `${layer.id}-hit`
    // Into the plate's own plane: the loft lies in XZ with the spine on X.
    hitArea.rotation.x = -Math.PI / 2
    hitArea.position.copy(this.assembledPosition)
    hitArea.scale.setScalar(placement.scale)
    hitArea.userData.layerId = layer.id
    this.hitArea = hitArea

    const carrier = new Group()
    carrier.position.set(-placement.pivot[0], -placement.pivot[1], -placement.pivot[2])
    // Beside the mesh, NOT under it. See `setPose`.
    carrier.add(mesh, hitArea)

    const pivot = new Group()
    pivot.name = `${layer.id}-pivot`
    pivot.position.set(...placement.pivot)
    pivot.add(carrier)
    this.pivot = pivot
  }

  /**
   * Places the layer for this frame. `deploy` is 0 inside the assembled card
   * and 1 in the exploded layout; `hover` slides it out from under the pointer.
   *
   * One call rather than two, because both write the same position and the
   * order they were called in would decide the result.
   *
   * The deploy interpolates in a straight line, which is the honest path: the
   * layers are being pulled apart along one axis, and an arc would suggest they
   * were hinged. The plate also thins on the way in — see `assembledThickness`.
   * `uThickness` sets the bullnose radius too, so the edge rounds down with the
   * plate and the closed card keeps its profile instead of growing a flat rim.
   *
   * Hover slides along +X, the spine, which is the layer's own long axis: the
   * gesture is a sheet drawn out of a stack, so it has to follow the sheet and
   * not the screen. It rises as it goes — see `HOVER_LIFT_RATIO`. The rim is
   * the reason this reads at all, because at this angle a plate shows far more
   * edge than face and the edge is where a highlight is legible.
   *
   * `glow` is that rim, and it is a SECOND parameter rather than the same one
   * because the two answer the pointer at different speeds — the plate has mass
   * and the light does not. The caller decides how far apart to run them.
   *
   * `bendCenter` is where along the plate the drag has hold of it and `bend` is
   * how hard and which way, signed, already sprung by the caller. Neither rides
   * `hover`: the slide answers a layer being UNDER the pointer and the bend
   * answers the pointer MOVING, and a finger resting on a card does not bend it.
   */
  setPose(
    deploy: number,
    hover: number,
    glow: number,
    slide: number,
    bendCenter: number,
    bend: number,
  ): void {
    // The hit area takes the deploy and stops there, and this is load-bearing:
    // it is the pointer target, and a target that moved with the hover would be
    // sliding out from under the pointer that triggered it — hover on, layer
    // leaves, hover off, layer returns, at frame rate. A response cannot be
    // allowed to move its own trigger. Parked at rest it makes the pick
    // independent of the hover entirely, so there is no loop left to close.
    const rest = this.hitArea.position.lerpVectors(
      this.assembledPosition,
      this.explodedPosition,
      deploy,
    )

    this.mesh.position.copy(rest)
    this.mesh.position.x += hover * slide
    this.mesh.position.y += hover * slide * HOVER_LIFT_RATIO
    this.uniforms.uThickness.value = lerp(
      this.layer.placement.assembledThickness,
      this.layer.shape.thickness,
      deploy,
    )
    this.uniforms.uRimStrength.value = this.baseRim * lerp(1, HOVER_RIM_GAIN, glow)
    this.uniforms.uBevelGlow.value = this.baseBevelGlow * lerp(1, HOVER_RIM_GAIN, glow)

    // The bow travels with the pointer, so it has to be told which of the
    // plate's own material is under it — and that is NOT where the pick landed.
    // The pick landed on the hit area, which stayed parked while the plate slid
    // out by `hover * slide`; the material that used to be there has been
    // carried forward by exactly that much, so the point still under the
    // pointer is that far back along the sheet. Skipping this correction bends
    // the card ahead of the cursor by a tenth of its length, and it reads as
    // the bow leading the hand rather than following it.
    this.uniforms.uBendCenter.value = bendCenter - (hover * slide) / this.layer.shape.length
    // The drag is the same for every layer; `flex` is what this one makes of it.
    // The spring runs at full amplitude in the timeline and is scaled down here,
    // rather than the reverse, so a stiff plate keeps the TIMING of the gesture
    // and only loses the travel — a rigid cover that also loaded and released
    // more slowly would read as heavy rather than as stiff, and they are not the
    // same material.
    this.uniforms.uBendAmount.value = bend * this.flex * slide * DRAG_BEND_RATIO
  }

  /**
   * Turns a hit on this layer's pick proxy into a position along its spine.
   *
   * The proxy's u axis is the plate's own long axis — it is a plane laid into
   * the plate's plane, and neither the deploy nor the pivot separates the two.
   * All this undoes is the overhang, so an edge hit reports the edge instead of
   * a point past it.
   */
  spineParamAt(hitU: number): number {
    return clamp((hitU - 0.5) * HIT_AREA_MARGIN + 0.5, 0, 1)
  }

  /**
   * Which way this layer's face points, in world space.
   *
   * Read off the pick proxy rather than the plate, and that is the only place it
   * could come from: the plate's vertices are built in the vertex shader and the
   * CPU does not know where a single one of them ends up. The proxy is a plane
   * laid into the plate's own plane, so its +Z — which is what
   * `getWorldDirection` returns — IS the face normal, carrying every rotation
   * the pivot, the artwork and the float have applied to it.
   *
   * The plate's real surface curls away from this toward the tip. What reads the
   * normal is deciding which side of a card a finger is on, and that does not
   * change across the length of one.
   */
  faceNormal(target: Vector3): Vector3 {
    return this.hitArea.getWorldDirection(target)
  }

  /**
   * Turns the direction the stack spreads in, without turning a single plate.
   *
   * `rotation` is about the CAMERA'S OWN AXIS, given in the artwork's frame,
   * and every useful property of this follows from that one choice:
   *
   * - It is a pure rotation of the picture. A layout turned about any other
   *   axis would swing plates toward and away from the lens, which changes how
   *   large they are drawn and how much they overlap; about the view axis the
   *   whole arrangement simply rotates in the plane of the screen.
   * - Every offset keeps its depth EXACTLY. The component of a vector along
   *   the axis it is turned about is the one thing a rotation cannot touch, so
   *   the depth stagger the fan already had survives untouched — which is why
   *   `StackOrder`, `StackOcclusion` and the backdrop's capture stride need to
   *   know nothing about this. They sort the same eleven plates in the same
   *   order they always did.
   * - Only positions move. Orientation lives in `fanRotation` and in the
   *   artwork's own pose, and neither is touched here — a card lies the way it
   *   lies, and the stack merely lays it out somewhere else.
   *
   * The twist sandwich is what makes the second and third points true at once.
   * The offset is read INSIDE the pivot, so whatever is written here comes back
   * out through the plate's own twist; composing the turn in artwork space and
   * then undoing the twist is what keeps the eleven spread directions parallel
   * instead of splaying by up to the twist's own 16 degrees.
   *
   * Uses the twist at FULL openness while the pivot runs it at `local *
   * breathe`, and the residue is not worth the coupling: the two disagree by at
   * most the breathing's 3.5%, which is 0.009 radians on an offset a unit and a
   * half long — under a hundredth of a unit. Below that the deploy is closing,
   * and the exploded offset is being weighted out by the same number that is
   * shrinking the twist, so the two vanish together.
   *
   * Idempotent by construction: the turn is applied to the composed offset, not
   * to the last one, so resizing a hundred times lands exactly where resizing
   * once does.
   */
  setLayoutRotation(rotation: Quaternion): void {
    this.explodedPosition
      .copy(this.composedOffset)
      .applyQuaternion(this.twist)
      .applyQuaternion(rotation)
      .applyQuaternion(this.untwist)
  }

  /**
   * Quiets the plate's own tooth as it comes forward to be read.
   *
   * There are THREE height fields on this surface and they all write the same
   * normal, in this order: the rib, the weave, and then the decal. Standing in
   * the fan that is right — a laminate is a woven thing and the tooth is most
   * of what says which laminate it is. Held up to be read it stops being right,
   * because the drawing pressed into the plate is now the subject and it is
   * competing for the same light against a grid it cannot win against. The
   * coarsest weave in the stack is a waffle at scale 52, on the plate that
   * carries the QR, which is exactly the one that reads worst.
   *
   * TWO different answers, because the problem is two problems. `READ_TOOTH`
   * is a whole-plate settling and it is deliberately small: a plate turned
   * square to a reading light shows less of its own grain than one raked at the
   * fan's angle, and that is all it is entitled to claim. What actually clears
   * the bed is `READ_PRESS`, and that one is LOCAL — the shader takes it as the
   * die's own footprint and flattens the tooth only where the drawing is. The
   * first attempt at this used the whole-plate term alone at a quarter, which
   * bought a clean engraving by spending the plate's material everywhere,
   * including the two thirds of the face the drawing never touches.
   *
   * The colour term comes down with the shading term, and it has to: the weave
   * tint draws the same grid in albedo, so leaving it would take the ridges out
   * of the light and leave their diagram printed underneath.
   *
   * Both are driven by focus rather than latched, so a plate on its way back to
   * the fan gets its surface back on exactly the curve that took it away.
   */
  setReadFocus(focus: number): void {
    const { surface } = this.layer
    const tooth = lerp(1, READ_TOOTH, focus)
    this.uniforms.uWeaveDepth.value = surface.weaveDepth * tooth
    this.uniforms.uWeaveContrast.value = surface.weaveContrast * tooth
    this.uniforms.uRibShading.value = surface.ribShading * tooth
    this.uniforms.uRibContrast.value = surface.ribContrast * tooth
    this.uniforms.uPress.value = READ_PRESS * focus
  }

  /** 0 collapses the fan onto the back sheet, 1 is the composed layout. */
  setFanOpenness(openness: number): void {
    const [x, y, z] = this.layer.placement.fanRotation
    this.pivot.rotation.set(x * openness, y * openness, z * openness)
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.hitArea.geometry.dispose()
    this.material.dispose()
    this.depthMaterial?.dispose()
    releaseDecalTexture(decalKey(this.layer))
    this.reliefMap?.dispose()
  }
}
