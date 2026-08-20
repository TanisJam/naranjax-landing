import type { Brand, FooterColumn, Link, Stat } from './types'

/**
 * The brand's lists, rendered to markup for the build to substitute.
 *
 * This is the same mechanism `{{lockup}}` already uses and it exists for the
 * same reason: a scraper fetches the page and leaves, and a navigation, a set
 * of figures and a footer that a script fills in are, to that reader, absent.
 * So they are written into the document before the bundle exists.
 *
 * Nothing here decides layout. Every function below emits the SAME structure
 * for either brand and the classes it hangs on are defined once in
 * `src/style.css`; what differs between the two builds is the words, the
 * destinations and the figures. A generator that also chose the arrangement
 * would be a second index.html hiding in a TypeScript file.
 */
export function renderBlocks(brand: Brand): Record<string, string> {
  const { nav, navCta, heroLines, stats, orbit, marquee, footer } = brand.page
  return {
    navLinks: nav.map(navLink).join('\n            '),
    navCta: `<a href="${escape(navCta.href)}" class="nx-button">${escape(navCta.label)}</a>`,
    heroLines: heroLines.map(heroLine).join('\n            '),
    statCards: stats.map(statCard).join('\n            '),
    orbitBadges: orbit.map(badge).join('\n            '),
    marqueeLines: marqueeLines(marquee),
    footerColumns: footer.map(footerColumn).join('\n            '),
  }
}

const navLink = ({ label, href }: Link): string =>
  `<a href="${escape(href)}" class="nav-link">${escape(label)}</a>`

/**
 * One line of the claim.
 *
 * A span per line rather than one string with breaks in it, because each of
 * them arrives on its own: the reference staggers the three by two hundred
 * milliseconds and that stagger is most of why the hero reads as a greeting
 * rather than as a banner. See `.hero-line` in `src/style.css`.
 */
const heroLine = (line: string): string => `<span class="hero-line">${escape(line)}</span>`

/**
 * One figure.
 *
 * Square to the page, and that is a correction rather than a simplification.
 * These cards used to carry a small authored lean on the argument that a row
 * with no lean is a table — but the row being quoted has no lean at all: five
 * upright panels, flush, alternating ground. What stops them reading as a table
 * is that each one is a different colour with its own drawing in the corner,
 * and that they arrive one after another from the side rather than all at once.
 *
 * `data-reveal="side"` is that entrance; the delay is what spaces the five out.
 */
function statCard(
  { value, unit, label, mark, markLogo, motif, art, tint }: Stat,
  index: number,
): string {
  // The figure gets an element of its own so it can be counted up as the card
  // arrives — see `countUp` in `src/page/PageMotion.ts`. It has to be its own
  // element rather than the whole line: the unit rides inside that line, and a
  // count that wrote the line's text would erase the word beside the number on
  // its first frame. The final value stays in the markup, so a reader without
  // the bundle reads the figure rather than a zero, and a value the counter
  // does not recognise — `24/7`, `La segunda` — is simply never touched.
  const counted = `<span data-count>${escape(value)}</span>`
  const number = unit
    ? `${counted} <span class="stat-card__unit">${escape(unit)}</span>`
    : counted
  // A name where the sentence would be, or the sentence. Never both: the card
  // that carries a lockup is the one card in the row that is not a figure.
  //
  // Where the brand has the logotype, that is what gets drawn — and `mark` is
  // not dropped for it, it becomes the alt text. The card reads «Somos parte
  // del Grupo Galicia» either way, seen or spoken.
  const named = markLogo
    ? `<img class="stat-card__logo" src="/${escape(markLogo)}" alt="${escape(mark ?? '')}" loading="lazy" decoding="async">`
    : escape(mark ?? '')
  const under = mark
    ? `<p class="stat-card__mark">${named}</p>`
    : `<p class="stat-card__label">${escape(label ?? '')}</p>`
  // Artwork if the brand has it, the drawn glyph if it does not, and never
  // both — see `art` in `types.ts`. `aria-hidden` either way: both of them say
  // again what the two lines above already said, and a screen reader that
  // announces the storefront has read the card twice.
  const drawing = art
    ? `<img class="stat-card__art" src="/${escape(art)}" alt="" aria-hidden="true" loading="lazy" decoding="async">`
    : motif
      ? `<span class="stat-card__motif" aria-hidden="true">${motif}</span>`
      : ''
  return (
    `<li class="stat-card stat-card--${tint}"` +
    ` data-reveal="side" data-reveal-delay="${index * 110}">` +
    `<p class="stat-card__value">${number}</p>` +
    under +
    drawing +
    `</li>`
  )
}

/**
 * One badge on the ring.
 *
 * The angle is a custom property because the ring places its badges with a
 * rotation and a counter-rotation — the disc travels around the circle and the
 * glyph inside it stays upright, which is the only way a drawing survives being
 * put on a wheel. See `.orbit-badge` in `src/style.css`.
 */
/**
 * Where each badge sits on the circle, and the answer is: as far from the next
 * one as the arithmetic allows.
 *
 * This was a table of three authored angles — -58, 128, 38 — which put two of
 * the discs 96 and 90 degrees apart and left 174 degrees of empty dash on the
 * other side. Read off the count instead, so the ring is evenly loaded at three
 * badges and still evenly loaded at five, and nobody has to remember to add an
 * angle when they add a glyph. The quarter turn back is what puts the first one
 * at the top of the circle rather than out to the right.
 */
const angleFor = (index: number, count: number): string =>
  `${(-90 + (index * 360) / count).toFixed(2)}deg`

function badge(
  { icon, label, tint }: Brand['page']['orbit'][number],
  index: number,
  all: readonly unknown[],
): string {
  return (
    `<span class="orbit-badge orbit-badge--${tint}" style="--angle:${angleFor(index, all.length)}">` +
    `<span class="orbit-badge__glyph">${icon}<span class="sr-only">${escape(label)}</span></span>` +
    `</span>`
  )
}

/**
 * The three drifting lines.
 *
 * Each is the same set of words at a different rotation, so the three never
 * line up into a column — and each is laid down TWICE, because the animation
 * translates by half its own width and hands back to the start. Half of a list
 * that appears once is a gap crossing the screen every few minutes.
 *
 * The middle line runs the other way. That is the whole trick of the reference:
 * two directions read as a texture in motion, one direction reads as a banner.
 */
function marqueeLines(words: readonly string[]): string {
  return [0, 2, 4]
    .map((offset, index) => {
      const rotated = [...words.slice(offset), ...words.slice(0, offset)]
      const run = [...rotated, ...rotated].join(' ')
      const modifier = index === 1 ? ' marquee__line--reverse' : ''
      return `<span class="marquee__line${modifier}">${escape(run)}</span>`
    })
    .join('\n          ')
}

function footerColumn({ title, links }: FooterColumn): string {
  const items = links
    .map(({ label, href }) => `<li><a href="${escape(href)}">${escape(label)}</a></li>`)
    .join('\n                ')
  return (
    `<li class="footer-col">` +
    `<p class="footer-col__title">${escape(title)}</p>` +
    `<ul class="footer-col__links">\n                ${items}\n              </ul>` +
    `</li>`
  )
}

/**
 * The same escaping the build's own token pass does.
 *
 * Restated here rather than shared, because these two run at different moments
 * and on different things: that one escapes a value on its way INTO markup,
 * this one escapes the values this file is assembling markup FROM. A single
 * helper crossing that line is how a lockup ends up printed as its own source.
 */
const escape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
