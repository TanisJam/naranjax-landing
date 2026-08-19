import type { Brand } from './types'

const ACCENT = '#f37d06'
const INK_950 = '#220b0a'

/**
 * The X the header draws, as a path.
 *
 * Drawn rather than set, because a square icon has to hold its shape at sixteen
 * pixels and a glyph handed to whatever font the host resolves will not. Its
 * proportions were taken off the header's own tile.
 */
const X = 'M17.5 15h9.9l5.1 8.4L37.6 15h9.9L37.2 31.7 48 49h-9.9l-5.6-9L26.9 49H17l10.9-17.3z'

/**
 * MandarinaX, the brand this landing was designed against.
 *
 * The palette is the reference card's own two inks and a ramp derived from the
 * second one. It is a hue rotation of the Naranja X palette holding every
 * step's lightness and saturation, which is what let the contrast relationships
 * survive the change unmeasured: 6.92:1 on the calls to action, 10.7:1 on body
 * copy, 7.16:1 on the small print.
 */
export const mandarinax: Brand = {
  id: 'mandarinax',
  name: 'MandarinaX',
  origin: 'https://mandarina-x.vercel.app',

  title: 'MandarinaX — Exprimí cada peso',
  description:
    'Toda tu plata en una sola app: pagá, transferí, hacé rendir tus pesos y sacá tu tarjeta sin costo.',
  shareImageAlt:
    'La tarjeta de crédito MandarinaX sobre el fondo de la marca, bajo el claim «Exprimí cada peso».',

  palette: {
    accent: ACCENT,
    accentBright: '#fa9632',
    ground: '#db1811',
    ink: {
      950: INK_950,
      900: '#30100f',
      800: '#471a18',
      700: '#642826',
      600: '#84403e',
      400: '#ba9897',
      300: '#d6bebd',
      200: '#eddfde',
    },
  },

  card: {
    front: ACCENT,
    back: '#d76302',
    wordmark: {
      kind: 'type',
      text: 'MandarinaX',
      font: '600 76px sans-serif',
      tracking: -1,
      subBrand: 'Crédito',
    },
  },

  // The mark and the wordmark, with the X tinted in both. That tint is a UI
  // affordance rather than the logo, which is why the card does not repeat it.
  lockup: `
            <span
              aria-hidden="true"
              class="grid size-6 place-items-center rounded-md bg-brand-accent text-sm leading-none font-bold text-ink-950"
            >
              X
            </span>
            <span class="text-xl font-semibold tracking-tight">
              <span class="text-neutral-50">mandarina</span><span class="text-brand-accent">X</span>
            </span>`,

  icon: (ground) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="MandarinaX">` +
    `<rect width="64" height="64" rx="14" fill="${ACCENT}"/>` +
    `<path d="${X}" fill="${ground}"/></svg>`,

  disclaimer:
    'Pieza de demostración. Los datos y las cifras son ilustrativos y no constituyen una oferta comercial.',
}

/** Also the default export, which is how `virtual:brand` reaches exactly one of these. */
export default mandarinax
