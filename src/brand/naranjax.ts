import { SHIELD, SPARK, TAP } from './glyphs'
import { LOCKUP, MARK } from './isologo'
import { isologoSvg, squareIcon } from './svg'
import type { Brand } from './types'

// Both of these are quoted from that company's own stylesheet rather than
// sampled off an image now — see the note on `palette` below. The accent moved
// by one unit in red when it stopped being a sample and became a quotation.
const ACCENT = '#fe5000'
const VIOLET = '#50007f'
const INK_950 = '#190a22'

/** The lilac their site lays behind an alternating block. */
const SOFT = '#f2ecf6'

/** The near-black they set body copy in. Not this page's ink — theirs. */
const TEXT = '#252525'

/**
 * The face itself, served off this origin, under the licence this project
 * holds. Gibson is Rod McDonald's, published by Canada Type.
 *
 * IT USED TO BE LINKED STRAIGHT OFF THAT COMPANY'S CDN, and that one line was
 * two faults.
 *
 * Cloudflare sits in front of `static.naranjax.com` and answers a request that
 * does not look like a browser's with a 403 and eight hundred kilobytes of
 * challenge page. The font parser reads the first four bytes of that page as a
 * version number and rejects it: `invalid sfntVersion: 1008813135`, which is
 * 0x3C21444F, which is `<!DO`.
 *
 * And the fourth weight never existed. `Gibson-Heavy.otf` answers 200 with a
 * 164-byte empty document, and so do Bold, Book and Light — three files are all
 * that host has ever carried, and their own stylesheet declares a face that is
 * not among them. The `900` here was inherited along with it.
 *
 * So: three faces, converted to woff2 — 226KB of .otf down to 73KB — sitting in
 * `brand-assets/naranjax/`, which is per brand, so the other build never
 * carries a byte of them.
 *
 * SEMIBOLD COVERS 600 THROUGH 900 rather than 600 alone. The page asks for 700
 * six times and there is no 700 to answer with. A range lands those on real
 * SemiBold outlines; without it the request either falls out of the family
 * altogether or the browser smears a synthetic bold over the top, and both of
 * those are visible next to the weights that did resolve.
 *
 * `swap` still, and it costs nothing now: the files are on this origin, so all
 * it covers is the first paint before they arrive. Figtree stays underneath as
 * the metric fallback.
 */
const GIBSON = [
  ['Gibson', '400', 'Gibson-Regular'],
  ['Gibson', '500', 'Gibson-Medium'],
  ['Gibson', '600 900', 'Gibson-SemiBold'],
]
  .map(
    ([family, weight, file]) =>
      `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;` +
      `src:url(/${file}.woff2) format('woff2')}`,
  )
  .join('')

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

  // Taken from Naranja X's careers site, which is the one place the company
  // writes at length in its own voice — and that voice is not the product
  // voice. The app speaks to you ("sacalo desde la app"); careers speaks AS the
  // company, in the first person plural, and leans on one figure of speech hard
  // enough that it is worth naming: the anaphora. "Estamos acá para crear
  // productos que sorprendan. Estamos acá para revolucionar la experiencia
  // financiera." That repetition is the register, so a line here carries it.
  //
  // The claim above the fold does NOT change. "Qué lindo es poder" is the
  // brand's own and it is a claim, not a paragraph; what changes underneath is
  // who is talking. The figures — nine million people, the second most used app
  // in the country, two friends and a cardboard card — are that site's own
  // sentences, kept close because paraphrasing them is what would make this
  // read like an imitation instead of a demo.
  copy: {
    headline: 'Qué lindo es poder',
    lede: 'Más de 9 millones de personas nos eligen todos los días para transformar sus finanzas. Somos mucho más que una fintech: una plataforma para pagar, cobrar, ahorrar e invertir desde un solo lugar.',
    loans:
      'Estamos acá para que pedir plata no sea un trámite. Lo sacás desde la app, se acredita al instante y lo devolvés en cuotitas fijas: sabés desde el primer día cuánto vas a pagar.',
    closing:
      'Nuestra historia empezó con dos amigos, una tarjeta de cartón y una forma diferente de hacer negocios: la calidez y la cercanía con cada cliente ante todo. Hoy nuestra app es la 2da más usada de la Argentina, y sigue siendo la misma idea.',
  },

  // Measured off their careers site rather than composed. The nav is three
  // links and a filled pill; the claim is three short lines that arrive one
  // after another; the figures are the ones that site states about itself; the
  // ribbon is a handful of words set in outline. What changes here is only
  // which words — the arrangement is in `index.html` and is the same page for
  // either brand.
  page: {
    nav: [
      { label: 'Cuenta', href: '#funciones' },
      { label: 'Préstamos', href: '#prestamos' },
      { label: 'Beneficios', href: '#beneficios' },
    ],
    navCta: { label: 'Abrí tu cuenta', href: '#funciones' },

    // Their own opening, kept at its own cadence: an interjection, a verb, and
    // the promise. "¡Ey!, vení a impactar en millones de personas" is the
    // careers hero, and this is the same sentence pointed at the account.
    heroLines: ['¡Ey!, vení a hacer', 'todo con tu plata', 'desde un solo lugar'],

    // The four figures that site publishes about itself, kept as it writes
    // them. Paraphrasing a number is how a demo starts sounding like an
    // imitation instead of a quotation.
    // Five, in their order, in their words, on their grounds — peach, violet,
    // orange, violet, peach. The one thing not taken literally is the decimal
    // point in «+9.5»: this page is set in Spanish, where the separator is a
    // comma, and it is also what lets the figure be counted at all — see the
    // parser in `PageMotion`, which reads a dot as a thousands mark because on
    // this same row `+4.000` means four thousand.
    stats: [
      {
        value: '+9,5',
        unit: 'millones',
        label: 'de clientes.',
        tint: 'accent-soft',
        art: 'art-clientes.png',
      },
      {
        value: 'La segunda',
        label: 'app financiera más usada en Argentina.',
        tint: 'ground',
        art: 'art-app.png',
      },
      {
        value: 'Principal emisor',
        label: 'de tarjetas de crédito en Argentina.',
        tint: 'accent',
        art: 'art-tarjeta.png',
      },
      {
        value: '+150',
        unit: 'mil',
        label: 'comercios utilizan nuestras soluciones de cobro-pago.',
        tint: 'ground',
        art: 'art-comercios.png',
      },
      // Their fifth card is a logo and this one is a line of type. See `mark`
      // in `types.ts`: whose company this is belongs in the quotation, and
      // whose logotype it is does not.
      {
        value: 'Somos parte del',
        mark: 'Grupo Galicia',
        markLogo: 'galicia.svg',
        tint: 'accent-soft',
        art: 'art-nx.png',
      },
    ],

    orbit: [
      { icon: TAP, label: 'Pagá con el celular', tint: 'accent' },
      { icon: SHIELD, label: 'Tu plata protegida', tint: 'accent' },
      { icon: SPARK, label: 'Beneficios todos los días', tint: 'ground' },
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

    download: { line: 'Descargá la app y disfrutá los beneficios', cta: 'Descargar app' },

    // Their own three column headings. The destinations are not theirs and are
    // not pretending to be: this build carries a real company's mark and has no
    // business handing anyone a phone number that nobody answers.
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
        title: 'Sobre Naranja X',
        links: [
          { label: 'Somos Naranja X', href: '#' },
          { label: 'Sustentabilidad', href: '#' },
          { label: 'Trabajá con nosotros', href: '#' },
          { label: 'Inversores', href: '#' },
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

    // The page below the hero, and this is the part that is not a rotation of
    // the other brand's. Naranja X's own site is white with violet planchas laid
    // into it, so this build is too, and the ramp above stops at the hero.
    //
    // `accentInk` is the violet rather than the orange, and that is their call
    // as much as ours: their stylesheet sets `--company-link-color` to this
    // exact violet and keeps the orange for graphics. Measured, the reason is
    // plain — the orange is 3.3:1 on white, which is a mark and not a word.
    surface: {
      page: '#ffffff',
      soft: SOFT,
      strong: VIOLET,
      on: TEXT,
      // Their `--company-secondary-text-color-on-white`, to the digit.
      onMuted: '#4d4d4d',
      onStrong: '#ffffff',
      onStrongMuted: '#e8deed',
      // The lilac taken one step down, so a hairline on white is a hairline and
      // not a rule — there is no grey anywhere on that site and none here.
      line: '#e2d6ea',
      // White, because their page is: the four figure tints are this brand's
      // two inks mixed into it at the fractions their own cards measure.
      tintBase: '#ffffff',
      accentInk: VIOLET,
      cta: VIOLET,
      // Their own `--company-button-bg-light-5-color`.
      ctaBright: '#600098',
      onCta: '#ffffff',
    },
  },

  // Both measured off their careers site rather than inferred from a config
  // variable, and the first one moved because of it. The pill was taken from a
  // `--company-border-radius: 40px` on their Teamtailor job board, which is a
  // different site; their own stylesheet sets `.nx-button` to fifteen pixels on
  // a forty-pixel button, and the button in the screenshot measures a
  // twenty-pixel corner at a scale where its height measures forty. So: not a
  // pill. Cards and panels round to thirty-three.
  shape: { cta: '15px', block: '2.0625rem' },

  // Gibson, which is the face their site actually sets — and after the colour
  // it is the loudest thing on the page. Self-hosted now, off this origin,
  // under the licence this project holds; see `GIBSON` above for the two faults
  // that came with hotlinking their CDN and for why there are three weights and
  // not four. The credit sits in the footer, with the disclaimer.
  //
  // Figtree stays in the stack behind it, and that is not politeness. It is the
  // metric fallback for the swap, and it is what the page lands on if the
  // licence ever has to go — a humanist-geometric with the same tall x-height,
  // rather than whatever the host resolves. Taking Gibson out is deleting one
  // name from one line.
  //
  // Declared as ONE family across its weights rather than as one family per
  // weight, which is how their own stylesheet does it. A family per weight
  // means every rule has to name the right one by hand and a `600` anywhere
  // silently gets the regular; one family means `font-semibold` picks the
  // SemiBold because that is what a weight is for.
  font: {
    stack: "'Gibson', 'Figtree', ui-sans-serif, system-ui, -apple-system, sans-serif",
    link:
      '<link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
      '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
      '    <link\n' +
      '      href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap"\n' +
      '      rel="stylesheet"\n' +
      '    />\n' +
      `    <style>${GIBSON}</style>`,
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

  // The published mark, at last, in its own two inks — and the reason it can be
  // is that the header moved. It used to float over the violet-black hero,
  // where the real lockup's violet arm is a hole in the X, so it was reversed:
  // white letters, solid orange X. The header is now the white bar that site
  // actually has, and on white the mark needs no reversal at all. Orange
  // letters, orange X, violet counter overprinted — which is the logo, not an
  // adaptation of it.
  //
  // Twenty-four pixels tall, from their `.logo-img { height: 24px }`.
  lockup: isologoSvg(
    LOCKUP,
    { letters: ACCENT, mark: ACCENT, counter: VIOLET },
    { title: 'Naranja X', attrs: 'class="h-6 w-auto"' },
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
  //
  // The typeface is named last and named separately ON PURPOSE. Two different
  // rights sit in this paragraph and they belong to two different owners: the
  // marks are Naranja X's and are reproduced without their involvement, which
  // is what the first sentence says; Gibson is Canada Type's and is set here
  // under a licence, which is what the last one says. Collapsing those into one
  // claim of permission would make the first sentence false.
  disclaimer:
    'Concepto no oficial y sin relación con Naranja X. Las marcas y el logotipo pertenecen a sus titulares y se reproducen solo con fines ilustrativos. Los datos y las cifras son de demostración y no constituyen una oferta comercial. Compuesto en Gibson, de Rod McDonald, publicada por Canada Type y usada con licencia.',
}

/** Also the default export, which is how `virtual:brand` reaches exactly one of these. */
export default naranjax
