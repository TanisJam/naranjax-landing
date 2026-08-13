/**
 * The page's three sound effects.
 *
 * Web Audio rather than `<audio>` elements: these are short cues that have to
 * fire on the same frame as the thing they answer, retrigger before they have
 * finished, and cut each other off. An `HTMLAudioElement` gives none of that —
 * it cannot overlap with itself, and rewinding one mid-play is audible.
 *
 * Deliberately not part of `src/sheets/`. The engine is vendored, and sound is
 * something this page does with it.
 */

export type SoundName = 'open' | 'close' | 'pick'

/**
 * How long a cue waits before it will retrigger, in seconds.
 *
 * The pointer cue used to hold 0.07 here to keep a fast sweep from rattling.
 * The rattle is now the point — a riffle across a deck IS a dense run of the
 * same tick — so the guard is gone and the crowding below does the work
 * instead. A time gate would have thrown away exactly the ticks that make the
 * sweep sound fast, since a flick crosses four layers inside a single frame.
 * The transitions retrigger freely because a click that reverses the animation
 * should reverse the sound with it.
 */
const RETRIGGER_GUARD: Record<SoundName, number> = { open: 0, close: 0, pick: 0 }

/**
 * How long a voice counts as crowding the ones after it, in seconds.
 *
 * Roughly the length of the pointer tick. Past that it has decayed far enough
 * that the next one is a separate sound rather than a layer on top of it.
 */
const CROWD_WINDOW = 0.12

/**
 * Voices one cue may stack inside that window.
 *
 * Eleven layers crossed in two frames is a real gesture and it should be
 * audible as one. Sixty is a stuck pointer or a hand of God on the mouse, and
 * the honest answer to that is to stop adding voices, not to render them.
 */
const MAX_CROWD = 12

/** Per-voice shaping. Everything here defaults to "as authored". */
export interface PlayOptions {
  /** Seconds from now to start. Lets a burst keep its captured spacing. */
  delay?: number
  /** Playback rate. Above 1 the cue is shorter and brighter. */
  rate?: number
  /** Multiplies the cue's authored level. */
  gain?: number
}

export class SoundBoard {
  /** Nothing plays while this is set. Left public for a future mute control. */
  muted = false

  /** Resolves once every cue is decoded, or once they are known to have failed. */
  readonly ready: Promise<void>

  private readonly context: AudioContext | null
  private readonly buffers = new Map<SoundName, AudioBuffer>()
  private readonly lastPlayed = new Map<SoundName, number>()
  /** Start times inside `CROWD_WINDOW`, per cue. See `crowd`. */
  private readonly recentStarts = new Map<SoundName, number[]>()

  /**
   * Open and close share one voice, so a reversal cuts rather than layers.
   * Two half-second cues playing over each other is mud, and it is exactly what
   * an impatient double click would produce.
   */
  private transition: AudioBufferSourceNode | null = null

  constructor(
    private readonly sources: Record<SoundName, string>,
    private readonly gains: Record<SoundName, number>,
  ) {
    // Constructed suspended, which is allowed without a gesture, and decoded
    // right away — so the buffers are ready long before anything can ask for
    // them and the first click is never the one that pays for the decode.
    this.context = typeof AudioContext === 'function' ? new AudioContext() : null
    this.ready = this.load()
  }

  /**
   * Hands the browser its gesture. Autoplay policy keeps the context suspended
   * until a real interaction, and pointer movement does not count — so the
   * pointer cue is silent until the first click, which is the policy working
   * rather than a bug to route around.
   */
  resume(): void {
    if (this.context?.state === 'suspended') void this.context.resume()
  }

  /** Decoded length of a cue, for whatever has to run exactly as long as it. */
  duration(name: SoundName): number | null {
    return this.buffers.get(name)?.duration ?? null
  }

  /**
   * Plays a cue.
   *
   * `delay` exists so a burst can keep the rhythm it was captured with. The
   * pointer crossings of one frame did not happen at the same instant — the
   * pointer samples carry their real spacing — and starting them together
   * collapses a run of ticks into a single flam.
   *
   * `rate` and `gain` are what turn one sample into a scrape rather than a
   * stuck button. Forty identical copies of a tick read as a broken loop; the
   * same forty detuned a few percent read as card stock. Rate also shortens the
   * tick as it raises it, which is what a faster gesture should sound like.
   */
  play(name: SoundName, options: PlayOptions = {}): void {
    const context = this.context
    const buffer = this.buffers.get(name)
    if (!context || !buffer || this.muted || context.state !== 'running') return

    const start = context.currentTime + Math.max(options.delay ?? 0, 0)
    if (start - (this.lastPlayed.get(name) ?? -Infinity) < RETRIGGER_GUARD[name]) return
    this.lastPlayed.set(name, start)

    const crowd = this.crowd(name, start)
    if (crowd >= MAX_CROWD) return

    const gain = context.createGain()
    // Voices sum, so a dense burst at full level is louder than anything else
    // on the page and clips on the way out. Square root rather than a plain
    // divide: the burst still gets to grow, it just stops growing linearly.
    gain.gain.value = (this.gains[name] * (options.gain ?? 1)) / Math.sqrt(1 + crowd)
    gain.connect(context.destination)

    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = Math.max(options.rate ?? 1, 0.01)
    source.connect(gain)
    // Nodes are single-use; releasing the gain with them keeps a long session
    // from accumulating a graph of finished voices.
    source.onended = () => {
      source.disconnect()
      gain.disconnect()
      if (this.transition === source) this.transition = null
    }

    if (name !== 'pick') {
      this.transition?.stop()
      this.transition = source
    }

    source.start(start)
  }

  /**
   * How many voices of this cue are already inside `CROWD_WINDOW`, counting the
   * one about to start. Both the level and the ceiling read it: a tick that
   * lands alone should sound exactly as it always did, and only a pile-up
   * should be pulled down.
   */
  private crowd(name: SoundName, at: number): number {
    const live = (this.recentStarts.get(name) ?? []).filter((time) => at - time < CROWD_WINDOW)
    this.recentStarts.set(name, live)
    live.push(at)
    return live.length - 1
  }

  dispose(): void {
    this.transition?.stop()
    void this.context?.close()
  }

  private async load(): Promise<void> {
    const context = this.context
    if (!context) return

    await Promise.all(
      (Object.keys(this.sources) as SoundName[]).map(async (name) => {
        try {
          const response = await fetch(this.sources[name])
          this.buffers.set(name, await context.decodeAudioData(await response.arrayBuffer()))
        } catch {
          // A missing or undecodable cue costs its sound and nothing else. The
          // page is not about the audio.
        }
      }),
    )
  }
}
