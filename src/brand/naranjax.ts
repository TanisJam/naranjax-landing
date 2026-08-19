import { LOCKUP, MARK } from './isologo'
import { isologoSvg, squareIcon } from './svg'
import type { Brand } from './types'

const ACCENT = '#ff5000'
const VIOLET = '#50007f'
const INK_950 = '#190a22'

/**
 * Naranja X, as a concept demo.
 *
 * The palette is not an interpretation. The published isologo is an 8-bit
 * colormapped PNG, so its PLTE chunk states the two inks exactly, and the ramp
 * below is that violet taken down to near-black at a constant 277.7° hue.
 *
 * Every one of these numbers already existed in this repository's history: the
 * landing was built against this palette first and rotated to MandarinaX's red
 * later, step by step, holding each step's lightness and saturation. So this is
 * a restoration rather than a new authoring — including the contrast that was
 * measured on it, 6.92:1 on the calls to action and 10.7:1 on body copy.
 *
 * WHAT DOES NOT CHANGE is the claim. "Exprimí cada peso" was written for a
 * brand named after a citrus and it lands on this one for exactly the same
 * reason, so the page keeps it and the rebrand costs the copy nothing.
 */
export const naranjax: Brand = {
  id: 'naranjax',
  // "Naranja X" in prose, "NaranjaX" in the logo — the brand writes it both
  // ways and this is the one that belongs in a sentence.
  name: 'Naranja X',
  origin: 'https://naranjax-landing.vercel.app',

  title: 'Naranja X — Qué lindo es poder',
  description:
    'Manejá tu platita desde una sola app: pagá, transferí, hacé rendir tus pesos y mucho más.',
  shareImageAlt:
    'La tarjeta de crédito Naranja X sobre el fondo de la marca, bajo el claim «Qué lindo es poder».',

  // Restored from this repository's own history, not rewritten. Before the
  // MandarinaX rebrand this landing carried Naranja X's copy, taken from their
  // site — "cuotitas fijas", "estar tranqui", "así de simple y fácil". That
  // register is the brand as much as the violet is, and a demo of somebody's
  // landing that speaks in a voice they never use is a demo of somebody else's.
  copy: {
    headline: 'Qué lindo es poder',
    lede: 'Manejá tu platita desde una sola app. Pagá, transferí, hacé rendir tus pesos y mucho más.',
    loans:
      'Sacalo desde la app, se acredita al instante en tu cuenta y lo devolvés en cuotitas fijas. Ideal para cancelar esa deuda y estar tranqui.',
    closing:
      'Descargá la app y automáticamente tenés tu cuenta gratis para manejar tus pesos y dólares desde un solo lugar. Así de simple y fácil.',
  },

  palette: {
    accent: ACCENT,
    accentBright: '#ff7833',
    ground: VIOLET,
    ink: {
      950: INK_950,
      900: '#240f30',
      800: '#351847',
      700: '#4d2664',
      600: '#6a3e84',
      400: '#ad97ba',
      300: '#cdbdd6',
      200: '#e8deed',
    },
  },

  card: {
    front: ACCENT,
    back: '#db3900',
    wordmark: {
      kind: 'outline',
      logo: LOCKUP,
      // The card is the one surface in this build that can state the real
      // two-ink split, and that is the whole argument for putting the traced
      // outlines here instead of type. Orange on an orange body is invisible,
      // so the published orange becomes white and the violet stays violet —
      // the mark's construction survives, its colours could not have.
      inks: { letters: '#ffffff', mark: '#ffffff', counter: VIOLET },
      capHeight: 55,
      subBrand: 'Crédito',
    },
  },

  // Reversed, because the page is violet-black. The published lockup needs a
  // white ground: its violet arm drawn on this one is a hole in the X. So the
  // letters go white and the X goes solid orange, which is the reversal the
  // brand itself uses on dark — and the split gets its say on the card.
  lockup: isologoSvg(
    LOCKUP,
    { letters: '#fafafa', mark: ACCENT },
    { title: 'Naranja X', attrs: 'class="h-7 w-auto"' },
  ),

  // The same construction the other brand's icon uses: the accent as the tile,
  // the mark punched out of it in the page's own near-black. The two-ink split
  // does not come along, and it could not — at sixteen pixels the violet arm is
  // two pixels wide, and two pixels of #50007f against #ff5000 is a smudge
  // rather than a second colour.
  icon: (ground) =>
    squareIcon(MARK, { letters: ground, mark: ground }, {
      ground: ACCENT,
      title: 'Naranja X',
    }),

  // This build puts a real company's mark on a landing that company did not
  // make, and the footer is where that gets said plainly rather than left for
  // the reader to work out.
  disclaimer:
    'Concepto no oficial y sin relación con Naranja X. Las marcas y el logotipo pertenecen a sus titulares y se reproducen solo con fines ilustrativos. Los datos y las cifras son de demostración y no constituyen una oferta comercial.',
}

/** Also the default export, which is how `virtual:brand` reaches exactly one of these. */
export default naranjax
