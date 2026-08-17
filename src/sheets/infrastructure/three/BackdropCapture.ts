import { FramebufferTexture, LinearFilter, Vector2, type IUniform, type WebGLRenderer } from 'three'

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

  readonly uniforms: {
    uBackdrop: IUniform<FramebufferTexture>
    /** 1 / drawing buffer size, so the shader can work in pixels. */
    uBackdropTexel: IUniform<Vector2>
  }

  private texture: FramebufferTexture
  private width = 0
  private height = 0
  /** How many layers have asked to capture since `beginFrame`. */
  private asked = 0
  /** Whether sharing is allowed this frame. See `beginFrame`. */
  private sharing = true

  constructor() {
    this.texture = BackdropCapture.createTexture(1, 1)
    this.uniforms = {
      uBackdrop: { value: this.texture },
      uBackdropTexel: { value: new Vector2(1, 1) },
    }
  }

  private static createTexture(width: number, height: number): FramebufferTexture {
    const texture = new FramebufferTexture(width, height)
    // Linear, because the kernel samples between texels and a nearest filter
    // would quantise the blur back into the pixel grid it is meant to dissolve.
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    // No mipmaps: `copyFramebufferToTexture` writes level 0 alone, so the
    // remaining levels would be stale from whenever they were last built.
    texture.generateMipmaps = false
    return texture
  }

  /**
   * Sized to the DRAWING BUFFER rather than the CSS box, because that is what
   * `gl_FragCoord` counts in and what the copy reads from. On a 2x display the
   * two differ by exactly the factor that would misregister the whole effect.
   */
  resize(renderer: WebGLRenderer): void {
    const size = renderer.getDrawingBufferSize(new Vector2())
    const width = Math.max(1, Math.floor(size.x))
    const height = Math.max(1, Math.floor(size.y))
    if (width === this.width && height === this.height) return

    this.width = width
    this.height = height
    this.texture.dispose()
    this.texture = BackdropCapture.createTexture(width, height)
    this.uniforms.uBackdrop.value = this.texture
    this.uniforms.uBackdropTexel.value.set(1 / width, 1 / height)
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
    this.asked = 0
    this.sharing = sharing
  }

  /**
   * Freezes everything drawn so far. Called immediately before a layer draws.
   *
   * Counting here rather than deciding at construction time is what keeps this
   * correct as the draw order changes — `StackOrder` reverses the stack when it
   * turns and lifts a layer out when one is opened, and the layers that ought
   * to share a capture are whichever ones end up adjacent AFTER that.
   */
  capture(renderer: WebGLRenderer): void {
    if (this.width === 0) return
    const turn = this.asked++
    if (this.sharing && turn % this.stride !== 0) return
    renderer.copyFramebufferToTexture(this.texture)
  }

  dispose(): void {
    this.texture.dispose()
  }
}
