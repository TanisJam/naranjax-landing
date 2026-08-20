import { Vector3, type PerspectiveCamera } from 'three'
import type { LayerSpec } from '../../domain/specs'
import type { SheetObject } from '../three/SheetObject'

/**
 * The names of the layers, hung beside the stack once it comes apart.
 *
 * WHAT THIS IS FOR. Opened, the artwork is eleven plates fanned across the
 * screen and it is beautiful and it is MUTE: nothing on it says that the fourth
 * plate down is where dollars live, so the only way to find out is to click one
 * and see. That is a lucky dip, not a menu — and the page already owns the
 * answer, twice over, in `specs.ts` and in the list under `#funciones`. The
 * rail is that answer put where the question is being asked.
 *
 * Beside `SpecsOverlay` and DOM for the same reasons: the text is real text,
 * and the canvas is a fill-rate budget this piece has already bled for, so nine
 * short strings do not go into it.
 *
 * ONLY THE NINE. The two covers have no spec — see the note in `specs.ts`, they
 * are the card rather than a layer of it — so they get no label, and the gap at
 * each end of the rail is the card's own two faces bracketing its contents.
 * That is the composition doing the explaining, and it costs nothing.
 *
 * NOT ON NARROW SCREENS. A rail needs a column of empty page beside the artwork
 * to live in, and a phone has none: the card is already the width of the
 * viewport. Below the breakpoint the rail never draws and the feature list
 * carries the same nine strings — which is the argument `main.ts` already makes
 * for that list existing at all.
 */

/** Below this container width there is no room beside the card, so no rail. */
const MIN_WIDTH = 1024

/**
 * How far clear of the fan's near edge the label column stands, as a share of
 * container width.
 *
 * A COLUMN, not an offset from each plate, and the first version of this got it
 * wrong in a way worth recording. Hanging every label a fixed reach to the
 * right of its own plate reads fine as a sketch and puts all nine ON the
 * artwork in practice: the plates are spread across the middle of the frame, so
 * "just right of the plate" is the middle of the frame too, and nine white
 * labels landed on the coral of the card front where nothing could be read.
 *
 * A gutter fixes both halves at once. The labels sit off the artwork where the
 * page is empty, they align into a column the eye can run down, and what
 * carries the association is the leader rather than proximity — which is what a
 * leader is FOR, and it is how every exploded diagram of anything has ever been
 * annotated.
 *
 * MEASURED PER FRAME rather than set as a share of the viewport, which was the
 * second thing this got wrong. The fan is widest at its near end and how far
 * right that end reaches depends on the aspect — `fitLayout` turns the whole
 * layout about the lens axis as the window changes shape — so a column at a
 * fixed 78% cleared the artwork on a 16:9 laptop and had four labels lying on
 * the plates at the bottom of the same page one aspect later. Taking the widest
 * plate this frame and standing clear of THAT is correct at every size, and it
 * costs a max over nine numbers already being computed.
 */
const RAIL_CLEARANCE = 0.05

/**
 * Widest a label gets, in CSS pixels, and the number is a promise about the
 * copy rather than a measurement of it.
 *
 * The column is pushed right by the artwork and pulled left by the need to fit
 * a label between it and the edge of the page. When those two disagree the
 * artwork wins and the labels are allowed to sit a little closer to the fan
 * than they would like — a label crowding a plate is legible, a label running
 * off the side of the page is not.
 *
 * Reading it off the DOM would be exact and would also be a forced layout per
 * frame on nine elements. `specs.ts` holds the strings; the longest of them at
 * this size and weight measures a little under 180.
 */
const LABEL_WIDTH = 190

/**
 * How long a label stays up after its plate stops being pointed at, in ms.
 *
 * This is not a flourish, it is what makes the label REACHABLE. A label appears
 * because the pointer is on its plate and it sits out in the gutter, so getting
 * to it means crossing empty page — at which point the plate is no longer
 * hovered and, without this, the label is gone before the pointer arrives. The
 * one thing it offers to be clicked would be the one thing that cannot be.
 *
 * Long enough to cross the clearance at an ordinary speed, short enough that a
 * sweep along the fan does not leave a label hanging over the next one. Only
 * ever one is up, so a slow hand sees a label linger and never sees two.
 */
const LINGER_MS = 260

const projected = new Vector3()
/** Where the last `aimAt` landed, in container pixels. Scratch, not state. */
const aim = { x: 0, y: 0 }

export interface LayerRailOptions {
  /** The plates that have something to say, in stack order, with their specs. */
  entries: readonly { sheet: SheetObject; spec: LayerSpec }[]
  /**
   * Every plate in the stack, covers included, for working out how far right
   * the artwork reaches.
   *
   * ALL ELEVEN and not just the labelled nine, because the card back is the
   * plate that reaches furthest right at the bottom of the fan — it is the last
   * one dealt. Clearing only the plates that have labels puts the bottom of the
   * rail on top of the one plate that has none.
   */
  obstacles: readonly SheetObject[]
  /** Light this plate as though the pointer were on it. Null clears it. */
  onAddress: (sheet: SheetObject | null) => void
  /** Open this plate's panel. */
  onOpen: (sheet: SheetObject, spec: LayerSpec) => void
}

interface Rung {
  sheet: SheetObject
  spec: LayerSpec
  root: HTMLElement
  leader: HTMLElement
  /** Where its plate is this frame, in container pixels. */
  plateX: number
  plateY: number
  /** False when the plate is behind the lens; the rung hides rather than flips. */
  ahead: boolean
}

export class LayerRail {
  private readonly root: HTMLElement
  private readonly rungs: readonly Rung[]
  private shown = false
  /** The one rung on screen, or null. See `setActive`. */
  private active: Rung | null = null
  /** Pending clear, so a label survives the reach across to it. */
  private lingerHandle = 0
  /** Cached so the per-frame pass does not measure the container every frame. */
  private width = 0
  private height = 0

  constructor(
    private readonly container: HTMLElement,
    private readonly options: LayerRailOptions,
  ) {
    const root = document.createElement('div')
    root.className = 'layer-rail'
    // The rail is a second route to panels the feature list already reaches, and
    // a screen reader meeting both hears the whole product twice. The list is
    // the one that stays: it is on the page whether or not WebGL ever started.
    root.setAttribute('aria-hidden', 'true')

    this.rungs = options.entries.map(({ sheet, spec }) => {
      const rung = document.createElement('div')
      rung.className = 'layer-rail__rung'

      const leader = document.createElement('span')
      leader.className = 'layer-rail__leader'

      const label = document.createElement('button')
      label.type = 'button'
      // Out of the tab order rather than merely hidden. `aria-hidden` on a
      // focusable element is the one combination worse than either alone: the
      // focus ring lands somewhere the screen reader has been told is empty.
      label.tabIndex = -1
      label.className = 'layer-rail__label'

      const eyebrow = document.createElement('span')
      eyebrow.className = 'layer-rail__eyebrow'
      eyebrow.textContent = spec.eyebrow

      const title = document.createElement('span')
      title.className = 'layer-rail__title'
      title.textContent = spec.title

      label.append(eyebrow, title)
      rung.append(leader, label)
      root.appendChild(rung)

      label.addEventListener('pointerenter', () => options.onAddress(sheet))
      label.addEventListener('pointerleave', () => options.onAddress(null))
      label.addEventListener('click', (event) => {
        // The stage under this is a button too, and a click reaching both would
        // open a panel and then tell the card behind it to shut.
        event.stopPropagation()
        options.onOpen(sheet, spec)
      })

      return { sheet, spec, root: rung, leader, plateX: 0, plateY: 0, ahead: true }
    })

    this.root = root
    container.appendChild(root)
    this.measure()
  }

  /** True while the rail is on screen. */
  get visible(): boolean {
    return this.shown
  }

  /**
   * Shows or hides the rail.
   *
   * The class does the fading; this only says which way. Hiding also drops any
   * address the rail was holding, because a label that leaves under the pointer
   * never receives its own `pointerleave` and would otherwise pin a plate lit
   * for a pointer that is nowhere near it any more.
   */
  setShown(shown: boolean): void {
    if (shown === this.shown) return
    this.shown = shown
    this.root.classList.toggle('layer-rail--shown', shown)
    if (!shown) {
      // Outright rather than on the linger: the rail is leaving, and holding a
      // label up for a quarter second over a card that is already closing is
      // the exact opposite of what the linger is for. The pending timer goes
      // too — it would only fire into an empty rail, but leaving it armed means
      // the next `setActive(null)` finds a handle already set and declines to
      // arm its own, which would strand the first label of the next deploy.
      window.clearTimeout(this.lingerHandle)
      this.lingerHandle = 0
      this.applyActive(null)
      this.options.onAddress(null)
    }
  }

  /**
   * Says which plate is being pointed at, and so which single label is up.
   *
   * ONE AT A TIME, AND THAT IS THE WHOLE DESIGN OF THIS THING. It used to raise
   * all nine the moment the card came apart, which put a block of nine titles
   * down the side of the artwork and made the deploy an event with a wall of
   * text in it. The stack is what the click asked to see. So a label is an
   * answer to pointing at a plate — the reader asks about one ply and gets one
   * name — and the hint under the hero is what says the plates can be pointed
   * at in the first place.
   *
   * Passing null does not clear it immediately; see `LINGER_MS`.
   */
  setActive(sheet: SheetObject | null): void {
    if (sheet) {
      window.clearTimeout(this.lingerHandle)
      this.lingerHandle = 0
      this.applyActive(this.rungs.find((rung) => rung.sheet === sheet) ?? null)
      return
    }

    // Already clear, or already on its way out. Re-arming the timer on every
    // frame the pointer is over nothing would hold the last label up forever.
    if (!this.active || this.lingerHandle) return
    this.lingerHandle = window.setTimeout(() => {
      this.lingerHandle = 0
      this.applyActive(null)
    }, LINGER_MS)
  }

  private applyActive(rung: Rung | null): void {
    if (rung === this.active) return
    this.active?.root.classList.remove('layer-rail__rung--active')
    rung?.root.classList.add('layer-rail__rung--active')
    this.active = rung
  }

  /** Re-reads the container box. Cheap, and only on a resize. */
  measure(): void {
    const rect = this.container.getBoundingClientRect()
    this.width = rect.width
    this.height = rect.height
  }

  /**
   * Puts the one label that is up beside its plate.
   *
   * Called after the draw, with the scene graph already up to date — see
   * `SceneOrchestrator.onAfterRender`. Reading a stale matrix here is a label
   * that trails the artwork by one frame, which on a floating stack shows up as
   * the label swimming against the plate it names.
   *
   * ONE RUNG, so this walks the whole fan for the near edge and then positions
   * exactly one element. Everything the other eight would have cost — their
   * corner projections, their style writes — is not spent.
   *
   * THERE WAS A DECLUTTER PASS HERE AND REMOVING IT WAS THE POINT, not a
   * saving. It pushed overlapping labels apart from the middle outwards, which
   * was necessary while all nine were up at once: the fan opens wider at its
   * near end than its far end, so the labels at the tight end collided and the
   * rail read as one block of text. With a single label on screen there is
   * nothing for it to collide WITH, and all it could do is shove the one label
   * the reader is looking at away from the one plate it belongs to, to make room
   * for eight that are not drawn. A spread that avoids invisible neighbours is
   * strictly worse than no spread.
   *
   * Which is also why the leader is level again. It used to be a length and an
   * angle, because the declutter moved a label off its plate's height and the
   * leader had to swing back to reach it. Nothing moves the label off that
   * height any more, so the drop is zero on every frame and the leader is what
   * it looks like: a horizontal line from the label to the plate.
   */
  update(camera: PerspectiveCamera): void {
    if (!this.shown || this.width < MIN_WIDTH) return

    const rung = this.active
    if (!rung) return

    // THE PLATE'S NEAR CORNER, not its centre. A leader that lands in the
    // middle of a ply lands where eight other plies are stacked over it and
    // says nothing about which one it meant; the fan's whole legibility is at
    // its stepped right edge, where each ply is the only one visible. Aiming
    // there also shortens the leader, so less of it is spent lying across the
    // artwork.
    //
    // NOT the pivot, which looks like the right answer and is the same point
    // for all eleven plates — `SheetObject` sets `pivot.position` from one
    // shared constant and the fan's spread lives under it. And not the real
    // mesh's geometry either; see `nearEdge` for why that is a point at the
    // origin.
    rung.ahead = this.aimAt(rung.sheet, camera)
    rung.plateX = aim.x
    rung.plateY = aim.y

    // Still measured across the WHOLE fan and not just the plate being named.
    // The column has to stand clear of the artwork, and the artwork is all
    // eleven plates however few of them are being talked about — otherwise the
    // label for a plate high in the stack would sit happily on top of the ones
    // below it.
    const railX = Math.min(
      this.nearEdge(camera) + this.width * RAIL_CLEARANCE,
      this.width - LABEL_WIDTH,
    )

    rung.root.style.opacity = rung.ahead ? '' : '0'
    rung.root.style.translate = `${railX}px ${rung.plateY}px`
    // Clamped at zero because a plate can project to the right of the column on
    // a wide screen, and a negative width is a leader that vanishes.
    rung.leader.style.width = `${Math.max(0, railX - rung.plateX)}px`
  }

  dispose(): void {
    window.clearTimeout(this.lingerHandle)
    this.root.remove()
  }

  /**
   * How far right the artwork actually reaches on screen, in container pixels.
   *
   * THE SILHOUETTE, NOT THE ORIGINS, and the difference is most of a plate. A
   * mesh origin sits inside its plate rather than at its corner, so a column
   * placed clear of the furthest origin is still a couple of hundred pixels
   * inside the fan — which is how the labels ended up lying on the plates
   * twice, once from an offset-per-plate and once from this.
   *
   * `hitArea` AND NOT `mesh`, which is the trap `SheetObject` already warns
   * about and which this walked into anyway: the real mesh's `position`
   * attribute is a buffer of zeros and the whole plate is built in the vertex
   * shader, so its bounding box computes to a degenerate point at the origin.
   * Measured on the deployed stack, every one of the eleven boxes came back
   * `0,0,0 → 0,0,0` and the near edge was simply the furthest origin, 300px
   * short of the fan. The flat proxy exists for exactly this reason — the CPU
   * has no other idea where a plate is — and picking already depends on it.
   *
   * Eight corners each, pushed through the world matrix and the camera.
   * Eighty-eight projections a frame is nothing beside what the same frame asks
   * of the GPU, and it beats a world-space `Box3` per plate, which allocates
   * and is looser the moment the stack is turned.
   *
   * The proxy is FLAT and the plates bend, peel and roll. `SheetObject` takes
   * the same approximation for picking and says why; here it means the estimate
   * runs a little short wherever a tail curls up, and `RAIL_CLEARANCE` is what
   * covers the difference.
   */
  private nearEdge(camera: PerspectiveCamera): number {
    let edge = 0
    for (const sheet of this.options.obstacles) {
      if (this.aimAt(sheet, camera) && aim.x > edge) edge = aim.x
    }
    return edge
  }

  /**
   * Projects one plate's proxy and leaves its rightmost corner in `aim`.
   *
   * Returns false when the plate is behind the lens, where the projection is
   * mirrored and every number it produces is on the wrong side of the screen.
   *
   * Eight corners, and the same routine answers both questions this class asks
   * — where to aim a leader, and how far right the artwork reaches — because
   * they are the same measurement taken once per plate and once over all of
   * them. Eighty-eight projections a frame is nothing beside what the same
   * frame is asking of the GPU, and it beats a world-space `Box3`, which
   * allocates and is looser the moment the stack is turned.
   */
  private aimAt(sheet: SheetObject, camera: PerspectiveCamera): boolean {
    const geometry = sheet.hitArea.geometry
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    const box = geometry.boundingBox
    if (!box) return false

    let found = false
    let bestX = -Infinity
    let bestY = 0

    for (let corner = 0; corner < 8; corner++) {
      projected.set(
        corner & 1 ? box.max.x : box.min.x,
        corner & 2 ? box.max.y : box.min.y,
        corner & 4 ? box.max.z : box.min.z,
      )
      projected.applyMatrix4(sheet.hitArea.matrixWorld).project(camera)
      if (projected.z > 1) continue

      const x = (projected.x * 0.5 + 0.5) * this.width
      if (x > bestX) {
        bestX = x
        bestY = (-projected.y * 0.5 + 0.5) * this.height
        found = true
      }
    }

    if (!found) return false
    aim.x = bestX
    aim.y = bestY
    return true
  }
}
