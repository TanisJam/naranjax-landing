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
 */
export class BackdropCapture {
  readonly uniforms: {
    uBackdrop: IUniform<FramebufferTexture>
    /** 1 / drawing buffer size, so the shader can work in pixels. */
    uBackdropTexel: IUniform<Vector2>
  }

  private texture: FramebufferTexture
  private width = 0
  private height = 0

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

  /** Freezes everything drawn so far. Called immediately before a layer draws. */
  capture(renderer: WebGLRenderer): void {
    if (this.width === 0) return
    renderer.copyFramebufferToTexture(this.texture)
  }

  dispose(): void {
    this.texture.dispose()
  }
}
