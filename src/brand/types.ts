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

  readonly page: Page

  readonly palette: Palette
  readonly shape: Shape
  readonly font: Typeface
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
 * The parts of the page that are LISTS rather than sentences.
 *
 * Separate from `Copy` for a reason that is not taste: `Copy` is four strings
 * and the build substitutes them into `{{tokens}}` one for one. These are
 * repeated structures, and a structure cannot be a token — so each of them is
 * rendered to markup at build time by `blocks.ts` and substituted the same way
 * the lockup is. Which is also why they belong on the brand at all: a landing
 * whose navigation, figures and footer were hard-coded would be one brand's
 * landing with another brand's paint on it.
 *
 * They stay OUT of the layout. Every one of these is content — words, figures,
 * destinations — and the arrangement they land in is the same design in both
 * builds. See `index.html`.
 */
export type Page = {
  /** The header's links, in order. The call to action is `navCta`. */
  readonly nav: readonly Link[]
  /** What the header's pill says, and where it goes. */
  readonly navCta: Link
  /**
   * The claim over the card, broken into the lines it is meant to break at.
   *
   * Three, and they arrive one after another — which is why the break is
   * authored rather than left to the measure. A claim that rewraps on a
   * narrower viewport is a claim whose rhythm was never the point.
   */
  readonly heroLines: readonly string[]
  /** The four figures the brand is judged on, as cards. */
  readonly stats: readonly Stat[]
  /** The badges orbiting the dashed ring, in the order they are laid out. */
  readonly orbit: readonly Badge[]
  /**
   * The words that drift across the closing plancha.
   *
   * Set in outline at eighty pixels, so these are read as texture before they
   * are read as words. Short ones survive that; a sentence does not.
   */
  readonly marquee: readonly string[]
  /** The line and the button of the footer's banner. */
  readonly download: { readonly line: string; readonly cta: string }
  /** The footer's link columns, minus the social one, which is drawn. */
  readonly footer: readonly FooterColumn[]
}

export type Link = {
  readonly label: string
  readonly href: string
}

/**
 * One figure, on its own card.
 *
 * Split into three because the reference sets them at three sizes on one line:
 * the number is the shout, the unit rides small beside it, and the sentence
 * under both is what the number is OF. Collapsing them into a string would put
 * that typography in the content.
 */
export type Stat = {
  /** The number itself, large. */
  readonly value: string
  /** The word that rides small beside it — «millones», «mil». Optional. */
  readonly unit?: string
  /**
   * What the figure counts.
   *
   * Optional only because the last card in the reference row has no sentence at
   * all: it says who the company belongs to and then prints that company's
   * name, and a card built to carry a lockup has nothing to put here. Every
   * card that states a figure states what it is of.
   */
  readonly label?: string
  /**
   * A name, set like one, in place of the sentence.
   *
   * The reference closes its row with «Somos parte del» over a logo. This is
   * that line, and it is deliberately NOT the other company's mark: reproducing
   * a third party's logotype inside a demo nobody at either company asked for
   * is the one thing on this page that would stop being a quotation.
   */
  readonly mark?: string
  /**
   * The drawing in the bottom corner, as an inline `<svg>`. Decorative.
   *
   * Every card in the reference carries a small illustration down there and the
   * row reads as five objects because of it. See the note in `glyphs.ts` for
   * what stands in for artwork this page does not have.
   */
  readonly motif?: string
  /**
   * The card's illustration, as a file in `brand-assets/<id>/`. Decorative.
   *
   * WHERE THIS BEATS `motif` AND WHERE IT DOES NOT. A glyph is one path in
   * `currentColor` and it costs nothing to give a brand a set of them; it is
   * what a card falls back to. Artwork is the real thing the reference puts
   * down there — a person, two phones, a storefront — and no amount of drawing
   * with one ink stands in for it.
   *
   * So a card takes one or the other, never both, and `art` wins. A brand with
   * no artwork keeps its glyphs and the row still reads as five objects.
   */
  readonly art?: string
  /**
   * Which of the four grounds this card takes.
   *
   * A role rather than a colour: every one of them is one of the brand's two
   * inks mixed into white by a fixed amount, so a brand that changes its inks
   * gets four new tints for free and never a fifth colour somebody picked.
   */
  readonly tint: 'accent-soft' | 'accent' | 'ground-soft' | 'ground'
}

/** A badge on the dashed ring: a drawn glyph and the word it stands for. */
export type Badge = {
  /** The glyph, as an inline `<svg>` sized by its container. */
  readonly icon: string
  /** Read out instead of the drawing, and never shown. */
  readonly label: string
  /** Which ink the disc takes. */
  readonly tint: 'accent' | 'ground'
}

export type FooterColumn = {
  readonly title: string
  readonly links: readonly Link[]
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
  readonly surface: Surface
}

/**
 * The page's own colours, named by ROLE rather than by value.
 *
 * This exists because the two brands do not agree on whether the page is dark.
 * MandarinaX is a tinted near-black with the ink ramp showing through; the
 * Naranja X demo follows that company's own site, which is white with violet
 * planchas laid into it. The markup cannot say `bg-ink-950` and mean both, so
 * it says `bg-surface` and each brand answers.
 *
 * The `ink` ramp above did not go away and could not: it is what the hero, the
 * card render and the layer overlay are built on, and all three of those are
 * dark in both builds — a card photographed against white is a different
 * photograph. So the ramp keeps the hero and this keeps the page under it.
 *
 * Every pairing here was measured, not chosen. On the Naranja X values the body
 * copy runs 15.9:1, the muted step 8.6:1, white on the violet plancha 12.7:1
 * and the call to action 12.7:1 — which is why `accentInk` is the violet and
 * not the orange, exactly as that site's own `--company-link-color` says. The
 * published orange is 3.3:1 on white: real as a graphic, illegible as a word.
 */
export type Surface = {
  /** The page ground. */
  readonly page: string
  /** The alternating plancha — a half-step off `page`, never a third colour. */
  readonly soft: string
  /** The brand's own plancha, laid in at full strength. */
  readonly strong: string
  /** Body copy on `page` and `soft`. */
  readonly on: string
  /** Secondary copy on `page` and `soft`. */
  readonly onMuted: string
  /** Copy on `strong`. */
  readonly onStrong: string
  /** Secondary copy on `strong`. */
  readonly onStrongMuted: string
  /** Hairlines and outlines on `page` and `soft`. */
  readonly line: string
  /**
   * What the figure cards' tints are mixed INTO.
   *
   * Its own value rather than `page`, and the dark build is why. Four cards
   * tinted by mixing an ink into the page ground works perfectly on white —
   * a sixth of the orange is the reference's own peach — and on a near-black
   * page the same sixth is a card you cannot see: measured, `#f37d06` at 16%
   * into `#220b0a` lands on `#431d09`, which is the page with a rumour on it.
   *
   * So the base is stated. On the white build it is white and the mixes are
   * the reference's. On the dark one it is a lifted step of the same ink ramp,
   * which keeps the cards dark — as that page is — while leaving them far
   * enough above the ground to read as four objects instead of one shadow.
   */
  readonly tintBase: string
  /** The accent at a strength that survives as small type on `page`. */
  readonly accentInk: string
  /** The call to action's fill, and what is printed on it. */
  readonly cta: string
  readonly ctaBright: string
  readonly onCta: string
}

/**
 * The two radii the page is drawn with.
 *
 * On the list for the same reason the surfaces are: Naranja X rounds to 40px
 * and it is not a detail, it is most of what the eye reads as that brand before
 * it has read a word. MandarinaX keeps the 8px it was drawn at. Everything else
 * about the layout — the measure, the rhythm, the order of the blocks — is the
 * same design in both builds and stays out of here.
 */
export type Shape = {
  /** Calls to action and pills. */
  readonly cta: string
  /** Blocks, cards and panels. */
  readonly block: string
}

/**
 * The typeface, and the stylesheet that serves it.
 *
 * Per brand because a voice is not only words. Naranja X sets everything in
 * Gibson, which is licensed and not ours to serve, so this build sets the
 * nearest thing with the same humanist-geometric build and the same tall
 * x-height and says so here rather than pretending.
 */
export type Typeface = {
  /** The value `--font-sans` is restated to. */
  readonly stack: string
  /** The `<link>` tags that load it, as markup. */
  readonly link: string
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
