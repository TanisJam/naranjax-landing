import active from 'virtual:brand'
import type { Brand } from './types'

export type { Brand, BrandId, CardInks, CardWordmark, LogoInks, Palette } from './types'

/**
 * The brand this bundle was built for.
 *
 * Build time, not run time, and that is the whole design. The document's title,
 * its canonical URL and its share card all have to be in the HTML before any
 * script runs — a scraper reads the markup and leaves — so the brand cannot be
 * something the page decides about itself once it is open. One environment
 * variable per deploy, two deploys, one `main`.
 *
 * Deliberately NOT re-exporting the registry alongside it. The registry names
 * every brand, so anything importing this module would reach both, and the
 * bundle would carry the palette, the mark and the traced outlines of a brand
 * this deploy never shows. `virtual:brand` resolves to one file; the other is
 * never imported. Only the build itself, which has to know every brand in order
 * to validate the one it was asked for, reaches `./registry` directly.
 */
export const brand: Brand = active
