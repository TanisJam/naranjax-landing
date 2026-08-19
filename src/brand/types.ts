import type { Isologo } from './isologo'

/**
 * Everything one deploy of this landing needs in order to be a brand.
 *
 * The list is deliberately short, and what is NOT on it is the point: no
 * layout, no spacing, no card geometry, no feature data. Those were tuned
 * against the artwork and they are the same design in both builds — a brand
 * layer wide enough to change them would be a second site wearing a config
 * file, and the two would drift apart on the first edit.
 *
 * Copy IS on the list, and only the four blocks that carry a voice. A brand is
 * not only a colour: "cuotitas fijas" and "cuotas fijas" say the same thing
 * about the same product and only one of them sounds like Naranja X. The rest
 * of the page — the headings, the figures, the feature list — is identical in
 * both builds and stays in `index.html` where it belongs.
 *
 * Read as a set of measurements rather than preferences. Both palettes here
 * were sampled off a published artefact, and the second one is a hue rotation
 * of the first with every step's lightness and saturation held — which is why
 * the contrast ratios that were verified once stay verified.
 */
export type Brand = {
  readonly id: BrandId

  /** The name as it is written in prose. Not always the name in the logo. */
  readonly name: string

  /**
   * Where this build is served.
   *
   * Absolute, and it has to be: a scraper fetches the share image without a
   * document to resolve a relative path against, so the host is written out
   * per brand rather than inferred.
   */
  readonly origin: string

  readonly title: string
  readonly description: string
  readonly shareImageAlt: string

  readonly copy: Copy

  readonly palette: Palette
  readonly card: CardInks

  /**
   * The header's logo, as markup.
   *
   * Markup rather than data because the two brands do not draw their marks the
   * same way — one sets a letter in a tile, the other has outlines — and a
   * schema general enough to express both would express neither well.
   */
  readonly lockup: string

  /** A square icon at the given ground colour: favicon, manifest, home screen. */
  readonly icon: (ground: string) => string

  /**
   * The line in the footer.
   *
   * Per brand and not shared, because one of these builds carries a real
   * company's marks and owes the reader a sentence saying so.
   */
  readonly disclaimer: string
}

export type BrandId = 'mandarinax' | 'naranjax'

/**
 * The four blocks of the page written in the brand's own voice.
 *
 * Four rather than all of it, and the line is where register lives. Both brands
 * sell the same account with the same three figures under the same headings; a
 * diminutive, a reassurance and a rhythm are what tell them apart, so those are
 * the sentences that travel with the brand and nothing else does.
 */
export type Copy = {
  /** The claim, over the fold. */
  readonly headline: string
  /** The line under it. */
  readonly lede: string
  /** How the loan is described. */
  readonly loans: string
  /** The closing pitch, above the footer. */
  readonly closing: string
}

/**
 * Two inks and the ramp one of them is taken down to.
 *
 * The `ink` ramp is the second ink pulled to near-black at constant hue, and
 * that is the choice the whole page rests on: a grey page with an accent on it
 * is a page with an accent colour, while a page whose own black carries the
 * brand's hue IS the brand. Nobody sees the tint; everybody sees that the page
 * is not generic.
 *
 * Steps are named for the Tailwind scale they land on, and 500 is missing in
 * both palettes because nothing on the page ever needed it.
 */
export type Palette = {
  readonly accent: string
  readonly accentBright: string
  /** The second ink at full strength — the one the ramp is derived from. */
  readonly ground: string
  readonly ink: {
    readonly 950: string
    readonly 900: string
    readonly 800: string
    readonly 700: string
    readonly 600: string
    readonly 400: string
    readonly 300: string
    readonly 200: string
  }
}

/**
 * The card's own colours and how its mark is printed.
 *
 * Separate from `palette` on purpose. A card body is a pigmented plastic
 * photographed under light and an ink is a screen value, and the two only agree
 * when a brand happens to state its colour on a card. Where a brand publishes
 * them separately they are two different measurements.
 */
export type CardInks = {
  /** The front body. */
  readonly front: string
  /** The back body: the same pigment under a different finish, a shade heavier. */
  readonly back: string
  readonly wordmark: CardWordmark
}

/**
 * How the brand's name is printed on the card.
 *
 * Two shapes because there are two honest answers. A brand with no vector
 * original sets its name in type; a brand with outlines prints the outlines,
 * and printing a name in type when the real mark exists would be the one thing
 * a card is least free to do.
 */
export type CardWordmark =
  | {
      readonly kind: 'type'
      readonly text: string
      readonly font: string
      readonly tracking: number
      /** Set beneath the mark, at the mark's left. */
      readonly subBrand: string
    }
  | {
      readonly kind: 'outline'
      readonly logo: Isologo
      readonly inks: LogoInks
      /** Cap height on the card texture, in its own pixels. */
      readonly capHeight: number
      readonly subBrand: string
    }

/**
 * One ink per group of the mark, painted in the order they are listed.
 *
 * `counter` is optional because it OVERPRINTS rather than fills a gap: leaving
 * it out gives a solid single-colour X, which is the only thing a dark ground
 * or a sixteen-pixel favicon can actually show. See `isologo.ts`.
 */
export type LogoInks = {
  readonly letters: string
  readonly mark: string
  readonly counter?: string
}
