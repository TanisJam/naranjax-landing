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
   * the render-pass breaks. What a shared capture costs is precise and small:
   * the layers draw back to front, so a layer that reuses the previous capture
   * is missing exactly ONE plate behind it — the frosted layer that captured.
   * Not an arbitrary amount of the scene, one sheet.
   *
   * And that sheet is the best possible one to lose. It is itself translucent,
   * it is immediately behind, and it is about to be put through a blur wide
   * enough to dissolve it: the frost kernel cannot resolve a single film's
   * contribution at that radius, so what is dropped is a difference the effect
   * was going to destroy anyway. That is the whole argument for sharing, and it
   * is why this is a stride over the DRAW ORDER rather than a cap on the count
   * — the layers that share are always neighbours, never distant.
   *
   * Above 2 the reasoning stops holding, because then a layer is missing plates
   * it has real separation from and the stack starts looking like it is frosting
   * the page instead of itself.
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
   */
  beginFrame(): void {
    this.asked = 0
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
    if (turn % this.stride !== 0) return
    renderer.copyFramebufferToTexture(this.texture)
  }

  dispose(): void {
    this.texture.dispose()
  }
}
