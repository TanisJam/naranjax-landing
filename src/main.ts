import './style.css'
import closeSound from '../sound-effects/close.mp3?url'
import specCloseSound from '../sound-effects/close-short.mp3?url'
import openSound from '../sound-effects/open.mp3?url'
import specOpenSound from '../sound-effects/open-short.mp3?url'
import pickSound from '../sound-effects/pick.mp3?url'
import { FrameCounter } from './diagnostics/FrameCounter'
import { createKnockouts } from './diagnostics/knockouts'
import { SceneOrchestrator } from './sheets/application/SceneOrchestrator'
import { composition } from './sheets/domain/composition'
import { layerSpecs, specFor, type LayerSpec } from './sheets/domain/specs'
import { SpecsOverlay } from './sheets/infrastructure/dom/SpecsOverlay'
import type { SheetObject } from './sheets/infrastructure/three/SheetObject'
import { SoundBoard } from './sound/SoundBoard'

const stage = document.querySelector<HTMLElement>('#sheets-stage')
if (!stage) throw new Error('#sheets-stage container is missing')

// The canvas is transparent, so the panel's own background shows through and
// the artwork keeps the page's colour at every viewport.
const orchestrator = new SceneOrchestrator(stage, composition)
orchestrator.start()

// The pointer cue is the one that fires most, so it sits well under the two
// transitions — it is punctuation, not an announcement.
const sound = new SoundBoard(
  {
    open: openSound,
    close: closeSound,
    pick: pickSound,
    specOpen: specOpenSound,
    specClose: specCloseSound,
  },
  { open: 0.55, close: 0.55, pick: 0.3, specOpen: 0.5, specClose: 0.5 },
)

if (import.meta.env.DEV) {
  // Handles for the console and for automated checks. Draw order, blend
  // behaviour and which cue fired are only observable while the piece is
  // running, so they need a way in from outside. DEV-guarded, so neither
  // reaches a build.
  Object.assign(window, { __sheets: orchestrator, __sound: sound })
}

// On in development, and reachable in a build with `?fps` — a production build
// is the only place the real cost can be read, since dev serves unminified
// modules and runs its own machinery alongside the frame loop. Never on by
// default in a build: the instrument is for whoever came looking for it.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('fps')) {
  const counter = new FrameCounter()
  orchestrator.onFrame = (cpuMs) => counter.sample(cpuMs)
  // Alongside the readout, since a reading with nothing to compare it against
  // says only that the frame is slow. `__perf.pixelRatio(1)` first.
  Object.assign(window, { __perf: createKnockouts(orchestrator) })
}

// Captured before anything touches them, so restoring the preference puts the
// timeline back on its tuned amplitudes rather than on invented ones.
const motion = {
  breathe: orchestrator.timeline.breatheAmount,
  float: orchestrator.timeline.floatAmount,
  wind: orchestrator.timeline.windAmount,
  deploy: orchestrator.timeline.deployDuration,
  collapse: orchestrator.timeline.collapseDuration,
  hoverSlide: orchestrator.timeline.hoverSlide,
  focus: orchestrator.timeline.focusDuration,
  focusReturn: orchestrator.timeline.focusReturnDuration,
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const applyMotionPreference = (): void => {
  const still = reducedMotion.matches
  orchestrator.timeline.breatheAmount = still ? 0 : motion.breathe
  orchestrator.timeline.floatAmount = still ? 0 : motion.float
  orchestrator.timeline.windAmount = still ? 0 : motion.wind
  // The deploy is the largest motion on the page by far, and it is the one
  // thing here the user asked for by clicking. So it stays available and
  // becomes a cut: the stack changes state between two frames rather than
  // sweeping eleven layers across the panel.
  orchestrator.timeline.deployDuration = still ? 0 : motion.deploy
  orchestrator.timeline.collapseDuration = still ? 0 : motion.collapse
  // Same reasoning as the deploy, and for the same reason: opening a layer is
  // the other thing on this page the user asked for by clicking. It becomes a
  // cut, and the CSS above it does the same — the specifications still arrive.
  orchestrator.timeline.focusDuration = still ? 0 : motion.focus
  orchestrator.timeline.focusReturnDuration = still ? 0 : motion.focusReturn
  // The hover keeps its highlight and loses its slide. The feedback is the
  // point; the layer travelling to deliver it is not.
  orchestrator.timeline.hoverSlide = still ? 0 : motion.hoverSlide
  if (orchestrator.parallax) orchestrator.parallax.enabled = !still
  // And the backdrop behind an opened layer fades over exactly as long as that
  // layer travels, in each direction, because it is the same gesture. It used
  // to be 420ms authored into the stylesheet against a duration decoded from an
  // mp3 — two numbers for one movement, agreeing only by hand, and the one that
  // finished first left the other to be cut off partway. Written from here
  // because this is already the one place that knows both the cue lengths and
  // whether the user asked for stillness.
  const root = document.documentElement.style
  root.setProperty('--framed-in', `${(still ? 0 : motion.focus) * 1000}ms`)
  root.setProperty('--framed-out', `${(still ? 0 : motion.focusReturn) * 1000}ms`)
}
applyMotionPreference()
reducedMotion.addEventListener('change', applyMotionPreference)

// The two transitions run exactly as long as the cue that scores them, and the
// cue is what says how long that is. Taking the length from the decoded buffer
// rather than copying the number here keeps them from drifting apart the first
// time somebody swaps an mp3 — the authored defaults on the timeline are the
// fallback for when there is no audio at all, not a second source of truth.
void sound.ready.then(() => {
  motion.deploy = sound.duration('open') ?? motion.deploy
  motion.collapse = sound.duration('close') ?? motion.collapse
  motion.focus = sound.duration('specOpen') ?? motion.focus
  motion.focusReturn = sound.duration('specClose') ?? motion.focusReturn
  applyMotionPreference()
})

// A hidden tab and a scrolled-away panel both cost a full frame budget for
// pixels nobody sees. Stop on either, and only resume when both allow it.
//
// An open layer is NOT one of these, and that is the point of it: the card is
// filling the screen and being looked at, so it keeps every frame it asks for.
// Fullscreen is about two and a half times the pixels of the column and the
// resolution governor is what answers that — see `ResolutionGovernor`.
let tabVisible = !document.hidden
let panelVisible = true
const syncFrameLoop = (): void => {
  if (tabVisible && panelVisible) orchestrator.start()
  else orchestrator.stop()
}

document.addEventListener('visibilitychange', () => {
  tabVisible = !document.hidden
  syncFrameLoop()
})

new IntersectionObserver(
  ([entry]) => {
    panelVisible = entry?.isIntersecting ?? true
    syncFrameLoop()
  },
  { threshold: 0 },
).observe(stage)

// The stack ships closed — one card — and the click is what takes it apart.
// The panel is the control: a hit target the size of the artwork, since the
// artwork is what the user is aiming at and it moves.
const hint = document.querySelector<HTMLElement>('#sheets-hint')

/** `silent` is for the initial state, which nobody asked to hear. */
const setDeployed = (deployed: boolean, silent = false): void => {
  orchestrator.timeline.deployTarget = deployed ? 1 : 0
  stage.setAttribute('aria-expanded', String(deployed))
  stage.setAttribute(
    'aria-label',
    deployed ? 'Armar la tarjeta' : 'Ver todo lo que podés hacer con Naranja X',
  )
  if (hint) {
    hint.textContent = deployed
      ? 'Tocá una capa para ver esa función'
      : 'Tocá para ver todo lo que podés hacer'
  }
  if (!silent) sound.play(deployed ? 'open' : 'close')
}

// Ahead of the click, so the context is running by the time the cue is asked
// for. `pointerdown` is a gesture as far as the autoplay policy is concerned.
stage.addEventListener('pointerdown', () => sound.resume(), { passive: true })

// The panel a layer opens into, and the two halves of that gesture.
const specs = new SpecsOverlay({ onDismiss: () => closeSpecs() })

// The canvas is given back to its column at the one instant it can be: the
// frame the return finishes, when the artwork has just arrived at the pose the
// compensation says looks exactly like the column view. Ordered so the layout,
// the camera and the compensation all change inside the same frame.
orchestrator.timeline.onFocusRelease = () => {
  delete stage.dataset.framed
  // One call, and deliberately: re-measuring the canvas and dropping the
  // compensation have to happen together or not at all. See `clearReframe`.
  orchestrator.clearReframe()
}

/**
 * Brings a layer up out of the stack, across the whole screen, and lays its
 * specifications over it.
 *
 * The canvas leaves its column FIRST and the artwork grows afterwards, which is
 * the only order that works: the growth has to happen on a canvas that is
 * already the size of the screen, or it is a card getting bigger inside a 38%
 * window and stopping at its edge. `reframe` is what keeps that swap from being
 * seen — see the measurement there.
 */
const openSpecs = (sheet: SheetObject, spec: LayerSpec): void => {
  orchestrator.reframe(() => {
    stage.dataset.framed = 'true'
  })

  orchestrator.timeline.focused = sheet
  orchestrator.timeline.focusTarget = 1
  // The hover is answering a pointer that is about to be over a panel, and a
  // layer lighting up under there is a response to nothing anyone can see.
  orchestrator.picker.enabled = false
  sound.play('specOpen')
  specs.show(spec)
}

/** Puts the layer back in the stack and the canvas back in its column. */
const closeSpecs = (): void => {
  orchestrator.timeline.focusTarget = 0
  orchestrator.picker.enabled = true
  // The canvas stays fullscreen for the whole return — it is still drawing a
  // card the size of the screen — and only the backdrop starts leaving, so the
  // page is already back by the time the canvas is. See the two states in the
  // stylesheet.
  stage.dataset.framed = 'closing'
  specs.hide()
  sound.play('specClose')
}

stage.addEventListener('click', (event) => {
  // A finger that swept the deck already got its answer — every crossing it
  // made, as it made them. The click the browser synthesises when it lifts is
  // not a second gesture, and opening whatever happened to be under the last
  // millimetre of a riffle would be answering a question nobody asked.
  if (orchestrator.picker.dragged) return

  // A closed card is one object. Whichever layer the ray happens to land on
  // inside it, the only thing the user can be asking for is to open the card —
  // and opening a panel for a layer they were never shown coming apart would be
  // answering a question nobody asked.
  if (!orchestrator.timeline.deployed) {
    setDeployed(true)
    return
  }

  const layer = orchestrator.picker.pickAt(event.clientX, event.clientY)
  const spec = layer ? specFor(layer.layer.id) : null

  // Null is the answer, not the absence of one. Nothing under the pointer is
  // the background, and a layer with no spec is one of the two covers — and
  // both of those mean the same thing: put the card back together. The nine
  // layers between them are the ones that open.
  if (!spec || !layer) {
    setDeployed(false)
    return
  }

  openSpecs(layer, spec)
})

// A div with a button role gets none of a button's keyboard behaviour for free,
// and both keys have to be handled: Enter fires on keydown, Space would
// otherwise scroll the page out from under the panel.
stage.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  sound.resume()
  setDeployed(!orchestrator.timeline.deployed)
})

/**
 * Pointer speed, in NDC units per second, at which a crossing is a scrape
 * rather than a visit. Below the floor it is someone choosing a layer; above
 * the ceiling they are dragging a thumb down the edge of a deck.
 */
const SCRAPE_FLOOR = 0.6
const SCRAPE_CEILING = 5

// Entering a layer is the event. Leaving one is not — a cue on the way out
// doubles every crossing and turns a sweep across the stack into a stutter.
// And only when the pointer put it there: the artwork floats, so a boundary
// can wander across a still pointer on its own, and answering that with a
// click in someone's ears is answering something they did not do.
//
// The scrape is not a second sample. It is this one, fired as densely as the
// crossings actually arrive and detuned per voice — which is what a riffle is.
// The detune is not decoration: an unvaried sample repeated twenty times in
// half a second stops sounding like an object and starts sounding like a
// buffer, and no amount of level riding fixes that.
orchestrator.picker.onChange = (layer, change) => {
  if (!layer || !change.fromPointer) return

  const intensity = Math.min(
    Math.max((change.speed - SCRAPE_FLOOR) / (SCRAPE_CEILING - SCRAPE_FLOOR), 0),
    1,
  )

  sound.play('pick', {
    // The crossing's own place in the frame's burst. Several arrive per frame
    // on a fast sweep and they are milliseconds apart, not simultaneous.
    delay: change.offset,
    // Shorter and brighter as the gesture speeds up, plus a per-voice wobble
    // that is there whether the sweep is fast or slow.
    rate: (1 + intensity * 0.42) * (0.96 + Math.random() * 0.08),
    // Each individual tick still softens a little as the sweep speeds up, so a
    // run of them reads as one texture rather than as twenty announcements —
    // but only a little. This used to fall to 0.65 at full speed, which fought
    // the crowding already pulling the same direction and left the fastest
    // gesture on the page as the quietest thing on it.
    gain: 1 - intensity * 0.12,
    // The body goes the other way, because the hand did. A visit is a lighter
    // knock than authored; a thumb dragged down the edge of the deck is a
    // harder one. This is the whole difference between feedback that reports
    // the gesture and feedback that merely notices it happened.
    force: 0.7 + intensity * 1.05,
  })
}

setDeployed(false, true)

// The feature list, built from the spec data rather than written out in the
// markup — the name of a feature here and the title on the panel it opens are
// the same string, and there is no version of this where they are allowed to
// disagree.
//
// It is one list doing two jobs. A landing has to state what the product does,
// and the panels need a route that does not depend on aiming a pointer at one
// plate of a floating stack — which is a gesture a keyboard cannot perform at
// any price. Those were two lists in the form version, one of them hidden;
// here the visible one is the accessible one, so there is nothing to keep in
// sync and nothing that only some users can read.
const features = document.querySelector<HTMLElement>('#feature-list')
if (features) {
  const byId = new Map(orchestrator.sheets.map((sheet) => [sheet.layer.id, sheet]))

  features.replaceChildren(
    ...layerSpecs.flatMap((spec) => {
      const sheet = byId.get(spec.layer)
      // A spec naming a layer the composition does not have is a typo in one of
      // the two files, and the honest response is to leave no entry for it
      // rather than to ship a row that does nothing.
      if (!sheet) return []

      const button = document.createElement('button')
      button.type = 'button'
      button.className =
        'group flex w-full items-baseline gap-4 py-4 text-left transition hover:text-neutral-50 focus-visible:outline-2 focus-visible:outline-nx-orange'

      const eyebrow = document.createElement('span')
      eyebrow.className =
        'w-24 shrink-0 text-xs leading-5 font-medium tracking-[0.15em] text-nx-orange uppercase'
      eyebrow.textContent = spec.eyebrow

      const body = document.createElement('span')
      body.className = 'flex min-w-0 flex-col gap-1'

      const title = document.createElement('span')
      title.className = 'text-base leading-6 font-medium text-neutral-50'
      title.textContent = spec.title

      const summary = document.createElement('span')
      summary.className = 'text-sm leading-5 text-ink-400'
      summary.textContent = spec.summary

      body.append(title, summary)
      button.append(eyebrow, body)

      button.addEventListener('click', () => {
        sound.resume()
        // Silently, because the layer's own cue is about to play and the two
        // share a voice — one would simply cut the other off mid-word.
        if (!orchestrator.timeline.deployed) setDeployed(true, true)
        openSpecs(sheet, spec)
      })

      const item = document.createElement('li')
      item.appendChild(button)
      return [item]
    }),
  )
}
