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
  //
  // The tint moved with the rebrand and the intensity deliberately did not: hue
  // carries none of the fitted luminance, so this stayed the same 3.4 of fill,
  // shifted off blue so the back edge of an orange plate is separated by the
  // page's own violet rather than by a colour nowhere else in the piece.
  //
  // DIRECTIONAL now, where it was a `RectAreaLight`, and this is the second
  // light to make that trip for the same measured reason `bounce` did. Three
  // evaluates a `RectAreaLight` with linearly transformed cosines — float
  // texture lookups plus matrix work, per light, PER FRAGMENT — and eleven
  // overlapping layers pay it eleven times over. The cost is per LIGHT and is
  // completely indifferent to how bright that light is, which is what makes a
  // dim panel the worst deal in a rig. This one delivered 6.5 luminance points
  // of a direct total of 64.3 — ten per cent of the light for half of what
  // remained of the area-light budget.
  //
  // The job survives, and here it survives more comfortably than `bounce`'s
  // did. A panel buys a wrapped, gradual falloff, which is worth paying for on
  // a key that models form. This draws an EDGE: it sits behind the piece and
  // its whole brief is to separate the far side of a plate from the background.
  // A parallel source raking in from behind draws that edge harder, not softer,
  // so the risk here is a rim that reads too crisp rather than one that
  // disappears — watch the far corners of the middle plates, not the average.
  //
  // The intensity is derived on the same chain `bounce` used. The knockouts
  // read `spec` at 29.5 points for an intensity of 5.2, i.e. 5.67 points per
  // unit, and this delivered 6.5, so 6.5 / 5.67 ≈ 1.15.
  //
  // Not a caster. `spec` is still the only one; a second shadow pass to save a
  // fragment cost would be a poor trade in any direction. Its 6.5 does change
  // SIDES in `CAST_SHARE` though, because it is thrown by a directional source
  // now — see the arithmetic there.
  const rim = new DirectionalLight(0xe4dcff, 1.15)
  rim.name = 'rim'
  // Target left at the origin, which is exactly where the old `lookAt(0, 0, 0)`
  // aimed it. A moved target would have to be added to the scene to have any
  // effect at all, which is the trap `bounce` documents below.
  rim.position.set(3, 2.6, -3)

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
  //
  // DIRECTIONAL, where it used to be a `RectAreaLight`, and the reason is a
  // measurement rather than a preference.
  //
  // `__perf.sweep()` put the three area lights at 17.0 ms of a 36 ms frame,
  // reproduced across two runs — the most expensive thing the piece draws, more
  // than halving the resolution. Three evaluates a `RectAreaLight` with linearly
  // transformed cosines: float-texture lookups plus matrix work, per light, per
  // fragment, and eleven overlapping layers pay all of it eleven times over.
  // Roughly six milliseconds each, and the cost is per LIGHT — it does not care
  // how bright the light is.
  //
  // Which is what condemns this one specifically. The knockouts in `CAST_SHARE`
  // put its contribution at 2.0 of a direct total of 64.3: THREE PER CENT of the
  // light for a third of the area-light budget. Nothing else in the rig is
  // anywhere near that ratio — the key is 41% for the same price.
  //
  // And the job survives the change, because of what the job IS. A soft panel
  // buys a wrapped, gradual falloff across a surface, and that is worth paying
  // for on a key that models the form. This is FILL: its whole brief is to reach
  // the downward-facing surfaces so they are not black. Reaching them is
  // something a parallel light does perfectly well, and far more cheaply.
  //
  // The intensity is derived, not guessed. The same knockouts read `spec` at
  // 29.5 luminance points for an intensity of 5.2 — 5.67 points per unit — and
  // this used to contribute 2.0, so 2.0 / 5.67 ≈ 0.35. That is a starting point
  // and not a result: a parallel light distributes what it delivers differently
  // from a panel, so the AVERAGE can match while the darkest trough does not.
  // The trough is the thing to look at.
  //
  // Not a caster. `spec` is still the only one, and adding a second shadow pass
  // to save a fragment cost would be a poor trade in any direction.
  // Retinted with `rim` and, for the same reason, at exactly its old intensity.
  const bounce = new DirectionalLight(0xd8cbf4, 0.35)
  bounce.name = 'bounce'
  // Target left at the origin, which is where `lookAt(0, 0.4, 0)` was pointing
  // this to within a few degrees — and a moved target would have to be added to
  // the scene to have any effect at all.
  bounce.position.set(-2.6, -3.2, 2.8)

  scene.add(key, rim, spec, bounce)
  return spec
}

/**
 * Aspect at which the base camera distance frames the piece. Narrower than
 * this and the fixed vertical fov starts cropping the sheets sideways, so the
 * camera dollies back instead of widening — a wider fov would buy the width
 * back at the cost of the long-lens look the whole composition depends on.
 *
 * Exported because it is also the aspect the LAYOUT was composed against, and
 * that is not a coincidence to be restated in a second constant: the fan was
 * tuned until it filled this frame, which is the same condition that put the
 * dolly rule here. See `fitLayout`, which turns the fan away from the composed
 * arrangement by how far the viewport has drifted from this.
 */
export const FIT_ASPECT = 0.86

/**
 * Where the camera looks, and therefore where the middle of the frame is.
 *
 * Exported because centring something ON that frame — which is what opening a
 * layer full-frame does — needs the same point the lens is pointed at, and two
 * copies of it would drift the first time this moved.
 */
export const CAMERA_TARGET = new Vector3(0, -0.12, 0)
const TARGET = CAMERA_TARGET
const CAMERA_OFFSET = new Vector3(0.18, 0.5, 7.6).sub(TARGET)

/**
 * Drawing-buffer pixels per pixel the canvas is given, per axis — so the cost
 * goes with the SQUARE of it.
 *
 * This is what the MSAA that `createStage` just gave up was buying, bought a
 * different way — and 2 is where it was set because that is where the edge came
 * back, not because it is a round number. Walked against the frozen stack at a
 * 1.75 device ratio, with the resulting frame beside it:
 *
 *   1.0  no supersample   15.6 ms   staircase on the shallow diagonals
 *   1.2                   18.4 ms
 *   1.5                   26.7 ms   still stepped under magnification
 *   1.71                  31.4 ms
 *   2.0                   40.3 ms   clean, and matches the MSAA edge
 *
 * The line to read those against is what SHIPPED: MSAA 4x at the same buffer
 * measured 51.5 ms. So this is the quality back AND a frame a fifth cheaper,
 * which is why the trade is not a trade. 1.5 is here if more headroom is ever
 * wanted — it is half the old frame — but it costs edge quality the piece never
 * offered to give up.
 *
 * Four box samples per output pixel against four coverage samples, and the box
 * wins on this subject: MSAA runs the fragment shader ONCE per pixel and only
 * multiplies coverage at geometry edges. The shimmer here comes off eleven
 * grazing rim terms and a specular sweep across near-flat plates — interior
 * shading, which MSAA never covered and supersampling does.
 *
 * Not FXAA, and that is a choice rather than a shortcut. An edge filter finds
 * edges by luminance gradient, and this piece is high-frequency detail nearly
 * everywhere: the substrate's weave at `ribFrequency: 96`, the dot grid at
 * `dotScale: 200`, the film grain. FXAA cannot tell those from a staircase and
 * takes them all.
 *
 * It is the largest cost knob left now that the resolve is gone, and it is one
 * the `ResolutionGovernor` already owns: this sets the CEILING it starts from
 * and gives back first when a machine cannot hold the frame. A slow device
 * therefore loses the supersample before it loses anything else, which is the
 * right thing to lose. Worth knowing that it is also the largest MEMORY knob —
 * the drawing buffer goes with its square, and on a wide desktop the first
 * frame allocates that before the governor has seen a single interval.
 */
export const SUPERSAMPLE = 2

export function createStage(container: HTMLElement): Stage {
  // Transparent: the page owns the backdrop, so the canvas can sit on the panel
  // without a seam at any viewport. The studio backdrop plane this diverges
  // from only existed to feed transmission refraction, and no sheet transmits.
  const renderer = new WebGLRenderer({
    // OFF, and it is the single most expensive line this file ever held.
    //
    // A multisampled default framebuffer makes every `copyFramebufferToTexture`
    // resolve the WHOLE drawing buffer, and the frosted layers do four of those
    // a frame. Measured on an M3, four captures of a 2520x1422 buffer, three
    // brackets each:
    //
    //   antialias: true    ~31 ms   (31.4 / 16.6 / 38.6)
    //   antialias: false   ~0.4 ms  (0.39 / 3.24 / -0.36)
    //
    // Eighty times, for the same four copies. And with it on the cost tracks
    // the buffer: 24.7 ms at 4.03 Mpx against 6.28 ms at 1.17 Mpx, which is
    // 3.44x the pixels for 3.94x the cost. `BackdropCapture` used to conclude
    // the opposite — that the copies were per-call overhead and that a smaller
    // texture "attacks the one term that was never the problem". They are
    // bandwidth, and the bandwidth is a resolve nobody asked for.
    //
    // What replaces the antialiasing is `SUPERSAMPLE` below.
    antialias: false,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setClearColor(0x000000, 0)
  // The AUTHORED ratio, with no supersample on it. The supersample is a ceiling
  // the `ResolutionGovernor` climbs to, not a price of admission — it multiplies
  // whatever ratio is current when the governor is built, which is also how the
  // inspector path keeps the lower ratio it sets for itself.
  //
  // The mechanism, when it does climb: the drawing buffer is sized in device
  // pixels while the canvas keeps its CSS box, so a backing store larger than
  // the box is resampled by the compositor on the way to the screen.
  // Supersampling with no pass of our own.
  //
  // This is deliberately NOT an offscreen render target, which is where this
  // went first and had to be thrown away. Three switches tone mapping and the
  // output colour space OFF when the destination is a render target — see the
  // `_currentRenderTarget === null` test in its renderer — on the assumption
  // that a post pass will do both. `NeutralToneMapping` at 0.72 exposure simply
  // stopped applying, and the card came out blown to a flat saturated orange.
  // Worse than the look: the frosted layers read the buffer back and composite
  // against it by hand, and `FRAGMENT_BACKDROP_CHUNK` needs those bytes tone
  // mapped and encoded. A target would hand them linear. The canvas is the one
  // destination three finishes the frame for, so the frame is drawn there.
  const authoredRatio = Math.min(window.devicePixelRatio, 1.75)
  renderer.setPixelRatio(authoredRatio)
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
