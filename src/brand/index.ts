import active from 'virtual:brand'
import { MANDARINA_NAME, mandarinaTile } from './mandarinaMark'
import type { Brand, CardWordmark } from './types'

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
export const brand: Brand = cardOnly() ? unbranded(active) : active

/**
 * Whether the document was asked for as the card alone — `?card`.
 *
 * Read off `<html>`, which the head already decided, rather than parsing the
 * query string a second time. Two readings of one flag is two answers waiting
 * to disagree, and the one written on the element is the one the stylesheet
 * has already acted on. See the note in `index.html`.
 */
function cardOnly(): boolean {
  return document.documentElement.dataset.view === 'card'
}

/**
 * The same brand with somebody else's trademark taken off it.
 *
 * WHAT THIS IS FOR. `?card` exists so the piece can be shown on its own in a
 * technical talk, and the Naranja X build puts that company's traced isologo on
 * the plastic. Showing a real bank's mark on a card in a demo about WebGL is
 * borrowing a name to make a point that has nothing to do with it — so the view
 * that strips the landing strips the mark too, and prints MandarinaX instead.
 *
 * WHAT IT DELIBERATELY LEAVES ALONE is everything that is not a name. The
 * palette, the plancha, the body of the card, its light, the artwork on the
 * nine layers, the claim over the hero: all of it stays exactly as the build
 * made it. One word changes, which is the whole request — a second palette here
 * would make this a third deploy pretending to be a query parameter.
 *
 * THE MARK CANNOT SIMPLY BE RENAMED, which is why this returns a new wordmark
 * rather than a new string. Naranja X's card carries traced OUTLINES — letters
 * and a violet counter, geometry rather than text — and there is no field in
 * them that says "Naranja". A brand with no vector original sets its name in
 * type, so that is what the demo does, at the same size and tracking the
 * MandarinaX card is already drawn with.
 *
 * Type in a generic sans rather than in the build's own face, and that is not
 * an oversight. The Naranja X build sets everything in Gibson, which is a
 * self-hosted woff2 — and the card texture is drawn once, into a canvas, at
 * module evaluation. A face that has not finished loading by then is baked into
 * the plastic as whatever the host fell back to, permanently, with nothing in
 * the frame to say so. The generic stack is the one that cannot lose that race.
 */
function unbranded(base: Brand): Brand {
  const wordmark: CardWordmark = {
    kind: 'type',
    text: MANDARINA_NAME,
    font: '600 76px sans-serif',
    tracking: -1,
    // The sub-brand is what the card IS rather than who issued it, so it says
    // the same thing under either name and travels unchanged.
    subBrand: base.card.wordmark.subBrand,
  }

  return {
    ...base,
    name: MANDARINA_NAME,
    // Just the name. The build's own title carries a claim written for the
    // brand being taken off — «Qué lindo es poder» is Naranja X's line, and a
    // tab that kept it while the card no longer says so would be the one place
    // left contradicting the artwork.
    title: MANDARINA_NAME,
    card: { ...base.card, wordmark },
    icon: (ground) => mandarinaTile(base.palette.accent, ground),
  }
}
