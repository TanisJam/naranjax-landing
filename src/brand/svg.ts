import type { Isologo } from './isologo'
import type { LogoInks } from './types'

/**
 * Renders an isologo as inline SVG markup.
 *
 * Inline rather than a file behind an `<img>`, for two reasons that both cost
 * something when ignored: the mark is in the first paint and a second request
 * for it is a second chance to arrive late, and inking it per surface requires
 * reaching the paths, which an `<img>` does not allow.
 *
 * One `<path>` per group and not per contour — a fill colour is the only thing
 * that ever varies between them, so three elements carry everything nine would.
 */
export function isologoSvg(
  logo: Isologo,
  inks: LogoInks,
  { title, attrs = '' }: { title: string; attrs?: string },
): string {
  const [x, y, width, height] = logo.viewBox
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}"` +
    ` role="img" aria-label="${title}"${attrs ? ' ' + attrs : ''}>${paths(logo, inks)}</svg>`
  )
}

/**
 * The same mark centred in a square tile, for the places that demand one.
 *
 * A favicon, a home-screen icon and a manifest entry are all squares, and a
 * mark that brings its own rectangle to them gets letterboxed by whatever is
 * behind it. The inset is a fraction of the side rather than a number of
 * pixels, so the tile is the same shape at every size one is asked for.
 */
export function squareIcon(
  logo: Isologo,
  inks: LogoInks,
  { ground, title, inset = 0.22 }: { ground: string; title: string; inset?: number },
): string {
  const [x, y, width, height] = logo.viewBox
  const side = 64
  const room = side * (1 - inset * 2)
  const scale = Math.min(room / width, room / height)
  const dx = (side - width * scale) / 2 - x * scale
  const dy = (side - height * scale) / 2 - y * scale
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" ` +
    `role="img" aria-label="${title}">` +
    `<rect width="${side}" height="${side}" rx="14" fill="${ground}"/>` +
    `<g transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${scale.toFixed(4)})">` +
    `${paths(logo, inks)}</g></svg>`
  )
}

/**
 * The groups in painting order, skipping any this surface cannot show.
 *
 * `counter` overprints `mark` rather than filling a hole in it, so an absent
 * ink here leaves a solid single-colour X instead of a gap. See `isologo.ts`.
 */
function paths(logo: Isologo, inks: LogoInks): string {
  const groups: [readonly string[], string | undefined][] = [
    [logo.letters, inks.letters],
    [logo.mark, inks.mark],
    [logo.counter, inks.counter],
  ]
  let out = ''
  for (const [contours, ink] of groups) {
    if (contours.length === 0 || ink === undefined) continue
    out += `<path d="${contours.join('')}" fill="${ink}"/>`
  }
  return out
}
