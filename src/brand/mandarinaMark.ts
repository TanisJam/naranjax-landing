/**
 * The MandarinaX mark — an X in a rounded tile — and the name it goes with.
 *
 * ITS OWN MODULE BECAUSE TWO DIFFERENT THINGS PRINT IT, and only one of them is
 * the MandarinaX brand. The other is the card-only view: `?card` strips this
 * landing to the piece for a technical demo, and a technical demo has no
 * business carrying a real company's trademark on the artwork while somebody
 * screen-shares it. So that view drops whatever mark the build was made with
 * and prints this name instead — in the Naranja X build too, which is exactly
 * the case a constant living inside `mandarinax.ts` could not serve without
 * dragging the whole of that brand's palette and copy into the other bundle.
 *
 * See `src/brand/index.ts` for the substitution and `index.html` for the flag.
 *
 * What this module deliberately is NOT is a brand. There is no palette here and
 * there must not be one: `?card` keeps every colour of the build it is asked
 * for — the body of the card, its light, the plancha behind it — and changes
 * one word. A second palette on this side would make it a third deploy.
 */

/**
 * The X, as a path in a 64-unit square.
 *
 * Drawn rather than set, because a square icon has to hold its shape at sixteen
 * pixels and a glyph handed to whatever font the host resolves will not. Its
 * proportions were taken off the header's own tile.
 */
export const MANDARINA_X =
  'M17.5 15h9.9l5.1 8.4L37.6 15h9.9L37.2 31.7 48 49h-9.9l-5.6-9L26.9 49H17l10.9-17.3z'

/** The name as it is written — in prose, on the card, and in a tab. */
export const MANDARINA_NAME = 'MandarinaX'

/**
 * The mark in its tile, at the given two inks.
 *
 * `ground` is the colour the X is knocked out IN, not the colour behind the
 * tile: the tile is the accent and the letter is the hole. Same shape at every
 * size it is asked for, which is the whole reason the tile is drawn at 64 and
 * scaled rather than authored per size.
 */
export const mandarinaTile = (accent: string, ground: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${MANDARINA_NAME}">` +
  `<rect width="64" height="64" rx="14" fill="${accent}"/>` +
  `<path d="${MANDARINA_X}" fill="${ground}"/></svg>`
