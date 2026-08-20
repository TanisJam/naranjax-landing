import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { renderBlocks } from './src/brand/blocks'
import { resolveBrand } from './src/brand/registry'
import type { Brand } from './src/brand/types'

/**
 * Writes the brand into the document before any script can run.
 *
 * This exists because of what a share card is. A scraper fetches the page,
 * reads the markup and leaves — it never runs the bundle — so a title, a
 * canonical URL and an `og:image` that a script fills in are, to the only
 * audience that reads them, absent. Same for the palette: a page that paints
 * itself the default brand and then corrects to the right one has shipped a
 * flash of the wrong company's colours to every visitor.
 *
 * So the brand is a build input, not a runtime one. One environment variable
 * per deploy, two deploys, one `main`, and neither build carries the other's
 * palette, mark or copy into its bundle.
 */
function brandPlugin(): Plugin {
  const brand = resolveBrand(process.env.VITE_BRAND)
  // A FILE ON DISK BEATS THE DRAWING OF ONE, and the order below is what says
  // so — `binaries` is spread last, so anything a brand actually ships in
  // `brand-assets/<id>/` replaces the generated entry of the same name.
  //
  // Stated here rather than left to the reader to infer from Map semantics,
  // because it IS load-bearing now: `brand-assets/naranjax/favicon.svg` is the
  // company's own published icon, and swapping these two lines would silently
  // go back to serving a redrawing of it. `brand.icon` stays as the fallback
  // for a brand that has no published SVG, which is what mandarinax is.
  const generated = new Map<string, string | Uint8Array>([
    ['favicon.svg', brand.icon(brand.palette.ink[950])],
    ['site.webmanifest', manifest(brand)],
    ...binaries(brand.id),
  ])

  return {
    name: 'brand',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => paint(fill(html, brand), brand),
    },

    // Emitted rather than kept in `public/`, because both of these files state
    // the brand's colours and its name, and a copy of each per brand sitting in
    // a folder is two more places for the two builds to drift apart.
    generateBundle() {
      for (const [fileName, source] of generated) {
        this.emitFile({ type: 'asset', fileName, source })
      }
    },

    // `generateBundle` never runs under `vite dev`, and a dev server that 404s
    // on the icon is a dev server that lies about the build.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.replace(/^\/+|\?.*$/g, '')
        const source = name ? generated.get(name) : undefined
        if (source === undefined) return next()
        res.setHeader('Content-Type', CONTENT_TYPES[extension(name!)] ?? 'application/octet-stream')
        res.end(source)
      })
    },
  }
}

/**
 * The brand's icons and share card, read off disk.
 *
 * These live in `brand-assets/<id>/` rather than in `public/`, because `public/`
 * is copied wholesale into every build and every file in it states a brand: an
 * icon is a mark and a share card is a photograph of the product. Kept there,
 * one brand's deploy would serve the other's favicon and the other's card, and
 * nothing in the build would object.
 *
 * The missing-file check is the point of the `REQUIRED` list. A share card that
 * fails to copy does not break a page — it breaks every link to it, somewhere
 * else, later, in a preview nobody is looking at while the build says nothing.
 */
const REQUIRED = [
  'favicon.ico',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'og.jpg',
] as const

function binaries(id: string): [string, Uint8Array][] {
  const dir = fileURLToPath(new URL(`./brand-assets/${id}/`, import.meta.url))
  const present = new Set(readdirSync(dir))
  const missing = REQUIRED.filter((name) => !present.has(name))
  if (missing.length > 0) {
    throw new Error(`brand-assets/${id}/ is missing: ${missing.join(', ')}`)
  }
  return [...present].map((name) => [name, readFileSync(join(dir, name))])
}

const CONTENT_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  webmanifest: 'application/manifest+json',
  ico: 'image/x-icon',
  png: 'image/png',
  jpg: 'image/jpeg',
  woff2: 'font/woff2',
}

const extension = (name: string): string => name.slice(name.lastIndexOf('.') + 1)

/**
 * Substitutes `{{token}}` in the document, and refuses to leave one behind.
 *
 * The throw is the point. A token that survives into the output is a brand name
 * rendered as literal braces on a live page, and it would ship — nothing about
 * it breaks a build, a type check or a smoke test.
 */
function fill(html: string, brand: Brand): string {
  const values: Record<string, string> = {
    name: brand.name,
    downloadLine: brand.page.download.line,
    downloadCta: brand.page.download.cta,
    title: brand.title,
    description: brand.description,
    origin: brand.origin,
    shareImageAlt: brand.shareImageAlt,
    themeColor: brand.palette.ink[950],
    disclaimer: brand.disclaimer,
    ...brand.copy,
  }
  // Markup, so these are substituted before the escaping pass and never
  // through it. The blocks are the brand's LISTS — its navigation, its figures,
  // its footer — rendered by `blocks.ts`, which escapes each value as it
  // assembles them. See the note there on why that escaping is not shared.
  const markup: Record<string, string> = {
    lockup: brand.lockup,
    fontLink: brand.font.link,
    ...renderBlocks(brand),
  }
  const filled = Object.entries(markup)
    .reduce((html, [key, value]) => html.replaceAll(`{{${key}}}`, value), html)
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = values[key]
      if (value === undefined) throw new Error(`index.html asks for {{${key}}}, which no brand has.`)
      return escape(value)
    })
  const leftover = filled.match(/\{\{[^}]*\}\}/)
  if (leftover) throw new Error(`Unsubstituted token in index.html: ${leftover[0]}`)
  return filled
}

/** Every one of these lands inside an attribute at least once. */
function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Restates the theme's tokens in the brand's own values.
 *
 * `html:root` rather than `:root`, and the extra specificity is deliberate: the
 * stylesheet this overrides is injected by the bundler, and relying on landing
 * after it would make the page's colours a function of where a tool chooses to
 * put a `<link>`. Specificity does not care about order.
 *
 * The tokens are Tailwind's own — `@theme` compiles each utility down to a
 * `var()` of the custom property named here — so restating the properties
 * reskins every utility, including the ones with an opacity modifier, without
 * a second class or a second stylesheet anywhere.
 */
function paint(html: string, brand: Brand): string {
  const { accent, accentBright, ground, ink, surface } = brand.palette
  const colours = [
    ['brand-accent', accent],
    ['brand-accent-bright', accentBright],
    ['brand-ground', ground],
    ...Object.entries(ink).map(([step, value]) => [`ink-${step}`, value] as const),
    ['surface', surface.page],
    ['surface-soft', surface.soft],
    ['surface-strong', surface.strong],
    ['on-surface', surface.on],
    ['on-surface-muted', surface.onMuted],
    ['on-strong', surface.onStrong],
    ['on-strong-muted', surface.onStrongMuted],
    ['line', surface.line],
    ['tint-base', surface.tintBase],
    ['accent-ink', surface.accentInk],
    ['cta', surface.cta],
    ['cta-bright', surface.ctaBright],
    ['on-cta', surface.onCta],
  ].map(([token, value]) => `--color-${token}:${value}`)

  const declarations = [
    ...colours,
    `--radius-cta:${brand.shape.cta}`,
    `--radius-block:${brand.shape.block}`,
    `--font-sans:${brand.font.stack}`,
  ].join(';')
  return html.replace(
    '</head>',
    `  <style id="brand-palette">html:root{${declarations}}</style>\n  </head>`,
  )
}

function manifest(brand: Brand): string {
  return (
    JSON.stringify(
      {
        name: brand.name,
        short_name: brand.name,
        description: brand.description,
        lang: 'es-AR',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: brand.palette.ink[950],
        theme_color: brand.palette.ink[950],
        icons: [
          { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: './favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      null,
      2,
    ) + '\n'
  )
}

export default defineConfig({
  base: './',
  // Resolved here rather than looked up at run time, so the brand this deploy
  // does not show is never imported and its palette, mark and traced outlines
  // never reach the bundle. See `src/brand/virtual-brand.d.ts`.
  resolve: {
    alias: {
      'virtual:brand': fileURLToPath(
        new URL(`./src/brand/${resolveBrand(process.env.VITE_BRAND).id}.ts`, import.meta.url),
      ),
    },
  },
  plugins: [tailwindcss(), brandPlugin()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
