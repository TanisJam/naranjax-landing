/**
 * The five things the page does while it is scrolled.
 *
 * Two of them are traced from Naranja X's careers site, and they are traced
 * from the SOURCE rather than from the look of them: that site ships an Angular
 * directive that adds a hidden state, watches for a tenth of the element to
 * enter the viewport, plays one 700ms keyframe and stops watching — and a
 * header that writes its own offset on the scroll direction. Neither uses a
 * scroll library, and neither needs one, which is the whole reason this file
 * adds no dependency.
 *
 * The other three are this page's: the card is launched out of the hero while
 * the claim rises into the room it leaves, the figures count up as their card
 * arrives, and the closing ribbon takes its speed from the reader's scrolling.
 *
 * What is deliberately NOT here is anything that reads layout every frame. The
 * hero is a WebGL canvas rendering continuously a few pixels away; a scroll
 * handler that measured an element would be forcing a synchronous layout in
 * the middle of that, every frame, for a fade. So: the observers cost nothing
 * between intersections, the one scroll listener reads one number, and the
 * ribbon is driven by the playback rate of an animation the compositor already
 * owns rather than by a transform written from here.
 */

/** A frame's worth of scrolling: how far it moved, and where it ended up. */
type ScrollListener = (moved: number, y: number) => void

/**
 * Everything the page does while it is scrolled, wired to a document.
 *
 * Called once, from `main.ts`, after the stage exists — the order matters only
 * in that the reveal must not be armed before the markup it hides is there.
 */
export function startPageMotion(): void {
  // The stylesheet hides nothing until this exists. A page whose bundle failed
  // to arrive is then a page that simply shows its content, instead of a blank
  // one with everything sitting at `opacity: 0` waiting for a script that is
  // never coming. See the note on `[data-motion]` in `src/style.css`.
  document.documentElement.dataset.motion = 'on'

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const onScrollFrame = watchScroll()

  if (!reduced.matches) {
    revealOnScroll()
    driveHeroWithScroll(onScrollFrame)
    driveRibbonWithScroll(onScrollFrame)
  }
  hideHeaderGoingDown(onScrollFrame)
}

/**
 * One passive listener and one frame, however many things want to be told.
 *
 * Two consumers each installing their own listener is two handlers running in
 * the same frame to read the same number, and `scrollY` is the one number on
 * this page that everything agrees about. So it is read once and handed out.
 *
 * Passive, because no handler here ever prevents the scroll it is told about —
 * and a listener that does not say so blocks the compositor from scrolling
 * until it has run. Coalesced into a frame, because two scroll events in one
 * frame can only ever describe one movement.
 *
 * The delta is per frame rather than since some anchor: it is the raw material
 * both consumers want, and each of them decides what counts as a movement.
 */
function watchScroll(): (listener: ScrollListener) => void {
  const listeners: ScrollListener[] = []
  let last = Math.max(0, window.scrollY)
  let queued = false

  const update = (): void => {
    queued = false
    const y = Math.max(0, window.scrollY)
    const moved = y - last
    last = y
    for (const listener of listeners) listener(moved, y)
  }

  window.addEventListener(
    'scroll',
    () => {
      if (queued) return
      queued = true
      requestAnimationFrame(update)
    },
    { passive: true },
  )

  return (listener: ScrollListener) => {
    listeners.push(listener)
  }
}

/** How far into the hero the card stops following the page and starts leaving. */
const LAUNCH_AT = 0.1
/** How many extra hero-heights it covers by the time the hero is gone. */
const LAUNCH_REACH = 1.6
/** How far the claim comes up over that same run, as a share of the hero. */
const CLAIM_REACH = 0.42
/** And where in the run it starts going, rather than merely moving. */
const CLAIM_FADE_AT = 0.55

/**
 * The card leaves faster than the page, and the claim takes the room it left.
 *
 * Nothing happens for the first tenth: the reader who nudges the page is not
 * asking for the hero to come apart, and a card that reacts to two pixels is a
 * card that can never be looked at. After that the offset goes with the SQUARE
 * of how far through the hero the reader is, so the card starts by drifting and
 * ends up leaving — by the bottom of the hero it has covered its own screen
 * plus half of another, which is well past anything a reader can follow. That
 * curve is the whole effect: a card that pulled away linearly reads as a
 * parallax layer, and the same distance covered late reads as a launch.
 *
 * The claim comes up linearly over the same run, and at a quarter of the reach.
 * Two speeds is what makes them read as one gesture — the card is not merely
 * leaving, it is handing the middle of the screen over — and going up rather
 * than staying put is what keeps the type in the room the card used to hold
 * instead of sliding off the bottom with the section.
 *
 * The hero's height is read from a `ResizeObserver` and never from a scroll
 * frame. Every write below is a custom property that resolves to a translate,
 * so there is no layout to force and no style to compute here beyond the two
 * elements' own transforms — which is the whole reason this can run in the same
 * frames the WebGL card is being drawn in.
 */
function driveHeroWithScroll(onScrollFrame: (listener: ScrollListener) => void): void {
  const hero = document.querySelector<HTMLElement>('#hero')
  const stage = document.querySelector<HTMLElement>('#sheets-stage')
  const claim = document.querySelector<HTMLElement>('.hero-claim')
  if (!hero || !stage || !claim) return

  let height = hero.offsetHeight
  new ResizeObserver(() => {
    height = hero.offsetHeight
  }).observe(hero)

  let launched = -1

  const apply = (y: number): void => {
    if (height === 0) return
    const next = Math.min(1, Math.max(0, (y / height - LAUNCH_AT) / (1 - LAUNCH_AT)))
    // Above the launch point this is zero and below the hero it is one, so the
    // reader at the top of the page and the reader down at the ribbon both cost
    // exactly one comparison per frame and no style write at all.
    if (next === launched) return
    launched = next
    stage.style.setProperty('--hero-exit', `${(-next * next * LAUNCH_REACH * height).toFixed(1)}px`)
    claim.style.setProperty('--claim-rise', `${(-next * CLAIM_REACH * height).toFixed(1)}px`)
    const fade = 1 - Math.max(0, (next - CLAIM_FADE_AT) / (1 - CLAIM_FADE_AT))
    claim.style.setProperty('--claim-fade', fade.toFixed(3))
  }

  // Once at startup, because a reload restores the reader's place: arriving
  // halfway down the page would otherwise leave the hero in its resting state
  // until something moved.
  apply(Math.max(0, window.scrollY))
  onScrollFrame((_moved, y) => apply(y))
}

/**
 * The two ways a block can arrive.
 *
 * The first is the reference's own, and it is theirs down to the fifty pixels
 * and the easing. The second is for the row of figures, which the reference
 * treats as five separate claims rather than as a row — so they come in from
 * the side, each one turned a little away from the reader and swinging square
 * as it lands. It is one card being dealt after another, which is what a row of
 * five cards should look like arriving, and the perspective is written into the
 * transform rather than onto a parent so no element on this page needs a 3D
 * context it does not otherwise have.
 */
const ENTRANCES: Record<string, { keyframes: Keyframe[]; easing: string }> = {
  up: {
    keyframes: [
      { opacity: 0, transform: 'translateY(50px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    easing: 'ease-in-out',
  },
  side: {
    keyframes: [
      { opacity: 0, transform: 'perspective(900px) translateX(72px) rotateY(-24deg)' },
      { opacity: 1, transform: 'perspective(900px) translateX(0) rotateY(0deg)' },
    ],
    // Overshoots nothing and decelerates hard, so the card is nearly square for
    // most of the run and the turn is read at the start rather than at the end.
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
}

/**
 * Each marked element rises fifty pixels into place, once.
 *
 * The threshold, the distance, the duration and the easing are all theirs. So
 * is `unobserve` — an element that keeps being watched after it has arrived is
 * an element that plays its entrance again every time the reader scrolls back,
 * and an entrance that repeats stops being an entrance.
 *
 * `data-reveal-delay` is the one addition, and it is what makes a row of four
 * cards read as a row: without it they all arrive in the same frame, which is
 * indistinguishable from them having been there all along. The same delay is
 * handed to any figure inside, so a card and its number are one arrival rather
 * than two.
 */
function revealOnScroll(): void {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const element = entry.target as HTMLElement
        observer.unobserve(element)
        const delay = Number(element.dataset.revealDelay ?? 0)
        const entrance = ENTRANCES[element.dataset.reveal || 'up'] ?? ENTRANCES.up
        element.animate(entrance.keyframes, {
          duration: 700,
          delay,
          easing: entrance.easing,
          fill: 'forwards',
        })
        for (const figure of element.querySelectorAll<HTMLElement>('[data-count]')) {
          countUp(figure, delay)
        }
      }
    },
    { threshold: 0.1 },
  )

  for (const element of document.querySelectorAll<HTMLElement>('[data-reveal]')) {
    observer.observe(element)
  }
}

/**
 * Longer than the card it rides on, and that is the point.
 *
 * The card takes 700ms to arrive and the number is still moving when it lands,
 * so the figure is the last thing to settle in that corner of the screen —
 * which is the only reason to count a number up at all. Matched durations
 * would just be the card fading in with a busy texture inside it.
 */
const COUNT_DURATION = 1100

/**
 * A figure this page is willing to count, and nothing else.
 *
 * Prefix, a whole part written either plainly or in groups of three, an
 * optional decimal, suffix. It is strict on purpose, because half these values
 * are not numbers: the four figures on this page include `La segunda` and
 * `24/7`, and a loose parser turns the second one into a count to twenty-four
 * with a `/7` stuck on the end. Anything that does not match is left exactly as
 * the brand wrote it.
 */
const FIGURE = /^([^\d]*)(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d+))?([^\d]*)$/

/**
 * One figure, counted from zero to what the markup already says.
 *
 * The markup carries the FINAL value — the reader without a bundle, and the
 * scraper, get the number rather than a zero — so this reads it, zeroes the
 * element while the card is still invisible, and puts the original string back
 * on the last frame. Verbatim, rather than formatted one more time: these are
 * the brand's own figures and the end of an animation is not where you want to
 * discover that a locale groups thousands differently than the copy does.
 *
 * Zero is skipped along with the words. A count from zero to zero is a tenth of
 * a second of nothing, and `$0` is a headline about not paying rather than a
 * quantity that grew.
 */
function countUp(element: HTMLElement, delay: number): void {
  const printed = element.textContent ?? ''
  const figure = FIGURE.exec(printed)
  if (!figure) return

  const [, prefix, whole, fraction, suffix] = figure
  const decimals = fraction?.length ?? 0
  const target = Number(`${whole.replaceAll('.', '')}.${fraction ?? '0'}`)
  if (!Number.isFinite(target) || target === 0) return

  const format = new Intl.NumberFormat(document.documentElement.lang || 'es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    // Grouped only if the brand grouped it. Spanish groups from five digits up,
    // so a locale left to itself prints `+4.000` as `4000` all the way and then
    // snaps to the dotted version at the end — a separator appearing out of
    // nowhere on the last frame.
    useGrouping: whole.includes('.'),
  })

  element.textContent = `${prefix}${format.format(0)}${suffix}`

  // The delay is the card's, and during it the card is still at `opacity: 0`:
  // the reveal's `fill: 'forwards'` does not paint anything before it starts,
  // so nobody ever sees the zero this element is holding.
  const start = performance.now() + delay
  const step = (now: number): void => {
    const progress = (now - start) / COUNT_DURATION
    if (progress >= 1) {
      element.textContent = printed
      // The tabular figures in `src/style.css` hang on this attribute, and they
      // are wanted only while the digits are being redrawn. The value the
      // reader actually reads keeps the figures the typeface was drawn with.
      element.removeAttribute('data-count')
      return
    }
    // Decelerating, so the number spends its last three tenths almost where it
    // is going to stop. A linear count arrives at full speed and stops dead,
    // which reads as a counter being switched off rather than as a figure
    // settling.
    if (progress > 0) element.textContent =
      `${prefix}${format.format(target * (1 - (1 - progress) ** 3))}${suffix}`
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/** How much of a frame's scrolling the ribbon takes as speed. */
const RIBBON_PULL = 1.6
/** And the most it will ever take, however hard the page is flung. */
const RIBBON_LIMIT = 90
/** How fast it forgets, per frame, once the scrolling stops. */
const RIBBON_SETTLE = 0.08
/** The speed it drifts at when nobody is doing anything: its authored one. */
const RIBBON_REST = 1

/**
 * The closing ribbon takes its speed from the reader.
 *
 * At rest it is the 400-second drift the stylesheet authored, which is slow
 * enough that nothing is ever seen to move. Scrolling down pushes it along,
 * scrolling up drags it back through a standstill and into reverse, and a
 * second after the reader stops it is drifting again. It is the same words
 * either way — what changes is that the ribbon is now clearly attached to the
 * hand on the trackpad instead of running on its own clock.
 *
 * `playbackRate` rather than a new animation, a duration swap or a transform
 * written from here, and this is the whole design. The three lines are already
 * running on the compositor; changing the rate of a running animation keeps
 * them there and keeps their position continuous, so the ribbon never jumps and
 * this file never touches a style. Restarting them with a new duration would
 * do both.
 *
 * Nothing happens at all while the ribbon is off screen. It sits at the very
 * bottom of the page and the reader spends the first screen looking at a WebGL
 * canvas: those frames are the ones worth protecting, and they are exactly the
 * ones where this has nothing to say.
 */
function driveRibbonWithScroll(onScrollFrame: (listener: ScrollListener) => void): void {
  const ribbon = document.querySelector<HTMLElement>('.marquee')
  if (!ribbon) return

  let lines: Animation[] = []
  let onScreen = false

  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      onScreen = entry.isIntersecting
      // Asked for on the first sighting rather than at startup. At startup the
      // keyframes may not have been created yet and the question forces the
      // style resolution that creates them — in the frame where the card is
      // booting, for an element nobody is looking at. An empty list here is a
      // reader whose stylesheet stopped the ribbon, and then there is nothing
      // to drive and nothing below ever runs.
      if (onScreen && lines.length === 0) {
        lines = [...ribbon.querySelectorAll('.marquee__line')].flatMap((line) =>
          line.getAnimations(),
        )
      }
    }
  })
  watcher.observe(ribbon)

  let rate = RIBBON_REST
  let settling = false

  const write = (): void => {
    for (const line of lines) line.playbackRate = rate
  }

  const settle = (): void => {
    rate += (RIBBON_REST - rate) * RIBBON_SETTLE
    if (Math.abs(rate - RIBBON_REST) < 0.05) {
      rate = RIBBON_REST
      settling = false
    }
    write()
    if (settling) requestAnimationFrame(settle)
  }

  onScrollFrame((moved) => {
    if (!onScreen || lines.length === 0) return
    rate = Math.min(RIBBON_LIMIT, Math.max(-RIBBON_LIMIT, RIBBON_REST + moved * RIBBON_PULL))
    write()
    // While the reader is still scrolling this loop is overwritten every frame
    // by the line above and does nothing visible. It only becomes the ribbon's
    // brake in the frame after the last scroll event, which is the one moment
    // there is nobody left to ask.
    if (!settling) {
      settling = true
      requestAnimationFrame(settle)
    }
  })
}

/**
 * The bar steps out of the way going down and comes back going up.
 *
 * The threshold is what keeps it honest. Without one, a scroll of two pixels —
 * which is what a phone does when it settles, and what a trackpad does at the
 * end of a flick — is a direction change, and the bar spends the whole page
 * flickering. Six pixels is under what a reader can produce deliberately and
 * over what a device produces by accident.
 *
 * Measured against its own anchor rather than against the frame delta the
 * dispatcher hands out, and the difference matters: a slow drag arrives as two
 * pixels a frame forever, and a bar that compares each frame to the last one
 * would never see six of them and would never move.
 *
 * Nothing is hidden while the reader is still in the hero: the bar is the only
 * way off that screen and taking it away at the first flick would be taking
 * away the navigation of a page that has not started yet.
 */
function hideHeaderGoingDown(onScrollFrame: (listener: ScrollListener) => void): void {
  const header = document.querySelector<HTMLElement>('#site-header')
  if (!header) return

  let anchor = Math.max(0, window.scrollY)
  let scrolled = false

  onScrollFrame((_moved, y) => {
    // Whether the page has moved under the bar at all, which is a different
    // question from whether it should be hiding and is asked outside the
    // threshold below on purpose: the six pixels exist to stop a direction from
    // flickering, and a reader creeping down three pixels at a time would
    // otherwise never be told they had left the top of the page. One comparison
    // a frame, and a write only on the crossing.
    if ((y > 96) !== scrolled) {
      scrolled = y > 96
      header.dataset.scrolled = String(scrolled)
    }

    const moved = y - anchor
    if (Math.abs(moved) < 6) return
    header.dataset.hidden = String(moved > 0 && y > 96)
    anchor = y
  })
}
