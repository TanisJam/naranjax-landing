import {
  DirectionalLight,
  NeutralToneMapping,
  PCFSoftShadowMap,
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
function createLighting(scene: Scene): void {
  RectAreaLightUniformsLib.init()

  // Big and soft, not small and hard. The bright areas in the reference are
  // broad specular sweeps — the mirror image of a large softbox running across
  // a glossy sheet — not tight hotspots. Sweeping size against intensity showed
  // size is what moves them: at 4.5x1.6 the object's 95th-percentile luminance
  // measured 143 against the reference's 177, and enlarging the lights closed
  // that gap while raising intensity only blew out the midtones.
  const key = new RectAreaLight(0xffffff, 9, 9, 3)
  key.name = 'key'
  key.position.set(-3.2, 4, 3.8)
  key.lookAt(0, 0, 0)

  const rim = new RectAreaLight(0xdae8ff, 5.5, 8, 2.2)
  rim.name = 'rim'
  rim.position.set(3, 2.6, -3)
  rim.lookAt(0, 0, 0)

  // The only shadow caster in the scene — RectAreaLight cannot cast at all.
  // Restricting shadows to the top sheet keeps the layered depth for a quarter
  // of the cost; see `castsShadow` in the domain types.
  const spec = new DirectionalLight(0xffffff, 1.3)
  spec.name = 'spec'
  spec.position.set(-2, 3, 5)
  spec.castShadow = true
  spec.shadow.mapSize.set(1024, 1024)
  spec.shadow.radius = 4
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
  const bounce = new RectAreaLight(0xcfe0f8, 3.2, 7, 4)
  bounce.name = 'bounce'
  bounce.position.set(-2.6, -3.2, 2.8)
  bounce.lookAt(0, 0.4, 0)

  scene.add(key, rim, spec, bounce)
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
  renderer.shadowMap.type = PCFSoftShadowMap
  // Neutral, not ACES. ACES lifts the shadow toe and desaturates saturated
  // blues hard — the two things this piece cannot afford.
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 0.85
  container.appendChild(renderer.domElement)

  const scene = new Scene()

  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const environment = pmrem.fromScene(room, 0.04)
  scene.environment = environment.texture
  scene.environmentIntensity = 0.4
  room.dispose()
  pmrem.dispose()

  createLighting(scene)

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

  return { renderer, scene, camera, resize, dispose }
}
