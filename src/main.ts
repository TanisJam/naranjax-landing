import './style.css'
import { SceneOrchestrator } from './sheets/application/SceneOrchestrator'
import { composition } from './sheets/domain/composition'

const stage = document.querySelector<HTMLElement>('#sheets-stage')
if (!stage) throw new Error('#sheets-stage container is missing')

// The canvas is transparent, so the panel's own background shows through and
// the artwork keeps the page's colour at every viewport.
const orchestrator = new SceneOrchestrator(stage, composition)
orchestrator.start()

if (import.meta.env.DEV) {
  // Handle for the console and for automated checks — draw order and blend
  // behaviour are only observable while the piece is moving, so they need a
  // way in from outside. DEV-guarded, so it never reaches a build.
  Object.assign(window, { __sheets: orchestrator })
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

const setDeployed = (deployed: boolean): void => {
  orchestrator.timeline.deployTarget = deployed ? 1 : 0
  stage.setAttribute('aria-expanded', String(deployed))
  stage.setAttribute(
    'aria-label',
    deployed ? 'Armar la tarjeta' : 'Ver las capas de la tarjeta',
  )
  if (hint) hint.textContent = deployed ? 'Toca para armarla' : 'Toca para ver sus capas'
}

stage.addEventListener('click', () => setDeployed(!orchestrator.timeline.deployed))

// A div with a button role gets none of a button's keyboard behaviour for free,
// and both keys have to be handled: Enter fires on keydown, Space would
// otherwise scroll the page out from under the panel.
stage.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  setDeployed(!orchestrator.timeline.deployed)
})

setDeployed(false)

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
