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
 * Only the pointer cue needs one. Sweeping across the open stack crosses
 * several layers in a few frames, and a tick per layer boundary is the intent;
 * a tick per *frame* is a rattle. The transitions retrigger freely because a
 * click that reverses the animation should reverse the sound with it.
 */
const RETRIGGER_GUARD: Record<SoundName, number> = { open: 0, close: 0, pick: 0.07 }

export class SoundBoard {
  /** Nothing plays while this is set. Left public for a future mute control. */
  muted = false

  /** Resolves once every cue is decoded, or once they are known to have failed. */
  readonly ready: Promise<void>

  private readonly context: AudioContext | null
  private readonly buffers = new Map<SoundName, AudioBuffer>()
  private readonly lastPlayed = new Map<SoundName, number>()

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

  play(name: SoundName): void {
    const context = this.context
    const buffer = this.buffers.get(name)
    if (!context || !buffer || this.muted || context.state !== 'running') return

    const now = context.currentTime
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < RETRIGGER_GUARD[name]) return
    this.lastPlayed.set(name, now)

    const gain = context.createGain()
    gain.gain.value = this.gains[name]
    gain.connect(context.destination)

    const source = context.createBufferSource()
    source.buffer = buffer
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

    source.start()
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
