import { mandarinax } from './mandarinax'
import { naranjax } from './naranjax'
import type { Brand, BrandId } from './types'

export const BRANDS: Readonly<Record<BrandId, Brand>> = { mandarinax, naranjax }

export const DEFAULT_BRAND: BrandId = 'mandarinax'

/**
 * Resolves a brand id to a brand, or refuses.
 *
 * Deliberately not a fallback. A typo in a deploy's environment would otherwise
 * publish the wrong brand under the right domain and nothing would look broken
 * enough to notice — which is the failure this is worth a build error to avoid.
 * Absent is the one input that IS allowed, and it means the default.
 *
 * Node and the browser both come through here: the build reads the environment
 * to write the document's head and the icons, and the app reads it to draw the
 * card. Which is why this file, unlike its neighbour, touches no globals.
 */
export function resolveBrand(id: string | undefined | null): Brand {
  if (id === undefined || id === null || id === '') return BRANDS[DEFAULT_BRAND]
  if (id in BRANDS) return BRANDS[id as BrandId]
  throw new Error(
    `Unknown brand "${id}". Set VITE_BRAND to one of: ${Object.keys(BRANDS).join(', ')}.`,
  )
}
