/**
 * The page's sound effects.
 *
 * Web Audio rather than `<audio>` elements: these are short cues that have to
 * fire on the same frame as the thing they answer, retrigger before they have
 * finished, and cut each other off. An `HTMLAudioElement` gives none of that —
 * it cannot overlap with itself, and rewinding one mid-play is audible.
 *
 * Deliberately not part of `src/sheets/`. The engine is vendored, and sound is
 * something this page does with it.
 */

/**
 * `specOpen` and `specClose` score a layer being brought up to be read, and are
 * shorter than the two that score the whole stack coming apart — the gesture is
 * one sheet, not eleven, and the cue is what says so.
 */
export type SoundName = 'open' | 'close' | 'pick' | 'specOpen' | 'specClose'

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
const RETRIGGER_GUARD: Record<SoundName, number> = {
  open: 0,
  close: 0,
  pick: 0,
  specOpen: 0,
  specClose: 0,
}

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

/**
 * The haptic band, in Hz.
 *
 * Not a musical choice, and not tuned by ear. A phone's haptics are a mass on
 * a spring, and a spring has one resonance: an iPhone's Taptic Engine sits near
 * 230Hz, an Android LRA near 175. A pulse inside that band is the sound those
 * actuators actually make, which is why it reads as a tap against the case
 * rather than as a note.
 *
 * One frequency for every cue, for the same reason. An actuator cannot be
 * retuned per gesture — it rings where it rings, and only how hard it is driven
 * changes. So the cues below differ in envelope and level and in nothing else.
 */
const HAPTIC_FREQUENCY = 210

/** The pulse laid under a cue, if it gets one. */
interface Haptic {
  /**
   * Seconds from silence to peak. Short, but never zero: a gain that steps
   * straight to full is a discontinuity, and a discontinuity is a click — the
   * one sound this must not make, since masking clicks is half its job.
   */
  attack: number
  /** Seconds from peak to silence. */
  decay: number
  /** Peak gain, before crowding and before the caller's own multiplier. */
  level: number
}

/**
 * Which cues carry a pulse, and how hard.
 *
 * These sit *under* the samples rather than replacing them, and the pairing is
 * what makes them work on hardware that cannot reproduce 210Hz at all. A laptop
 * or phone speaker rolls off long before it gets down here — but the mp3 is
 * still there carrying the transient, so a small speaker plays the cue it always
 * played and anything with real low end gets the body underneath it.
 *
 * Scaled by weight of gesture: the whole stack coming apart is the heaviest
 * thing on the page and rings longest, a layer opening is lighter, and the
 * pointer tick is barely there — it fires dozens of times in a sweep and a pulse
 * that announced itself would turn a riffle into a drum roll.
 */
const HAPTICS: Record<SoundName, Haptic | null> = {
  open: { attack: 0.003, decay: 0.075, level: 0.5 },
  close: { attack: 0.003, decay: 0.075, level: 0.5 },
  pick: { attack: 0.002, decay: 0.022, level: 0.18 },
  specOpen: { attack: 0.002, decay: 0.05, level: 0.34 },
  specClose: { attack: 0.002, decay: 0.05, level: 0.34 },
}

/**
 * The one node everything plays into.
 *
 * A limiter, and it is what buys the dynamics above. Every voice on this page
 * used to be scaled down in advance so that the worst case — a fast riffle
 * stacking a dozen of them — could not clip. Paying that cost up front means
 * paying it always: the quiet gestures were fine and the loud ones were held
 * back to protect a ceiling nothing else was near.
 *
 * With a ceiling that enforces itself, the cues are free to be authored for how
 * hard the gesture actually was, and only a genuine pile-up gets pulled down —
 * at the moment it happens, rather than in every constant in the file.
 */
function createLimiter(context: AudioContext): DynamicsCompressorNode {
  const limiter = context.createDynamicsCompressor()
  limiter.threshold.value = -6
  // No knee and a ratio this steep is a limiter rather than a compressor: below
  // the threshold it does nothing at all, so ordinary single cues come through
  // exactly as authored and never sound processed.
  limiter.knee.value = 0
  limiter.ratio.value = 20
  // Slow enough to let the leading edge of a knock through — catching the
  // transient is what would make a fast sweep sound blunted instead of loud —
  // and short enough to recover before the next gesture.
  limiter.attack.value = 0.002
  limiter.release.value = 0.12
  limiter.connect(context.destination)
  return limiter
}

/** Per-voice shaping. Everything here defaults to "as authored". */
export interface PlayOptions {
  /** Seconds from now to start. Lets a burst keep its captured spacing. */
  delay?: number
  /** Playback rate. Above 1 the cue is shorter and brighter. */
  rate?: number
  /** Multiplies the cue's authored level. */
  gain?: number
  /**
   * How hard the gesture struck, as a multiplier on the pulse alone. Above 1 it
   * hits harder than authored.
   *
   * Separate from `gain` because the two answer different questions. `gain`
   * shapes a recording — a faster sweep wants a lighter, brighter sample so a
   * run of them reads as one texture. `force` is how much energy went into the
   * actuator, and a gesture with more energy in it has to produce more, or the
   * feedback is lying about what the hand just did.
   */
  force?: number
}

export class SoundBoard {
  /** Nothing plays while this is set. Left public for a future mute control. */
  muted = false

  /** Resolves once every cue is decoded, or once they are known to have failed. */
  readonly ready: Promise<void>

  private readonly context: AudioContext | null
  /** Every voice connects here rather than to the destination. */
  private readonly master: DynamicsCompressorNode | null
  private readonly buffers = new Map<SoundName, AudioBuffer>()
  private readonly lastPlayed = new Map<SoundName, number>()
  /** Start times inside `CROWD_WINDOW`, per cue. See `crowd`. */
  private readonly recentStarts = new Map<SoundName, number[]>()

  /**
   * Open and close share one voice, so a reversal cuts rather than layers.
   * Two half-second cues playing over each other is mud, and it is exactly what
   * an impatient double click would produce.
   *
   * The pulses are deliberately not enrolled here. Cutting a sine partway
   * through its ring stops it at whatever amplitude it happened to be at, and
   * that step back to silence is a click — this would be the one place in the
   * file that manufactures the artefact the envelope exists to avoid. They are
   * tens of milliseconds long and they are allowed to finish: a reversal fast
   * enough to overlap two of them is a gesture that really did knock twice.
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
    this.master = this.context ? createLimiter(this.context) : null
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

    const rate = Math.max(options.rate ?? 1, 0.01)
    const level = this.gains[name] * (options.gain ?? 1)

    const gain = context.createGain()
    // Voices sum, so a dense burst at full level is louder than anything else
    // on the page and clips on the way out. Square root rather than a plain
    // divide: the burst still gets to grow, it just stops growing linearly.
    gain.gain.value = level / Math.sqrt(1 + crowd)
    gain.connect(this.master ?? context.destination)

    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    source.connect(gain)
    // Nodes are single-use; releasing the gain with them keeps a long session
    // from accumulating a graph of finished voices.
    source.onended = () => {
      source.disconnect()
      gain.disconnect()
      if (this.transition === source) this.transition = null
    }

    const haptic = HAPTICS[name]
    if (haptic) {
      // The same square root as the sample, and it used to be a plain divide.
      // The reasoning for that was sound and the arithmetic was fatal: N voices
      // each scaled by 1/N sum to exactly 1, so the run came out at the level of
      // a single knock no matter how many crossings went into it. A fast sweep
      // is more gesture than a slow one and it has to arrive as more. The root
      // lets the pile grow — and the limiter, not this line, is what stops it.
      this.strike(haptic, start, (haptic.level * (options.force ?? 1)) / Math.sqrt(1 + crowd))
    }

    if (name !== 'pick') {
      this.transition?.stop()
      this.transition = source
    }

    source.start(start)
  }

  /**
   * Schedules one haptic pulse: a few cycles of a sine in the actuator band,
   * shaped so it lands as a knock rather than as a tone.
   *
   * At 210Hz a period is 4.8ms, so a 22ms pulse is barely four and a half
   * cycles. That is the whole trick — what makes this read as a tap is the
   * envelope, not the frequency. Held for a second it is an audiometer test;
   * given an attack in single-digit milliseconds and let go, it is a thumb
   * against card stock.
   */
  private strike(spec: Haptic, at: number, level: number): void {
    const context = this.context
    // Not a defensive check for its own sake: an exponential ramp cannot target
    // zero, so a silent pulse is not a quiet pulse — it is a thrown RangeError.
    if (!context || level <= 0) return

    const gain = context.createGain()
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(level, at + spec.attack)
    // Exponential on the way down because that is how a struck thing loses its
    // energy, and the ear knows the difference — a linear fade on a decay this
    // short sounds switched off rather than finished. It approaches zero
    // without arriving, and the oscillator's own stop is what ends it.
    gain.gain.exponentialRampToValueAtTime(level * 0.001, at + spec.attack + spec.decay)
    gain.connect(this.master ?? context.destination)

    const oscillator = context.createOscillator()
    oscillator.type = 'sine'
    // A wobble of its own, and deliberately not the caller's playback rate.
    //
    // Following the rate tied the pitch to how fast the pointer was moving, and
    // that is the one thing an actuator does not do — it is a mass on a spring,
    // it rings where it rings, and a harder strike gives more of the same note
    // rather than a higher one. A rising pitch reads as lighter, which is
    // exactly backwards for a gesture with more energy in it. Force carries the
    // effort now, and this stays put.
    //
    // Small, but not decorative: two pulses this low starting half a period
    // apart cancel outright, and a fast sweep is where they crowd closest. The
    // detune is what keeps a riffle from comb-filtering its own body away.
    oscillator.frequency.value = HAPTIC_FREQUENCY * (0.97 + Math.random() * 0.06)
    // A sine leaves the origin at zero, so the onset is silent by construction
    // and needs no window to keep the first sample from popping. The envelope
    // above is there for the tail, not for the attack.
    oscillator.connect(gain)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }

    oscillator.start(at)
    oscillator.stop(at + spec.attack + spec.decay)
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
