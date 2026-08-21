import { CARD, PHONE, SPARK, STORE, TAP } from './glyphs'
import { MANDARINA_NAME, mandarinaTile } from './mandarinaMark'
import type { Brand } from './types'

const ACCENT = '#f37d06'
const INK_950 = '#220b0a'

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
  name: MANDARINA_NAME,
  origin: 'https://mandarina-x.vercel.app',

  title: 'MandarinaX — Exprimí cada peso',
  description:
    'Toda tu plata en una sola app: pagá, transferí, hacé rendir tus pesos y sacá tu tarjeta sin costo.',
  shareImageAlt:
    'La tarjeta de crédito MandarinaX sobre el fondo de la marca, bajo el claim «Exprimí cada peso».',

  copy: {
    headline: 'Exprimí cada peso',
    lede: 'Toda tu plata en una sola app. Pagá, transferí y hacé rendir tus pesos todos los días del año.',
    loans:
      'Sacalo desde la app, se acredita al instante en tu cuenta y lo devolvés en cuotas fijas. Sabés desde el primer día cuánto vas a pagar.',
    closing:
      'Descargá la app y ya tenés tu cuenta gratis para manejar pesos y dólares desde un solo lugar. Sin trámites, sin sucursal y sin letra chica.',
  },

  // The same slots the other brand fills, answered in this one's voice and with
  // this one's numbers. The figures are the three the page already stated under
  // the pitch — cost, yield, services — plus the one it always implied, and
  // they moved onto cards because the cards are where the page now says them.
  page: {
    nav: [
      { label: 'Cuenta', href: '#funciones' },
      { label: 'Préstamos', href: '#prestamos' },
      { label: 'Beneficios', href: '#beneficios' },
    ],
    navCta: { label: 'Abrí tu cuenta', href: '#funciones' },

    heroLines: ['Exprimí', 'cada peso', 'que tenés'],

    // Five, on the same alternating grounds the other build uses, because the
    // arrangement is the layout's and the figures are the brand's. The last one
    // is a claim rather than a parent company: this brand does not have one,
    // and a card that said it did would be the only untrue line on the page.
    stats: [
      {
        value: '$0',
        label: 'de apertura y de mantenimiento, siempre.',
        tint: 'accent-soft',
        motif: CARD,
      },
      {
        value: '18%',
        unit: 'TNA',
        label: 'sobre el saldo, todos los días del año.',
        tint: 'ground',
        motif: SPARK,
      },
      {
        value: '+4.000',
        label: 'servicios para pagar desde la app.',
        tint: 'accent',
        motif: STORE,
      },
      { value: '24/7', label: 'para transferir, pagar y cobrar.', tint: 'ground', motif: PHONE },
      {
        value: 'Sin sucursales',
        label: 'toda la cuenta vive en tu teléfono.',
        tint: 'accent-soft',
        motif: TAP,
      },
    ],

    marquee: [
      'PAGAR',
      'TRANSFERIR',
      'AHORRAR',
      'INVERTIR',
      'COBRAR',
      'PRÉSTAMOS',
      'RENDIMIENTOS',
      'BENEFICIOS',
    ],

    download: { line: 'Descargá la app y exprimí cada peso', cta: 'Descargar app' },

    footer: [
      {
        title: 'Queremos ayudarte',
        links: [
          { label: 'Contacto', href: '#' },
          { label: 'Centro de seguridad', href: '#' },
          { label: 'Preguntas frecuentes', href: '#' },
          { label: 'Información al usuario financiero', href: '#' },
        ],
      },
      {
        title: 'Sobre MandarinaX',
        links: [
          { label: 'Quiénes somos', href: '#' },
          { label: 'Sustentabilidad', href: '#' },
          { label: 'Trabajá con nosotros', href: '#' },
          { label: 'Prensa', href: '#' },
        ],
      },
      {
        title: 'Potenciá tu plata',
        links: [
          { label: 'Tarjeta de crédito', href: '#' },
          { label: 'Billetera virtual', href: '#' },
          { label: 'Préstamos online', href: '#' },
          { label: 'Costos, comisiones y límites', href: '#' },
        ],
      },
    ],
  },

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

    // Read these as a restatement, not a new decision: every value is a step of
    // the ramp above, chosen so the page it produces is the page this brand
    // already had. The surface layer exists because the other brand's site is
    // white; here it hands back the tinted near-black that was always there.
    surface: {
      page: INK_950,
      soft: '#30100f',
      strong: '#30100f',
      on: '#fafafa',
      onMuted: '#d6bebd',
      onStrong: '#fafafa',
      onStrongMuted: '#d6bebd',
      line: '#471a18',
      // A lifted step of the ramp rather than the page ground, so the figure
      // cards stay dark and still read as four separate objects. See
      // `tintBase` in `src/brand/types.ts`.
      tintBase: '#4a1c18',
      accentInk: ACCENT,
      cta: ACCENT,
      ctaBright: '#fa9632',
      onCta: INK_950,
    },
  },

  // The radii the landing was drawn at.
  shape: { cta: '0.5rem', block: '1rem' },

  font: {
    stack: "'Rubik', ui-sans-serif, system-ui, -apple-system, sans-serif",
    link:
      '<link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
      '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
      '    <link\n' +
      '      href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&display=swap"\n' +
      '      rel="stylesheet"\n' +
      '    />',
  },

  card: {
    front: ACCENT,
    back: '#d76302',
    wordmark: {
      kind: 'type',
      text: MANDARINA_NAME,
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

  // The tile lives in its own module rather than here, and the reason is the
  // card-only view: `?card` prints this name on the artwork in EITHER build,
  // so the mark has to be reachable without importing this brand's palette and
  // copy along with it. See `src/brand/mandarinaMark.ts`.
  icon: (ground) => mandarinaTile(ACCENT, ground),

  disclaimer:
    'Pieza de demostración. Los datos y las cifras son ilustrativos y no constituyen una oferta comercial.',
}

/** Also the default export, which is how `virtual:brand` reaches exactly one of these. */
export default mandarinax
