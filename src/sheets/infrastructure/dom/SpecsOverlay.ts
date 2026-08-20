import type { LayerSpec } from '../../domain/specs'

/**
 * The full-screen panel a layer opens into.
 *
 * Infrastructure, beside `three/`, and for the same reason that folder exists:
 * the domain says what a layer HAS to say, and this is one way of saying it.
 * Swapping the panel for a different presentation should not touch `specs.ts`.
 *
 * DOM rather than geometry, and that is the load-bearing decision here. Putting
 * these words in the scene means drawing them, and every pixel of type would be
 * paid for out of the same fill rate the piece spent a long session buying back
 * — for text that would then be unselectable, unzoomable and invisible to a
 * screen reader, which is what a texture is at any price.
 *
 * (The 38% column this used to cite is long gone: the canvas is the whole hero.
 * See `CLOSED_COVERAGE`, which carries what that number was worth.)
 *
 * Built here instead of authored in `index.html` because the markup is the same
 * nine times over and the content is data. What IS in the html is the trigger
 * list, which is markup that has to exist whether or not this ever runs.
 */

/** How long the panel takes to arrive, and to leave. Mirrors the CSS. */
const FADE_MS = 320

export interface SpecsOverlayOptions {
  /**
   * Called when the user asks to close — backdrop, button or Escape. The
   * overlay does NOT close itself on these: whoever owns the gesture also owns
   * the 3D return that has to run with it, and a panel that closed on its own
   * would leave the artwork framed on a layer nobody is looking at any more.
   */
  onDismiss: () => void
}

export class SpecsOverlay {
  /** True from the moment it is asked to open until it is fully gone. */
  get open(): boolean {
    return this.isOpen
  }

  private readonly root: HTMLElement
  private readonly eyebrow: HTMLElement
  private readonly title: HTMLElement
  private readonly summary: HTMLElement
  private readonly entries: HTMLElement
  private readonly closeButton: HTMLButtonElement

  private isOpen = false
  private hideHandle = 0
  /** Where focus came from, so it can be put back exactly there. */
  private returnFocusTo: HTMLElement | null = null

  constructor(private readonly options: SpecsOverlayOptions) {
    const root = document.createElement('div')
    root.id = 'layer-specs'
    root.className = 'fixed inset-0 z-50 hidden'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-labelledby', 'layer-specs-title')

    // A SPEC SHEET BESIDE THE PLATE, which is what a spec sheet is.
    //
    // THIS WAS A POSTER AND THE POSTER IS GONE. The plate used to arrive across
    // the whole screen, so there was nowhere for words except on top of it —
    // and a layer seen full-frame is foil, holograms and pressed relief, which
    // type is illegible over half of and unreadable over the holographic
    // quarter. The answer was a gradient climbing three fifths of the way up
    // the screen to buy a band with a constant ground. It worked, and what it
    // bought was two thirds of a screen of texture with a strip of text along
    // the floor.
    //
    // The plate now takes a little over half the width — see `FOCUS_SPAN` — so
    // the words go where they belong: on the page's own ground, at a measure,
    // beside the thing they describe. No scrim, because nothing is lying on
    // foil any more. That is the same reason the scrim existed and the same
    // reason it does not.
    //
    // The dismiss surface stays transparent and stays the whole viewport. The
    // card is what the user asked to see up close and nothing may cover it, and
    // a click anywhere that is not the sheet still means "put it back".
    //
    // BELOW `--specs-split` THE OLD ARRANGEMENT IS THE RIGHT ONE and it is
    // still here. A phone cannot set a plate and a sheet side by side, so it
    // gets the full-frame plate and the scrim, and `fitFocus` frames the plate
    // to match. The breakpoint is stated in the stylesheet and read from there
    // by both — see `FOCUS_SPLIT_ASPECT`.
    root.innerHTML = `
      <div data-dismiss class="absolute inset-0"></div>
      <div data-scrim aria-hidden="true" class="layer-specs__scrim"></div>
      <div class="layer-specs__frame">
        <div class="layer-specs__sheet">
          <p data-eyebrow class="layer-specs__eyebrow"></p>
          <h2 id="layer-specs-title" class="layer-specs__title"></h2>
          <p data-summary class="layer-specs__summary"></p>
          <dl data-entries class="layer-specs__entries"></dl>
        </div>
      </div>
      <button
        type="button"
        data-dismiss
        class="layer-specs__close"
      >
        <span aria-hidden="true" class="text-xl leading-none">&times;</span>
        <span class="sr-only">Cerrar</span>
      </button>
    `

    this.root = root
    this.eyebrow = this.require('[data-eyebrow]')
    this.title = this.require('#layer-specs-title')
    this.summary = this.require('[data-summary]')
    this.entries = this.require('[data-entries]')
    this.closeButton = this.require<HTMLButtonElement>('button[data-dismiss]')

    // One listener on the root rather than one per dismissable thing: the
    // backdrop and the button are the same request wearing two hats.
    root.addEventListener('click', (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-dismiss]')) {
        this.options.onDismiss()
      }
    })

    // On the root and not on the document, so it only ever answers while the
    // panel has focus — and it does, because opening moves focus into it.
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.options.onDismiss()
        return
      }
      if (event.key === 'Tab') this.trap(event)
    })

    document.body.appendChild(root)
  }

  /**
   * Shows the panel for a layer.
   *
   * `hidden` comes off a frame before the class that fades it in, and that
   * order is not cosmetic: a transition on an element that was `display: none`
   * in the same frame never runs, so the panel would appear as a hard cut.
   */
  show(spec: LayerSpec): void {
    window.clearTimeout(this.hideHandle)
    this.fill(spec)

    this.returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    this.isOpen = true
    this.root.classList.remove('hidden')
    // The page behind is not just visually gone, it is out of the tab order and
    // out of the accessibility tree. Half of a modal is the half you cannot get
    // to by accident.
    document.querySelector('main')?.setAttribute('inert', '')

    requestAnimationFrame(() => {
      this.root.dataset.shown = 'true'
      // After the fade has started, so the browser does not scroll the panel
      // into view before it exists on screen.
      this.closeButton.focus()
    })
  }

  /** Fades the panel out and takes focus back to whatever opened it. */
  hide(): void {
    if (!this.isOpen) return
    this.isOpen = false
    delete this.root.dataset.shown
    document.querySelector('main')?.removeAttribute('inert')

    // Focus moves now rather than when the fade ends: it is leaving an element
    // that is on its way to `display: none`, and a browser will not wait.
    this.returnFocusTo?.focus()
    this.returnFocusTo = null

    this.hideHandle = window.setTimeout(() => {
      this.root.classList.add('hidden')
    }, FADE_MS)
  }

  dispose(): void {
    window.clearTimeout(this.hideHandle)
    this.root.remove()
  }

  private fill(spec: LayerSpec): void {
    this.eyebrow.textContent = spec.eyebrow
    this.title.textContent = spec.title
    this.summary.textContent = spec.summary

    // Rebuilt rather than diffed. Nine rows of text is not a workload, and a
    // diff here would be code standing between the data and the screen for no
    // measurable gain.
    this.entries.replaceChildren(
      ...spec.entries.map((entry) => {
        const row = document.createElement('div')
        row.className = 'layer-specs__entry'

        const label = document.createElement('dt')
        label.className = 'layer-specs__label'
        label.textContent = entry.label

        const value = document.createElement('dd')
        value.className = 'layer-specs__value'
        value.textContent = entry.value

        row.append(label, value)
        return row
      }),
    )
  }

  /**
   * Keeps Tab inside the panel.
   *
   * Two focusable things live in here today — the close button and nothing
   * else — but the list is queried rather than assumed, so adding a link to a
   * spec later does not silently break the loop.
   */
  private trap(event: KeyboardEvent): void {
    const focusable = this.root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const found = this.root.querySelector<T>(selector)
    // The markup is a literal three dozen lines up. If this ever throws, it is
    // a typo in that literal and not a runtime condition worth handling.
    if (!found) throw new Error(`Specs overlay is missing ${selector}`)
    return found
  }
}
