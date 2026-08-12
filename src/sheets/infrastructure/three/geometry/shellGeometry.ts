import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'

export interface ShellGeometryOptions {
  /** Segments across the flat interior, along the sweep (u). */
  interiorU: number
  /** Segments across the flat interior, along the arc (v). */
  interiorV: number
  /** Segments dedicated to each of the four bevel bands. */
  bevelSegments: number
  /** Bevel band width as a fraction of the u axis. */
  bandU: number
  /** Bevel band width as a fraction of the v axis. */
  bandV: number
  /** Radius used for the manual bounding sphere (no CPU positions exist). */
  boundingRadius: number
}

/**
 * Samples of one axis in [0, 1], packed near both ends.
 *
 * The bullnose edge is only `thickness / 2` wide — roughly 0.6% of the plate.
 * A uniform grid would spend one or two vertices on it and the highlight that
 * defines the whole look would disappear. So we spend `bevelSegments` on each
 * band and stretch the rest over the interior.
 */
function biasedAxis(interior: number, bevelSegments: number, band: number): Float32Array {
  const clampedBand = Math.min(Math.max(band, 1e-4), 0.24)
  const values: number[] = []

  for (let i = 0; i <= bevelSegments; i++) {
    values.push((i / bevelSegments) * clampedBand)
  }
  for (let i = 1; i <= interior; i++) {
    values.push(clampedBand + (i / interior) * (1 - 2 * clampedBand))
  }
  for (let i = 1; i <= bevelSegments; i++) {
    values.push(1 - clampedBand + (i / bevelSegments) * clampedBand)
  }

  return Float32Array.from(values)
}

/**
 * A closed, watertight double-sided shell in parameter space.
 *
 * No world positions are produced here. Every vertex carries only its (u, v)
 * parameter and which face of the plate it belongs to; the vertex shader turns
 * that into geometry. That is the whole point — animating the shape later means
 * changing uniforms, never rebuilding a buffer.
 *
 * The two grids meet exactly at the boundary, where the bevel height reaches
 * zero, so the plate closes without a separate skirt.
 */
export function createShellGeometry(options: ShellGeometryOptions): BufferGeometry {
  const us = biasedAxis(options.interiorU, options.bevelSegments, options.bandU)
  const vs = biasedAxis(options.interiorV, options.bevelSegments, options.bandV)

  const nu = us.length
  const nv = vs.length
  const perShell = nu * nv
  const vertexCount = perShell * 2

  const params = new Float32Array(vertexCount * 2)
  const shells = new Float32Array(vertexCount)
  // `position` is never read by our shader, but three requires the attribute to
  // exist to size the draw call.
  const positions = new Float32Array(vertexCount * 3)

  for (let s = 0; s < 2; s++) {
    const shell = s === 0 ? 1 : -1
    const base = s * perShell
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const index = base + i * nv + j
        params[index * 2] = us[i]!
        params[index * 2 + 1] = vs[j]!
        shells[index] = shell
      }
    }
  }

  const quadCount = (nu - 1) * (nv - 1) * 2
  const indices = new Uint32Array(quadCount * 6)
  let cursor = 0

  for (let s = 0; s < 2; s++) {
    const base = s * perShell
    const front = s === 0
    for (let i = 0; i < nu - 1; i++) {
      for (let j = 0; j < nv - 1; j++) {
        const a = base + i * nv + j
        const b = base + i * nv + j + 1
        const c = base + (i + 1) * nv + j
        const d = base + (i + 1) * nv + j + 1

        if (front) {
          // Winding matches cross(dP/dv, dP/du), the base normal in the shader.
          indices[cursor++] = a
          indices[cursor++] = b
          indices[cursor++] = c
          indices[cursor++] = b
          indices[cursor++] = d
          indices[cursor++] = c
        } else {
          // Back shell faces the opposite way, so reverse the winding.
          indices[cursor++] = a
          indices[cursor++] = c
          indices[cursor++] = b
          indices[cursor++] = b
          indices[cursor++] = c
          indices[cursor++] = d
        }
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('aParam', new BufferAttribute(params, 2))
  geometry.setAttribute('aShell', new BufferAttribute(shells, 1))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), options.boundingRadius)

  return geometry
}
