/**
 * The brand this bundle was built for, resolved by the bundler.
 *
 * A module specifier rather than a lookup, and the difference is measurable in
 * the output. Selecting a brand out of a registry at run time keeps every brand
 * in the registry reachable, so both palettes, both marks and — once one of
 * them has traced outlines — twenty kilobytes of path data ship in each build,
 * with the unused half sitting there as dead strings. An alias resolved at
 * build time means the other brand's module is never imported at all.
 *
 * The contract is the type; which file satisfies it is `vite.config.ts`'s
 * business. See `resolve.alias` there.
 */
declare module 'virtual:brand' {
  import type { Brand } from './types'
  const brand: Brand
  export default brand
}
