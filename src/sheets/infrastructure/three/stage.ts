import {
  DirectionalLight,
  NeutralToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  RectAreaLight,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

export interface Stage {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  /**
   * The light the stack's own shadowing is derived from.
   *
   * Exposed because the analytic occlusion has to know which way shadows fall,
   * and there is exactly one honest answer to that: the only light in the scene
   * that casts. The three area lights cannot, so pointing the term at any of
   * them would be inventing a shadow direction rather than reading one.
   */
  keyLight: DirectionalLight
  resize: (width: number, height: number) => void
  dispose: () => void
}

/**
 * The rim highlights running along every bevel are the signature of the piece.
 * They come from long, narrow area lights — a point light cannot produce them,
 * no matter how the material is tuned.
 *
 * Deliberately sparse. An earlier version ran four lights plus an ambient fill
 * and the darkest pixel in the whole frame measured 111/255 — no blacks at all,
 * which is exactly what made it read as flat plastic. Ambient light is the
 * worst offender: it lifts every surface uniformly and there is no way to earn
 * the darks back afterwards.
 */
function createLighting(scene: Scene): DirectionalLight {
  RectAreaLightUniformsLib.init()

  // Big and soft, not small and hard. The bright areas in the reference are
  // broad specular sweeps — the mirror image of a large softbox running across
  // a glossy sheet — not tight hotspots. Sweeping size against intensity showed
  // size is what moves them: at 4.5x1.6 the object's 95th-percentile luminance
  // measured 143 against the reference's 177, and enlarging the lights closed
  // that gap while raising intensity only blew out the midtones.
  //
  // Pulled down from 9 to 6.6 and now to here, and that number is where the
  // piece's flatness was
  // actually stored. Knocking each contributor out in turn and measuring what
  // the frame lost put this at a mean of 40.76 luminance points, against 10.53
  // for the rim and 7.37 for the only light in the scene that can cast a
  // shadow. One source carrying four times everything else is a source with
  // nothing to model against: every plate takes its light from the same
  // direction at nearly the same strength, and the stack reads as a set of flat
  // colours rather than as eleven surfaces turned different ways.
  const key = new RectAreaLight(0xffffff, 5.8, 9, 3)
  key.name = 'key'
  key.position.set(-3.2, 4, 3.8)
  key.lookAt(0, 0, 0)

  // Down from 5.5, and this is the light the last rebalance never looked at.
  // That pass moved the key, the directional and the environment and left the
  // two panels below untouched — 5.5 and 3.2 of pure fill, measured together at
  // 14.6 luminance points, which is the whole environment over again arriving
  // through a door nobody was watching. A backlight that casts nothing, falls
  // off over nothing and reaches every plate at the same strength is the
  // definition of the complaint: it raises the floor of the frame and gives the
  // eye no direction in exchange.
  //
  // Not off. It is the only source behind the piece, and it is what separates
  // the far edge of a plate from whatever is behind it. Cut to where it draws
  // that edge and stops filling the body.
  const rim = new RectAreaLight(0xdae8ff, 3.4, 8, 2.2)
  rim.name = 'rim'
  rim.position.set(3, 2.6, -3)
  rim.lookAt(0, 0, 0)

  // The only shadow caster in the scene — RectAreaLight cannot cast at all.
  // Every one of the eleven sheets is now rendered into its map, translucent
  // ones included; see `castsShadow` in the domain types for what that costs
  // and what makes a film able to cast an honest shadow at all.
  //
  // Promoted from 1.3 to a co-key, which is the whole of what this rig needed.
  // At the old value it contributed 7.37 luminance points against the area
  // key's 40.76, so the shadow it casts could remove at most a fifth of the
  // light where it fell — a correct shadow that could never be seen. How much a
  // shadow reads is not a property of the shadow map; it is a property of how
  // much of the scene's light the caster is holding. Measured after the change:
  // the same shadow went from 4.92% of the frame at a mean of 3.4 to 8.64% at
  // 11.6.
  //
  // The three levels here were fitted together rather than chosen. Shifting the
  // ratio moves the two states in OPPOSITE directions — the exploded stack is
  // plates at raking angles and gains from a directional source, while the
  // closed card is one flat plate square to the lens and was living on the area
  // key's broad sweep. A first pass at 5.4/4.2/0.24 took the closed card down a
  // uniform 7.9 luminance points, which is the arithmetic of the knockouts
  // above almost exactly: -16 from the key, -6 from the environment, +14 back
  // from here. No trio holds both states at their old level, so these sit where
  // the closed card keeps its sheen and the stack still gets its falloff.
  //
  // It also buys the falloff an area light cannot. A 9x3 panel four units off
  // lights every plate in the stack at nearly the same strength; a directional
  // source raking across them is what makes one end of a sheet brighter than
  // the other, and that gradient is most of what reads as form.
  //
  // Raised again, to 5.2, while everything around it came down. The rig is not
  // being dimmed uniformly — that would only trade a washed-out frame for a
  // muddy one. What is being changed is the RATIO: the two panels that fill and
  // the environment that fills lose about a third each, and the one source with
  // a direction takes some of it back. Same light on the lit side, far less on
  // the unlit one, which is the only thing that makes a surface read as turned.
  const spec = new DirectionalLight(0xffffff, 5.2)
  spec.name = 'spec'
  spec.position.set(-2, 3, 5)
  spec.castShadow = true
  spec.shadow.mapSize.set(1024, 1024)
  // Widened now that it drives a real Vogel disk and now that there is a shadow
  // to widen. The map covers 6.4 units across 1024 texels, so a texel is 0.00625
  // and this is a penumbra about 0.056 wide — a fifth of the 0.31 gap between
  // layers, which is the scale a soft edge should have at that throw.
  spec.shadow.radius = 9
  spec.shadow.bias = -0.0007
  spec.shadow.normalBias = 0.005

  // Tight ortho frustum around the piece — a loose one wastes the whole map on
  // empty space and the shadow turns to mush.
  const shadowCamera = spec.shadow.camera
  shadowCamera.left = -3.2
  shadowCamera.right = 3.2
  shadowCamera.top = 3.2
  shadowCamera.bottom = -3.2
  shadowCamera.near = 0.5
  shadowCamera.far = 14
  shadowCamera.updateProjectionMatrix()

  // Aimed up into the tunnels from below-left. The reference's concave faces
  // are clearly lit — without this every trough renders near-black because both
  // main lights sit above the piece.
  // Halved from 3.2. This one fires up into every downward-facing surface in
  // the piece at once, so it is the single largest reason the frame has no
  // blacks in it — a trough is dark because nothing reaches it, and this reached
  // all of them. Half of it still keeps the concave faces off pure black, which
  // is the whole job it was added for; the other half was the wash.
  const bounce = new RectAreaLight(0xcfe0f8, 1.6, 7, 4)
  bounce.name = 'bounce'
  bounce.position.set(-2.6, -3.2, 2.8)
  bounce.lookAt(0, 0.4, 0)

  scene.add(key, rim, spec, bounce)
  return spec
}

/**
 * Aspect at which the base camera distance frames the piece. Narrower than
 * this and the fixed vertical fov starts cropping the sheets sideways, so the
 * camera dollies back instead of widening — a wider fov would buy the width
 * back at the cost of the long-lens look the whole composition depends on.
 */
const FIT_ASPECT = 0.86

const TARGET = new Vector3(0, -0.12, 0)
const CAMERA_OFFSET = new Vector3(0.18, 0.5, 7.6).sub(TARGET)

export function createStage(container: HTMLElement): Stage {
  // Transparent: the page owns the backdrop, so the canvas can sit on the panel
  // without a seam at any viewport. The studio backdrop plane this diverges
  // from only existed to feed transmission refraction, and no sheet transmits.
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.outputColorSpace = SRGBColorSpace
  // Transmission re-renders the whole scene — heavy vertex shader included —
  // into its own target every frame. At full resolution it measured as two
  // thirds of the entire frame budget. What it feeds is a blurred refraction
  // behind frosted glass, so it does not need those pixels.
  renderer.transmissionResolutionScale = 0.4
  renderer.shadowMap.enabled = true
  // PCF, not the PCFSoftShadowMap this asked for until now. That constant is
  // deprecated and three silently substitutes this one, so the code has been
  // requesting a filter it never got — harmless while the shadow was worth
  // three luminance points, and worth naming now that it is worth eleven.
  //
  // No softness is lost by saying so. Three's current PCF path is a five-tap
  // Vogel disk rotated per pixel by interleaved gradient noise, roughly twenty
  // filtered taps, and `shadow.radius` scales that disk directly. It is the
  // soft filter; the deprecated name was the only thing missing.
  renderer.shadowMap.type = PCFShadowMap
  // Neutral, not ACES. ACES lifts the shadow toe and desaturates saturated
  // blues hard — the two things this piece cannot afford.
  renderer.toneMapping = NeutralToneMapping
  // Down from 0.85, which stood untouched through every pass at the lighting
  // and is the most direct control over the one complaint none of them fixed.
  // Every light in the scene was rebalanced against every other light, and a
  // rebalance cannot change an overall level by construction — it only decides
  // where the same total goes. This is the level.
  //
  // It is also the one control that reaches the darks. Neutral tone mapping
  // holds its toe rather than lifting it, so lowering exposure genuinely pushes
  // the bottom of the frame down instead of just pulling the highlights in —
  // which is what the flat-plastic reading needs and what dimming a light,
  // spread across the whole surface it lights, does not give.
  renderer.toneMappingExposure = 0.72
  container.appendChild(renderer.domElement)

  const scene = new Scene()

  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const environment = pmrem.fromScene(room, 0.04)
  scene.environment = environment.texture
  // Down from 0.4, and this is the warning `createLighting` already carries,
  // arriving through a different door. That comment names ambient as the worst
  // offender because it lifts every surface uniformly and the darks can never
  // be earned back — and then an environment at 0.4 measured as the SECOND
  // largest contributor in the frame at 14.59 luminance points, ahead of the
  // rim light and ahead of the entire specular response of every material in
  // the stack. Most of what a room environment gives a near-flat plate is fill,
  // and fill is exactly what is being rationed here.
  //
  // Not to zero. What is left is the reflection that makes a surface read as
  // material rather than as paint, and killing it outright only trades
  // flat-because-lifted for flat-because-dead.
  //
  // And down again to 0.20, with the two fill panels, for the reason the
  // paragraph above already gives and the last pass only half-acted on. A room
  // environment is ambient light with a picture on it: the reflection is worth
  // keeping and the lift is not, and 0.28 was still buying more of the second
  // than of the first on plates this close to flat.
  scene.environmentIntensity = 0.2
  room.dispose()
  pmrem.dispose()

  const keyLight = createLighting(scene)

  // Long lens. The reference has almost no perspective divergence between the
  // near and far sheets, which a wide fov would destroy.
  const camera = new PerspectiveCamera(30, 1, 0.1, 100)

  const resize = (width: number, height: number): void => {
    const aspect = width / height
    camera.aspect = aspect
    camera.position
      .copy(TARGET)
      .addScaledVector(CAMERA_OFFSET, aspect < FIT_ASPECT ? FIT_ASPECT / aspect : 1)
    camera.lookAt(TARGET)
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }

  const dispose = (): void => {
    environment.texture.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }

  return { renderer, scene, camera, keyLight, resize, dispose }
}
