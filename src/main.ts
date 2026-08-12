import './style.css'
import closeSound from '../sound-effects/close.mp3?url'
import openSound from '../sound-effects/open.mp3?url'
import pickSound from '../sound-effects/pick.mp3?url'
import { SceneOrchestrator } from './sheets/application/SceneOrchestrator'
import { composition } from './sheets/domain/composition'
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
  { open: openSound, close: closeSound, pick: pickSound },
  { open: 0.55, close: 0.55, pick: 0.3 },
)

if (import.meta.env.DEV) {
  // Handles for the console and for automated checks. Draw order, blend
  // behaviour and which cue fired are only observable while the piece is
  // running, so they need a way in from outside. DEV-guarded, so neither
  // reaches a build.
  Object.assign(window, { __sheets: orchestrator, __sound: sound })
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
  // The hover keeps its highlight and loses its slide. The feedback is the
  // point; the layer travelling to deliver it is not.
  orchestrator.timeline.hoverSlide = still ? 0 : motion.hoverSlide
  if (orchestrator.parallax) orchestrator.parallax.enabled = !still
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
  applyMotionPreference()
})

// A hidden tab and a scrolled-away panel both cost a full frame budget for
// pixels nobody sees. Stop on either, and only resume when both allow it.
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
    deployed ? 'Armar la tarjeta' : 'Ver las capas de la tarjeta',
  )
  if (hint) hint.textContent = deployed ? 'Toca para armarla' : 'Toca para ver sus capas'
  if (!silent) sound.play(deployed ? 'open' : 'close')
}

// Ahead of the click, so the context is running by the time the cue is asked
// for. `pointerdown` is a gesture as far as the autoplay policy is concerned.
stage.addEventListener('pointerdown', () => sound.resume(), { passive: true })

stage.addEventListener('click', () => setDeployed(!orchestrator.timeline.deployed))

// A div with a button role gets none of a button's keyboard behaviour for free,
// and both keys have to be handled: Enter fires on keydown, Space would
// otherwise scroll the page out from under the panel.
stage.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  sound.resume()
  setDeployed(!orchestrator.timeline.deployed)
})

// Entering a layer is the event. Leaving one is not — a cue on the way out
// doubles every crossing and turns a sweep across the stack into a stutter.
// And only when the pointer put it there: the artwork floats, so a boundary
// can wander across a still pointer on its own, and answering that with a
// click in someone's ears is answering something they did not do.
orchestrator.picker.onChange = (layer, fromPointer) => {
  if (layer && fromPointer) sound.play('pick')
}

setDeployed(false, true)

// The step only advances once a tax id is present; the button ships disabled,
// exactly as the design shows it.
const form = document.querySelector<HTMLFormElement>('#w8ben-form')
const taxId = document.querySelector<HTMLInputElement>('#tax-id')
const submit = document.querySelector<HTMLButtonElement>('#submit-step')

if (form && taxId && submit) {
  taxId.addEventListener('input', () => {
    submit.disabled = taxId.value.trim().length === 0
  })

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    // Wiring point for the real step transition. The artwork closes back into a
    // card so the next step starts from the same place this one did.
    setDeployed(false)
  })
}
