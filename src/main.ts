import './style.css'
import closeSound from '../sound-effects/close.mp3?url'
import openSound from '../sound-effects/open.mp3?url'
import pickSound from '../sound-effects/pick.mp3?url'
import { brand } from './brand'
import { FrameCounter } from './diagnostics/FrameCounter'
import { createKnockouts } from './diagnostics/knockouts'
import { startPageMotion } from './page/PageMotion'
import { SceneOrchestrator } from './sheets/application/SceneOrchestrator'
import { composition } from './sheets/domain/composition'
import { layerSpecs, specFor, type LayerSpec } from './sheets/domain/specs'
import { LayerRail } from './sheets/infrastructure/dom/LayerRail'
import { SpecsOverlay } from './sheets/infrastructure/dom/SpecsOverlay'
import type { SheetObject } from './sheets/infrastructure/three/SheetObject'
import { HAPTICS, SoundBoard, SWELLS } from './sound/SoundBoard'

const stage = document.querySelector<HTMLElement>('#sheets-stage')
if (!stage) throw new Error('#sheets-stage container is missing')

// The canvas is transparent, so the panel's own background shows through and
// the artwork keeps the page's colour at every viewport.
const orchestrator = new SceneOrchestrator(stage, composition)
orchestrator.start()

/**
 * Whether the page was asked for as the card alone — `?card`.
 *
 * READ OFF THE DOCUMENT rather than off the query string a second time, and
 * that is the point of it. The flag is decided in the head, before the body
 * exists, because the stylesheet has to resolve it on the first pass; parsing
 * `location.search` again here would be a second place that can disagree with
 * what the page is actually showing. See the note in `index.html`.
 */
const cardOnly = document.documentElement.dataset.view === 'card'

// THE TAB, which is the last place the stripped-down view would still be
// carrying the name it just took off the artwork.
//
// Patched from here rather than written into the markup, because the markup is
// where the BUILD's brand lives and it has to stay that way: a scraper reads
// the document and leaves, so the title, the canonical URL and the share card
// belong to the deploy, not to whichever URL somebody opened. `?card` is a
// request from a person with the page already open, and a person is the only
// audience for it. See `unbranded` in `src/brand/index.ts`.
//
// The favicon goes inline as a data URI instead of pointing at `/favicon.svg`,
// which the build emitted from the brand and which is, in the Naranja X deploy,
// that company's own published icon. There is no second file to point at and
// there should not be one — an asset emitted for a query parameter is an asset
// that outlives the reason for it.
if (cardOnly) {
  document.title = brand.title

  const hero = document.querySelector<HTMLElement>('#hero')
  hero?.setAttribute('aria-label', `Ilustración de la tarjeta ${brand.name}`)

  // Every icon link, not just the SVG one: the `.ico` and the apple-touch file
  // are the brand's too, and a browser that prefers either would go on showing
  // the mark this view exists to remove.
  for (const link of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')) {
    link.remove()
  }
  const icon = document.createElement('link')
  icon.rel = 'icon'
  icon.type = 'image/svg+xml'
  icon.href = `data:image/svg+xml,${encodeURIComponent(brand.icon(brand.palette.ink[950]))}`
  document.head.appendChild(icon)
}

// The page around the card: the bar that steps aside going down, and the blocks
// that rise into place as they are reached. Started here rather than on
// `DOMContentLoaded` because this module is a deferred ES module — the document
// is already parsed by the time any of it runs.
//
// Skipped outright under `?card`, rather than left to find nothing. All of it
// is machinery hung off a scroll that no longer exists — two observers, a
// resize watcher and a listener per frame — and the one thing on that page is a
// WebGL card being drawn at sixty frames. Silent inertia still costs a budget.
if (!cardOnly) startPageMotion()

// The pointer cue is the one that fires most, so it sits well under the two
// transitions — it is punctuation, not an announcement.
//
// Three recordings, not five. `specOpen` and `specClose` are built rather than
// played: see `SWELLS`. They had been `open-short.mp3` and `close-short.mp3`,
// and those two landed hard for a reason worth writing down, because it was not
// the reason anyone assumed. Measured, they peak at 0.396 and 0.405 against
// 0.038 for the two long cues — mastered some twenty decibels hotter — while
// the gains here were chosen as though all five were comparable bounces. So the
// smallest gesture on the page was going out ten times louder than the whole
// stack coming apart. The timbre was never the problem, and neither was the mix
// intent: the files simply were not the level anyone thought they were.
//
// Levels below are matched to `open` on RMS across the audible part of each
// recording, so what is left here reads as three intentions rather than as an
// accident of how the assets happened to be bounced.
const sound = new SoundBoard(
  { open: openSound, close: closeSound, pick: pickSound },
  { open: 0.55, close: 0.55, pick: 0.3, specOpen: 0.5, specClose: 0.5 },
)

if (import.meta.env.DEV) {
  // Handles for the console and for automated checks. Draw order, blend
  // behaviour and which cue fired are only observable while the piece is
  // running, so they need a way in from outside. DEV-guarded, so none of them
  // reaches a build.
  //
  // The cue tables are here for the same reason the knockouts are: how a sound
  // lands is not a thing anyone can read off a number, and editing a constant
  // to wait for a reload puts several seconds between the change and the only
  // evidence that counts. Every field is live —
  // `__cues.swells.specOpen.to = 1100`, then `__sound.play('specOpen')`.
  Object.assign(window, {
    __sheets: orchestrator,
    __sound: sound,
    __cues: { swells: SWELLS, haptics: HAPTICS, gains: sound.gains },
  })
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
//
// The two focus cues have no buffer to decode any more and still answer this,
// from their authored length. Which is the better arrangement of the same
// agreement: a recording's duration includes whatever silence its bounce left
// at the head, and both of those files had 135ms of it — a third of the
// animation ran before the cue scoring it made a sound.
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
//
// FRAMED IS THE THIRD FLAG AND IT IS NOT AN OPTIMISATION, IT IS A CORRECTNESS
// FIX. The observer watches the stage, and while the reader is down at the
// feature list the stage is a screen and a half above them, so the loop is
// stopped and the canvas is holding whatever it drew last — which, on every
// open after the first, is the deployed stack. Opening a layer from that list
// takes the canvas fullscreen instantly; the observer that would restart the
// loop is delivered as a task and can land AFTER the paint. That paint is the
// bug: one frame of a stale, fanned-out stack blown across the screen before
// the real first frame replaces it. So the loop is started by the thing that
// framed the canvas, synchronously, rather than by the observer noticing
// afterwards. Same reason the flag cannot be dropped on the observer's word
// either: releasing the frame hands the canvas back to a column that is still
// off screen.
let tabVisible = !document.hidden
let panelVisible = true
let framed = false
const syncFrameLoop = (): void => {
  if (tabVisible && (panelVisible || framed)) orchestrator.start()
  else orchestrator.stop()
}

document.addEventListener('visibilitychange', () => {
  tabVisible = !document.hidden
  syncFrameLoop()
})

new IntersectionObserver(
  (entries) => {
    // The LAST record, not the first. The callback is handed every observation
    // queued since it last ran, oldest first, and reading the oldest is reading
    // a state the page may have already left.
    const entry = entries[entries.length - 1]
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
    deployed ? 'Armar la tarjeta' : `Ver todo lo que podés hacer con ${brand.name}`,
  )
  if (hint) {
    hint.textContent = deployed
      ? 'Tocá una capa para ver esa función'
      : 'Arrastrá para girarla · Tocá para ver todo lo que podés hacer'
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
  // After both, so the frame this runs inside still draws the handover it was
  // ordered to draw. `stop` only cancels the NEXT request; it does not abandon
  // the frame already in flight.
  framed = false
  syncFrameLoop()
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
  // LAST, and synchronously: `start` draws a frame on the spot, so the first
  // paint after this click is one this state produced rather than one the
  // canvas was still holding from before the reader scrolled away. Everything
  // above has to be set by the time it runs — that frame is a real frame.
  framed = true
  syncFrameLoop()
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

  // And the same thing for a mouse, which the picker deliberately does not
  // answer for: it never sees a mouse press, because a mouse hovers without
  // pressing and its click is never the tail of a sweep. Turning the card is
  // the one gesture that makes a mouse press mean something on its own, so it
  // is the one that has to say whether the click after it was a click.
  if (orchestrator.tumble?.dragged) return

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

// THE RAIL: the nine names, hung beside the nine plates once the card opens.
//
// Built here rather than inside the orchestrator because it is a presentation
// of `specs.ts`, exactly like the panel and exactly like the feature list, and
// the scene has no business knowing that the product has features. What the
// scene provides is where a plate ended up, which is `onAfterRender` below.
const rail = new LayerRail(stage, {
  entries: layerSpecs.flatMap((spec) => {
    const sheet = orchestrator.sheets.find((candidate) => candidate.layer.id === spec.layer)
    // Same rule the feature list follows: a spec naming a layer the composition
    // does not have is a typo in one of two files, and the honest answer is to
    // leave no rung for it rather than to hang a label on nothing.
    return sheet ? [{ sheet, spec }] : []
  }),
  // All eleven, covers included — see `obstacles`.
  obstacles: orchestrator.sheets,
  onAddress: (sheet) => {
    orchestrator.hoverOverride = sheet
  },
  onOpen: (sheet, spec) => {
    sound.resume()
    openSpecs(sheet, spec)
  },
})

// Positioned after the draw, against the matrices of the frame being shown.
//
// Whether it is shown at all is DERIVED here rather than pushed from the three
// places that change it, and that is not laziness. The rail belongs on screen
// exactly when the stack is open and no panel is over it, and those two facts
// are moved by the click handler, the keyboard handler, the feature list, the
// rail's own labels, the backdrop, the close button and Escape. Seven call
// sites each remembering to update a third piece of state is a missed
// transition waiting to happen — and the one that gets missed is Escape, which
// is the one nobody tests. Read once a frame it cannot be wrong, and
// `setShown` returns immediately when nothing changed.
orchestrator.onAfterRender = () => {
  rail.setShown(orchestrator.timeline.deployed && !specs.open)
  // WHICH label is up follows whatever the piece already believes is being
  // addressed, and reading it from there rather than wiring the rail to the
  // pointer is what makes the label reachable at all. `timeline.hovered` is the
  // picker's answer OR the rail's own override — see `hoverOverride` — so
  // moving the pointer off a plate and onto that plate's label keeps the same
  // sheet addressed, and the label does not vanish out from under the hand
  // going to click it. The gap between the two is what `LINGER_MS` covers.
  rail.setActive(orchestrator.timeline.hovered)
  rail.update(orchestrator.stage.camera)
}
window.addEventListener('resize', () => rail.measure(), { passive: true })

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
  // AND ONLY WHILE THE STACK IS APART. Closed, the eleven sheets are stacked
  // into one card and the picker still resolves a layer under the pointer for
  // every one of them — so a mouse crossing the closed card rattled off ticks
  // for boundaries that are not visible and cannot be aimed at. A tick is the
  // sound of passing a sheet; with nothing to pass it is the page talking to
  // itself.
  //
  // `deployed` is the TARGET rather than the animation, and that is the right
  // side of the line on both halves of the gesture: opening, the ticks are
  // wanted from the click, while the fan is still coming apart under the
  // pointer; closing, they stop at the click rather than firing one last burst
  // as eleven layers collapse through a pointer that never moved.
  if (!layer || !change.fromPointer || !orchestrator.timeline.deployed) return

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
    ...layerSpecs.flatMap((spec, index) => {
      const sheet = byId.get(spec.layer)
      // A spec naming a layer the composition does not have is a typo in one of
      // the two files, and the honest response is to leave no entry for it
      // rather than to ship a row that does nothing.
      if (!sheet) return []

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'feature-row'

      // The ply, coloured from the layer this row opens rather than from a
      // palette written beside it. `surface` is the same object the shader is
      // built from, so a plate that gets recoloured in `composition.ts` brings
      // its row with it and there is no second place to remember.
      //
      // Four values and not the whole surface: the two gradient stops, the core
      // that shows as the cut edge, and the opacity. A ply in the stack is also
      // frosted, iridescent, woven and lit, and none of that survives being
      // flattened into a 46px bar — what does survive is which colour it is and
      // whether you can see through it, which is exactly what tells one row
      // from another at a glance.
      const ply = document.createElement('span')
      ply.className = 'feature-row__ply'
      ply.setAttribute('aria-hidden', 'true')
      const surface = sheet.layer.surface
      ply.style.setProperty('--ply-a', surface.colorA)
      ply.style.setProperty('--ply-b', surface.colorB)
      ply.style.setProperty('--ply-core', surface.coreColor)
      ply.style.setProperty('--ply-alpha', String(surface.opacity))
      // Its place in the fan. The rows are evenly spaced and the plies are not
      // meant to be, so the step is what turns a column of bars back into the
      // stack from the hero — see `.feature-row__ply` for the measure.
      ply.style.setProperty('--ply-index', String(index))

      const body = document.createElement('span')
      body.className = 'feature-row__body'

      // Eyebrow above the title rather than in a column beside it, which is the
      // order the panel this row opens puts them in. Two arrangements of the
      // same three strings would be two designs for one thing.
      const eyebrow = document.createElement('span')
      eyebrow.className = 'feature-row__eyebrow'
      eyebrow.textContent = spec.eyebrow

      const title = document.createElement('span')
      title.className = 'feature-row__title'
      title.textContent = spec.title

      const summary = document.createElement('span')
      summary.className = 'feature-row__summary'
      summary.textContent = spec.summary

      body.append(eyebrow, title, summary)
      button.append(ply, body)

      button.addEventListener('click', () => {
        sound.resume()
        // Silently, because the layer's own cue is about to play and the two
        // share a voice — one would simply cut the other off mid-word.
        if (!orchestrator.timeline.deployed) setDeployed(true, true)
        openSpecs(sheet, spec)
      })

      const item = document.createElement('li')
      item.className = 'feature-list__item'
      item.appendChild(button)
      return [item]
    }),
  )
}
