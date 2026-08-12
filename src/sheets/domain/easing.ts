export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Frame-rate independent exponential smoothing. `speed` is roughly 1/seconds. */
export const damp = (current: number, target: number, speed: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-speed * dt))

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

export const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))

/**
 * Inverses of the two cubics: given an eased value, the t that produced it.
 *
 * These exist so a transition can be interrupted. Swapping curves mid-flight
 * changes what the same t means, and the eased value would jump; re-solving for
 * t under the new curve is what keeps the motion continuous through a reversal.
 */
export const easeInOutCubicT = (x: number): number =>
  x < 0.5 ? Math.cbrt(x / 4) : 1 - Math.cbrt(2 - 2 * x) / 2

export const easeOutCubicT = (x: number): number => 1 - Math.cbrt(1 - x)

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}
