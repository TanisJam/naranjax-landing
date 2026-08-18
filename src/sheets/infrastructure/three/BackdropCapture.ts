import { LinearFilter, Vector2, WebGLRenderTarget, type IUniform, type Texture, type WebGLRenderer } from 'three'

/**
 * What a frosted layer sees through itself.
 *
 * Alpha blending cannot produce frosted glass, and no amount of tuning changes
 * that: the blend is `src * a + dst * (1 - a)`, and `dst` is whatever is already
 * in the framebuffer, sampled at exactly one texel. There is no stage at which a
 * material can reach a NEIGHBOURING pixel of what is behind it, and reaching
 * neighbours is the whole of what frosting does. A translucent sheet can only
 * ever tint what is behind it, never diffuse it — which is why the layers read
 * as tinted windows no matter how the opacity is set.
 *
 * So the frame is captured and the layers composite it themselves. This is the
 * same trick as CSS `backdrop-filter`, for the same reason.
 *
 * ONE texture for the whole stack, not one per layer, and that is exact rather
 * than a saving: the layers draw back to front, each captures immediately
 * before it draws, and GPU commands within a frame are ordered. Every layer
 * therefore samples the frame as it stood when IT captured — the state of
 * everything behind it and nothing in front. A second capture overwriting the
 * texture cannot reach backwards into a draw call that already ran.
 *
 * WHAT THE COPY COSTS, because it is not what it looks like. Four of these
 * measured 3.48 gpu ms of a 7.3 ms frame, reproduced across two sweeps, while
 * the eleven-tap spiral every frosted fragment walks measured 0.02 ms. The
 * blur is free and the copies are half the frame, which is the reverse of the
 * intuition and the reverse of where an afternoon of optimisation would go.
 *
 * SUPERSEDED — see `stage.ts`. The paragraph below is kept because the reasoning
 * is the instructive part and the conclusion was measured to be exactly wrong:
 * the cost IS bandwidth, and it is an MSAA resolve that `antialias: true` was
 * silently forcing on every copy. Four captures went from ~31 gpu ms to ~0.4 ms
 * when the drawing buffer stopped being multisampled, and the cost tracks the
 * buffer size at 3.94x for 3.44x the pixels.
 *
 * The reason is that it is not bandwidth. Four copies of a 1.5 M texel buffer
 * is about 6 MB, which an M3 moves in microseconds; 0.87 ms EACH is per-call
 * overhead, because `copyFramebufferToTexture` breaks the render pass — the
 * driver has to end the pass, resolve, copy, and start another one. So the
 * quantity to reduce is the NUMBER of captures. Making the texture smaller
 * attacks the one term that was never the problem.
 */
export class BackdropCapture {
  /**
   * How many frosted layers share one capture.
   *
   * 1 is the exact behaviour described above and 2 is what ships, which halves
   * the render-pass breaks. What a shared capture costs is precise: the layers
   * draw back to front, so a layer that reuses the previous capture is missing
   * exactly ONE plate behind it — the frosted layer that captured. Not an
   * arbitrary amount of the scene, one sheet.
   *
   * MEASURED, and this used to carry an argument instead. The argument was that
   * the lost sheet is about to go through a blur wide enough to dissolve it, so
   * the difference was one the effect would have destroyed anyway. That is
   * wrong, and wrong in a way worth keeping written down: it assumes the frost
   * BLENDS. It does not. A frosted material runs `One / Zero` and writes its
   * composite straight over the destination, so a plate absent from the capture
   * is not softened into the result — there is no destination left for it to
   * survive in. Nothing about a wide kernel rescues that.
   *
   * The conclusion survives the argument dying, because the frame was then
   * compared at both strides: switching from 1 to 2 moves the image by 0.72
   * luminance points out of 255, against 3.08 and 2.34 for the two plates the
   * sharing was predicted to erase. It is not erasing them. A quarter of one
   * plate's worth of difference, spread over the whole frame, for 7.10 gpu ms.
   *
   * Still a stride over the DRAW ORDER rather than a cap on the count, so the
   * layers that share are always neighbours. And still not above 2: past that a
   * layer is missing plates it has real separation from, and the measurement
   * above says nothing about that case — it was taken at 2.
   *
   * STILL 2, AND STILL WORTH IT — but the mechanism under it was wrong and has
   * been replaced. See `capture`: sharing used to be a COUNT over the layers
   * that asked, which is only the same as the neighbour rule while every layer
   * in the draw order captures. Seven frosted layers among eleven broke that and
   * the count paired two plies with an opaque one between them. The rule is now
   * checked against stack indices instead of assumed, and it still takes four
   * captures out of seven here — the same number, the right four.
   *
   * The reason to keep sharing at all changed too, and it is not the one written
   * above. A capture no longer costs 0.87 ms of resolve; `antialias: false` in
   * `stage.ts` took four of them to ~0.4 ms total. What it costs now is
   * SERIALISATION: the copy writes the very texture the following draws sample,
   * so every capture is a read-after-write the driver has to order, and the
   * layers stop overlapping. Measured by walking this dial with everything else
   * fixed — 7 captures against 4 cost about 15 ms of a frame that was 11.
   * Superlinear, and nothing to do with bandwidth.
   *
   * So 1 is not "the exact behaviour" worth having: it is four more stalls for a
   * capture the neighbour rule already makes sound.
   *
   * THAT NEIGHBOUR RULE IS A PRECONDITION, not a description, and it is the
   * whole reason `beginFrame` can be told to suspend this. It holds only while
   * every layer draws in its place in the stack. A layer being read does not:
   * it is lifted to the front of the queue outright, so the plate it shares
   * with is left half a deck behind it and everything in between goes missing
   * from the capture it composites against — while it fills the screen. That is
   * not a subtlety, it is three of the nine inner layers vanishing from a card
   * held up to be read, and it was reported as exactly that.
   */
  stride = 2

  /**
   * Capture pixels per drawing-buffer pixel, per axis. The cost goes with the
   * square, and this is the knob the whole file was missing.
   *
   * `knockouts.ts` said all along that this cost "scales with BUFFER SIZE" and
   * the doc above argued the opposite. The knockout was right, and the
   * arithmetic is stark once the resolve is gone: with the captures at full
   * resolution the frame measured 15.6 ms at a 1.75 pixel ratio and 40.3 ms at
   * 3.5, while everything that is NOT a capture stayed at 6-7 ms in both. The
   * captures were the entire slope.
   *
   * Half per axis is a quarter of the texels. It costs the effect nothing, and
   * that is not a hope — a frost is a BLUR, so the capture is the one buffer in
   * the piece whose high frequencies are thrown away by design. What it reads
   * back is a softer sample at the same UV, which is the effect rather than a
   * degradation of it.
   *
   * IT IS ALSO ONLY POSSIBLE NOW. `copyFramebufferToTexture` is
   * `copyTexSubImage2D`, which copies a REGION one-to-one and cannot scale — a
   * smaller destination there captures a corner of the screen, not a
   * downsample. Scaling needs `blitFramebuffer`, and a scaling blit is illegal
   * from a MULTISAMPLED read buffer. So dropping `antialias` did not just make
   * the copies cheaper; it is what unlocked making them smaller.
   *
   * Not below a half without checking the filter. The blit resolves with
   * `LINEAR`, which at exactly one half is the four-texel average you want and
   * at a quarter is an undersample that would put aliasing INTO the blur.
   */
  scale = 0.5

  readonly uniforms: {
    uBackdrop: IUniform<Texture>
    /**
     * 1 / DRAWING BUFFER size, so the shader can work in pixels.
     *
     * The drawing buffer, note, and not the capture — those are no longer the
     * same thing. Everything the shader does with this is in UV: the backdrop
     * is addressed as `gl_FragCoord.xy * uBackdropTexel`, which is normalised,
     * and the blur offsets are the same units again. A capture stored at half
     * that resolution therefore needs NO shader change at all — the same UV
     * lands in the same place and simply reads a softer sample, which is what a
     * frost wants anyway. Setting this from the capture instead would scale the
     * addressing off the frame and misregister the whole effect.
     */
    uBackdropTexel: IUniform<Vector2>
  }

  private target: WebGLRenderTarget
  /** Size of what is being copied FROM. */
  private sourceWidth = 0
  private sourceHeight = 0
  /** Size of what it is copied INTO. */
  private width = 0
  private height = 0
  /** Stack index of the layer that took the capture now in the texture. */
  private capturedIndex: number | null = null
  /** How many layers have reused it since. */
  private shared = 0
  /** Whether sharing is allowed this frame. See `beginFrame`. */
  private sharing = true

  constructor() {
    this.target = BackdropCapture.createTarget(1, 1)
    this.uniforms = {
      uBackdrop: { value: this.target.texture },
      uBackdropTexel: { value: new Vector2(1, 1) },
    }
  }

  private static createTarget(width: number, height: number): WebGLRenderTarget {
    const target = new WebGLRenderTarget(width, height, {
      // Linear, because the kernel samples between texels and a nearest filter
      // would quantise the blur back into the pixel grid it is meant to
      // dissolve. It is also what the downscaling blit filters WITH.
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      // Nothing is ever drawn into this, only blitted, so there is nothing to
      // depth-test against.
      depthBuffer: false,
      stencilBuffer: false,
    })
    // Left in the default (linear) colour space on purpose, which here means
    // "no transform in either direction". The bytes arriving are a raw copy of
    // the finished canvas — already tone mapped and already encoded — and the
    // shader has to read those same bytes back. Declaring sRGB would make three
    // allocate `SRGB8_ALPHA8` and the sampler would decode them on the way out.
    target.texture.generateMipmaps = false
    return target
  }

  /**
   * Measured against the DRAWING BUFFER rather than the CSS box, because that
   * is what `gl_FragCoord` counts in and what the blit reads from. On a 2x
   * display the two differ by exactly the factor that would misregister the
   * whole effect.
   *
   * The capture itself is then `scale` of that. See `scale`.
   */
  resize(renderer: WebGLRenderer): void {
    const size = renderer.getDrawingBufferSize(new Vector2())
    this.sourceWidth = Math.max(1, Math.floor(size.x))
    this.sourceHeight = Math.max(1, Math.floor(size.y))
    const width = Math.max(1, Math.round(this.sourceWidth * this.scale))
    const height = Math.max(1, Math.round(this.sourceHeight * this.scale))

    // Always, even when the capture lands on the same size: the uniform is in
    // SOURCE units, so a resize that only moves the drawing buffer still has to
    // reach it.
    this.uniforms.uBackdropTexel.value.set(1 / this.sourceWidth, 1 / this.sourceHeight)
    if (width === this.width && height === this.height) return

    this.width = width
    this.height = height
    this.target.dispose()
    this.target = BackdropCapture.createTarget(width, height)
    this.uniforms.uBackdrop.value = this.target.texture
  }

  /**
   * Resets the stride. Called once per frame, before anything draws.
   *
   * Counted per frame rather than held across frames on purpose: the stride has
   * to land on the same layers every frame, or the ones that share would take
   * turns being a frame stale and the stack would shimmer.
   *
   * `sharing` is how the caller says the precondition holds. Sharing is only
   * ever safe while the draw order is the stack order, because that is what
   * makes the plate omitted from a reused capture the immediate neighbour of
   * the layer reusing it. Anything that lifts a layer out of that order — one
   * being read, which jumps to the end of the queue — has to say so, and then
   * every frosted layer captures for itself. The frames that pay for it are the
   * frames with a card filling the screen, which are exactly the frames where
   * seven eighths of the stack is not being drawn anyway.
   */
  beginFrame(sharing = true): void {
    this.capturedIndex = null
    this.shared = 0
    this.sharing = sharing
  }

  /**
   * Freezes everything drawn so far. Called immediately before a layer draws.
   *
   * Decided here rather than at construction time, which is what keeps it
   * correct as the draw order changes — `StackOrder` reverses the stack when it
   * turns and lifts a layer out when one is opened, and the layers that ought
   * to share a capture are whichever ones end up adjacent AFTER that.
   *
   * `index` is the layer's place in the stack, and it is what makes the
   * neighbour rule CHECKABLE instead of merely intended. The old test counted
   * how many layers had asked and shared every other one, which is the same
   * thing only while every layer in the draw order captures. It is not: an
   * OPAQUE ply between two frosted ones is invisible to a counter, so with the
   * frosted layers at 8,7,6,5,4,2,1 the counter paired 4 with 2 and quietly
   * handed `glossy-light` a capture missing both `holo-currency` AND `mesh` —
   * and `mesh` is opaque, so the sheet composited a scene showing plies that an
   * opaque substrate should have hidden. Adjacent indices are the actual
   * precondition; a count was a proxy for it that stopped holding the moment
   * the stack gained a frosted layer.
   *
   * Costing nothing to fix, which is the good part: neighbour-checked sharing
   * still takes four captures out of seven frosted layers here, the same number
   * the counter took. It just takes the RIGHT four.
   */
  capture(renderer: WebGLRenderer, index: number): void {
    if (this.width === 0) return

    const shareable =
      this.sharing &&
      this.shared < this.stride - 1 &&
      this.capturedIndex !== null &&
      // Adjacent in the stack, in either direction, because the draw order
      // reverses with the camera and the rule is about what lies BETWEEN two
      // layers rather than about which way round they are.
      Math.abs(index - this.capturedIndex) === 1

    if (shareable) {
      this.shared++
      return
    }

    this.shared = 0
    this.capturedIndex = index
    this.blit(renderer)
  }

  /**
   * Copies the canvas into the capture, scaling on the way.
   *
   * Raw GL, because three has no scaling copy: `copyFramebufferToTexture` is a
   * one-to-one `copyTexSubImage2D` and there is no other door. What there is,
   * in WebGL2, is `blitFramebuffer` — and it will resize between the read and
   * draw rectangles, filtering with `LINEAR`, provided the READ side is not
   * multisampled. It is not, since `stage.ts` gave up `antialias`.
   *
   * The framebuffer binding goes through three's own state tracker rather than
   * `gl.bindFramebuffer`, and that is not fussiness — this runs inside
   * `onBeforeRender`, in the middle of three's render, so a binding it does not
   * know about is a binding it will not restore. Left back on the default at
   * the end for the same reason: the very next thing to happen is the layer
   * that asked for this drawing itself, onto the canvas.
   */
  private blit(renderer: WebGLRenderer): void {
    const gl = renderer.getContext() as WebGL2RenderingContext
    // Idempotent, and the only way to be sure the framebuffer object exists
    // before its name is read out of the property cache.
    renderer.initRenderTarget(this.target)
    // Cast because three types the property cache as `unknown` — this is the
    // one place the piece reaches past the public surface, and the reach is
    // exactly one field wide.
    const cached = renderer.properties.get(this.target) as {
      __webglFramebuffer?: WebGLFramebuffer | null
    }
    const destination = cached.__webglFramebuffer
    if (!destination) return

    renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination)
    gl.blitFramebuffer(
      0,
      0,
      this.sourceWidth,
      this.sourceHeight,
      0,
      0,
      this.width,
      this.height,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR,
    )
    renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
  }

  dispose(): void {
    this.target.dispose()
  }
}
