import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type MeshDepthMaterial,
  type MeshPhysicalMaterial,
  type Texture,
} from 'three'
import { clamp, lerp } from '../../domain/easing'
import type { SheetDecal, SheetLayer } from '../../domain/types'
import { createShellGeometry } from './geometry/shellGeometry'
import { createCardFaceTexture } from './material/cardFaceTexture'
import { createLayerMotifTexture } from './material/layerMotifTexture'
import {
  createSheetDepthMaterial,
  createSheetMaterial,
  type SheetUniforms,
} from './material/sheetMaterial'

/**
 * The domain names the artwork; this is the only place that knows which
 * painter draws it. Keeping the mapping here is what lets `composition.ts`
 * stay free of Three.js entirely.
 */
function createDecalTexture(decal: SheetDecal): Texture | null {
  switch (decal) {
    case 'none':
      return null
    case 'card-front':
      return createCardFaceTexture('front')
    case 'card-back':
      return createCardFaceTexture('back')
    default:
      return createLayerMotifTexture(decal)
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
   * their own XZ, the spine runs along X and the arc across Z, and what curl is
   * left at the tail is a fraction of the gap between layers.
   *
   * It sits BESIDE the mesh under the carrier rather than under the mesh, which
   * is what keeps the hover from moving its own target. `setPose` has the whole
   * reasoning.
   */
  readonly hitArea: Mesh

  private readonly decalMap: Texture | null

  /**
   * Only the caster carries one; see `createSheetDepthMaterial`. Held so it can
   * be disposed, which is the only reason a non-caster's `null` matters.
   */
  private readonly depthMaterial: MeshDepthMaterial | null

  /** The two poses the deploy interpolates between. */
  private readonly assembledPosition: Vector3
  private readonly explodedPosition: Vector3

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

  constructor(layer: SheetLayer) {
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

    this.decalMap = createDecalTexture(layer.decal)

    const { material, uniforms } = createSheetMaterial(shape, layer.surface, this.decalMap)
    this.material = material
    this.uniforms = uniforms

    this.assembledPosition = new Vector3(...placement.assembledOffset)
    this.explodedPosition = new Vector3(...placement.offset)
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
    this.depthMaterial = placement.castsShadow ? createSheetDepthMaterial(uniforms) : null
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
    this.decalMap?.dispose()
  }
}
