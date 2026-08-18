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
export const HAPTICS: Record<SoundName, Haptic | null> = {
  open: { attack: 0.003, decay: 0.075, level: 0.5 },
  close: { attack: 0.003, decay: 0.075, level: 0.5 },
  pick: { attack: 0.002, decay: 0.022, level: 0.18 },
  // Null, and not because the spec cues are silent — they are the two swells
  // below. A pulse is a knock, a swell is a thing arriving, and laying the first
  // under the second would put back exactly the impact the swell exists to
  // remove. The swell carries its own low end in `body`.
  specOpen: null,
  specClose: null,
}

/**
 * A cue with no recording behind it.
 *
 * Filtered noise moving through a band, with a sine underneath. Both share one
 * envelope that rises and falls without ever stepping, which is the whole point
 * of the shape: a sample begins at its transient, and a transient is an event
 * that already happened. A swell is an event still happening — it has no
 * instant you can point at and call the start, so there is nothing in it to
 * land hard.
 *
 * The noise is what keeps it from being a synthesiser tone. A sheet moving is
 * air displaced across a broad band, not a pitch, and the band sliding while it
 * sounds is the movement itself. The sine gives it somewhere to sit, and slides
 * too — see `bodyTo`, which is what makes the whole thing read as a material
 * rather than as a note.
 */
interface Swell {
  /**
   * Seconds. Omitted means "as long as the recording this sits under", which is
   * what the two beds want and the only honest answer for them: a bed that
   * outlasts its cue is a sound with nothing left to explain it, and pinning a
   * number here would silently desync the first time somebody swaps an mp3.
   *
   * The two spec cues have no recording and must state it. That number is not a
   * taste decision either. The focus animation runs exactly as long as the cue
   * that scores it, and it used to read that length off an mp3 — so removing the
   * mp3 would have handed the motion whatever the timeline happened to default
   * to. The dependency is now the other way round: the motion was tuned at this
   * length, so the cue adopts it and the two still agree by construction.
   */
  duration?: number
  /** Fraction of the duration spent rising. Not a transient — see the table. */
  attack: number
  /** Where the noise band sits at the start and at the end, in Hz. */
  from: number
  to: number
  /**
   * Resonance of that band. Defaults to 1.
   *
   * The one control over what KIND of noise this is. Around 1 the band is
   * narrow enough to have a colour and to read as a specific thing moving —
   * which is what the spec cues want. Below it the band opens out until the
   * sound stops having a centre at all, and noise with no centre is wind.
   */
  q?: number
  /**
   * The sine under the air, in Hz, at the start and at the end.
   *
   * It glides, and that is the single thing that makes this read as rubber
   * rather than as a tone. A note held at one pitch is an instrument; a rounded
   * pitch that BENDS while it sounds is a material under tension, because that
   * is the only way a real object produces one — a rubber band pulled tighter
   * rises, and it falls as it is let go. Nothing else in this spec does as much
   * for the character per parameter, and a fixed body is what the first version
   * had, which is exactly why it sounded synthetic.
   *
   * So the direction is the gesture, again: opening pulls a sheet out of the
   * deck and the pitch rises with the tension, closing releases it and the pitch
   * comes back down.
   */
  body?: number
  bodyTo?: number
  /** Peak level of the filtered noise, before the cue's own gain. */
  air: number
  /**
   * Peak level of the body, same. Omitted or zero drops the oscillator
   * entirely, which is what the two beds do — moving air has no pitch, and
   * giving wind one would make it a voice.
   */
  weight?: number
}

/**
 * Everything this page builds rather than plays.
 *
 * Two kinds, and the difference is whether a recording is also present.
 * `specOpen` and `specClose` have none — the swell IS the cue. `open` and
 * `close` do, and what they get here is a BED that plays underneath it: the
 * whole stack coming apart is eleven sheets displacing air, and until now the
 * only evidence of that was a sample of the card itself. Wind is the same
 * machinery with its resonance opened out (see `q`) and its body removed — at a
 * low enough `q` the band stops having a centre, and noise with no centre is
 * exactly what moving air sounds like.
 *
 * The beds are authored around 6dB under the recording they sit below, measured
 * against `open.mp3` after a 350Hz highpass — under it enough to be texture
 * rather than a second cue, present enough to survive a phone speaker.
 *
 * Nothing here needs a `duration`: a bed runs exactly as long as the recording
 * it accompanies, and takes that length from it.
 *
 * They are near mirrors, and the asymmetries are the gesture. Opening sweeps
 * the band UP — a sheet lifting out of the deck toward the reader, opening out
 * — and closing sweeps it back down, settling. The body glides with it, and
 * both start from the band this page already speaks in: 180Hz sits between the
 * Android LRA at 175 and the Taptic Engine near 230 that `HAPTIC_FREQUENCY` was
 * chosen from, so the spec cues stay in the same voice as everything else here
 * even with no sample left in them.
 *
 * The attack is 22% of the cue — about 107ms to the peak. That is the number
 * doing the real work: a sound that takes a tenth of a second to arrive cannot
 * be abrupt, whatever else is true of it. It is also why these need no shaping,
 * no filter on the way out and no fade at the front — there is nothing sharp to
 * soften.
 *
 * It began at 40%, and the band began an octave lower, and the result was a cue
 * nobody could hear. Worth writing down, because the measurement was not the one
 * expected: the first version had MORE energy than `open.mp3` and was still
 * inaudible. Two reasons, and neither is level. Almost two thirds of it sat
 * below 350Hz, which a phone speaker does not radiate at all — the same roll-off
 * the note on `HAPTICS` describes, except that there the sample carried the
 * audible half and here nothing did. And a 200ms rise spreads what is left over
 * so long that there is no event in it: the ear finds onsets, not energy, so a
 * swell can be measurably louder than a knock and still not be noticed.
 *
 * The band moved up into what a small speaker can actually reproduce and the
 * rise came in far enough to be an arrival. Measured against `open`, that puts
 * the audible energy around 13dB over — present, with nothing sharp added to
 * get there.
 *
 * Then it came back DOWN, because reaching that far up bought the presence at
 * the price of sounding shrill. The band now tops out at 1300 rather than 2600
 * and the weight roughly doubled, which measures as 4dB less above 2kHz and 7dB
 * more between 150 and 500 — the trade that turns brightness into body. The
 * floor on how low it can go is not taste, it is that same phone speaker: push
 * the band under about 350Hz and the cue stops being reproduced at all, which
 * is the mistake the paragraph above describes.
 */
export const SWELLS: Partial<Record<SoundName, Swell>> = {
  specOpen: {
    duration: 0.488, attack: 0.22, from: 400, to: 1300,
    body: 180, bodyTo: 300, air: 0.14, weight: 0.11,
  },
  specClose: {
    duration: 0.488, attack: 0.22, from: 1300, to: 400,
    body: 300, bodyTo: 180, air: 0.14, weight: 0.11,
  },
  // The deploy sweeps the band open as the fan does; the collapse runs it back.
  // A later attack than the spec cues, because the air is not displaced at the
  // moment the click happens — it builds while the sheets are actually moving,
  // which is the middle of the gesture rather than its start.
  open: { attack: 0.35, from: 250, to: 1200, air: 0.025, q: 0.6 },
  close: { attack: 0.35, from: 1200, to: 250, air: 0.025, q: 0.6 },
}

/**
 * How long a cut takes, in seconds.
 *
 * A reversal stops the outgoing cue, and half a second of swell stopped outright
 * is a step to silence from whatever level it had reached — which is a click,
 * the one artefact everything else here is shaped to avoid. Short enough to read
 * as a cut and not as a fade.
 */
const CUT = 0.025

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
   *
   * Held as something that can merely be stopped rather than as a source node,
   * because a swell is several nodes and cutting it means fading its output and
   * then stopping all of them together. What the reversal needs is the verb.
   */
  private transition: { stop: () => void } | null = null

  /** White noise, made once. See `swell`. */
  private grain: AudioBuffer | null = null

  constructor(
    /**
     * Where each cue's recording lives. Partial: `specOpen` and `specClose`
     * have no file behind them and are built in `swell` instead.
     */
    private readonly sources: Partial<Record<SoundName, string>>,
    /**
     * Authored level per cue. Public because how hard a sound lands is not a
     * thing anyone can read off a number: settling one means hearing it, and
     * editing a constant to wait for a reload puts several seconds between the
     * change and the only evidence there is. `__sound.gains.specOpen = 0.03`.
     */
    readonly gains: Record<SoundName, number>,
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

  /**
   * Length of a cue, for whatever has to run exactly as long as it.
   *
   * The recording answers first where there is one, and the order matters now
   * that `open` and `close` carry a built bed as well: the recording is the cue
   * and the bed merely accompanies it, so a bed must never be what the
   * animation takes its length from. A cue with nothing recorded behind it
   * answers from its authored length instead — see `Swell.duration`, and note
   * that the two which do that were measured to have no head silence to worry
   * about, unlike the two mp3s they replaced.
   */
  duration(name: SoundName): number | null {
    return this.buffers.get(name)?.duration ?? SWELLS[name]?.duration ?? null
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
    const swell = SWELLS[name]
    // A cue needs one or the other behind it, and never both — a recording that
    // failed to decode has no swell to fall back on and simply stays quiet.
    if (!context || (!buffer && !swell) || this.muted || context.state !== 'running') return

    const start = context.currentTime + Math.max(options.delay ?? 0, 0)
    if (start - (this.lastPlayed.get(name) ?? -Infinity) < RETRIGGER_GUARD[name]) return
    this.lastPlayed.set(name, start)

    const crowd = this.crowd(name, start)
    if (crowd >= MAX_CROWD) return

    // Voices sum, so a dense burst at full level is louder than anything else
    // on the page and clips on the way out. Square root rather than a plain
    // divide: the burst still gets to grow, it just stops growing linearly.
    const level = (this.gains[name] * (options.gain ?? 1)) / Math.sqrt(1 + crowd)

    // What a reversal has to be able to cut. A cue is a recording, or a built
    // swell, or — since the deploy got its wind — a recording with a bed under
    // it. All of it has to go together, or half the cue plays on over the one
    // replacing it, which is exactly the mud the single voice exists to avoid.
    const voices: { stop: () => void }[] = []
    const all = {
      stop: () => {
        for (const one of voices) one.stop()
      },
    }
    let live = 0
    const finished = (): void => {
      if (--live === 0 && this.transition === all) this.transition = null
    }

    if (buffer) {
      const gain = context.createGain()
      gain.gain.value = level
      gain.connect(this.master ?? context.destination)

      const source = context.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = Math.max(options.rate ?? 1, 0.01)
      source.connect(gain)
      // Nodes are single-use; releasing the gain with them keeps a long session
      // from accumulating a graph of finished voices.
      source.onended = () => {
        source.disconnect()
        gain.disconnect()
        finished()
      }
      source.start(start)
      voices.push(source)
      live++
    }

    // A bed states no length of its own and runs as long as what it sits under.
    const length = swell?.duration ?? buffer?.duration
    if (swell && length !== undefined) {
      const built = this.swell(swell, start, level, length, finished)
      if (built) {
        voices.push(built)
        live++
      }
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

    if (name !== 'pick' && voices.length > 0) {
      this.transition?.stop()
      this.transition = all
    }
  }

  /**
   * Builds one swell and starts it. See `Swell` for what it is made of.
   *
   * The envelope is exponential in both directions and never touches zero,
   * which is not the usual fussiness about `exponentialRampToValueAtTime`
   * throwing on a zero target — it is the shape itself. A linear rise has a
   * corner at the moment it starts and another at the top, and a corner is an
   * onset the ear can find. An exponential leaves silence so slowly that there
   * is no instant to hear as the beginning, which is the entire brief.
   */
  private swell(
    spec: Swell,
    at: number,
    level: number,
    length: number,
    onEnd: () => void,
  ): { stop: () => void } | null {
    const context = this.context
    if (!context || level <= 0) return null

    const peak = at + length * spec.attack
    const end = at + length
    const floor = level * 0.001

    const out = context.createGain()
    out.gain.setValueAtTime(floor, at)
    out.gain.exponentialRampToValueAtTime(level, peak)
    out.gain.exponentialRampToValueAtTime(floor, end)
    out.connect(this.master ?? context.destination)

    const grain = this.noise(context)
    const noise = context.createBufferSource()
    noise.buffer = grain

    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    // Never tight. Past about 2 the band starts to whistle, and a whistle is a
    // pitch — the one thing the noise is here to avoid being. See `Swell.q`.
    band.Q.value = spec.q ?? 1
    band.frequency.setValueAtTime(spec.from, at)
    band.frequency.exponentialRampToValueAtTime(spec.to, end)

    const air = context.createGain()
    air.gain.value = spec.air
    noise.connect(band)
    band.connect(air)
    air.connect(out)

    // No body on a bed: moving air has no pitch. See `Swell.weight`.
    let oscillator: OscillatorNode | null = null
    let weight: GainNode | null = null
    if (spec.weight && spec.body && spec.bodyTo) {
      oscillator = context.createOscillator()
      oscillator.type = 'sine'
      // Exponential, not linear, and for once not because of the zero target: a
      // glide the ear hears as even is even in RATIO, since pitch is
      // logarithmic. A linear ramp between these two would spend most of its
      // time near the top and arrive as a bend rather than as a slide.
      oscillator.frequency.setValueAtTime(spec.body, at)
      oscillator.frequency.exponentialRampToValueAtTime(spec.bodyTo, end)

      weight = context.createGain()
      weight.gain.value = spec.weight
      oscillator.connect(weight)
      weight.connect(out)
    }

    noise.onended = () => {
      noise.disconnect()
      band.disconnect()
      air.disconnect()
      oscillator?.disconnect()
      weight?.disconnect()
      out.disconnect()
      onEnd()
    }

    // A different stretch of the same noise each time. The grain is a second
    // long and the cue is half of one, so there is room to move — and two cues
    // reading identical samples is how a texture starts sounding like a file.
    noise.start(at, Math.random() * Math.max(grain.duration - length, 0))
    noise.stop(end)
    oscillator?.start(at)
    oscillator?.stop(end)

    return {
      stop: () => {
        // Not an immediate stop. The swell is somewhere in the middle of its
        // envelope and cutting the nodes would step from that level to silence,
        // which is a click — see `CUT`.
        const now = context.currentTime
        const done = now + CUT
        if (done >= end) return
        out.gain.cancelScheduledValues(now)
        out.gain.setValueAtTime(Math.max(out.gain.value, floor), now)
        out.gain.exponentialRampToValueAtTime(floor, done)
        noise.stop(done)
        oscillator?.stop(done)
      },
    }
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
   * A second of white noise, built on first use and kept.
   *
   * Built rather than fetched, which is the whole reason the spec cues cost no
   * bytes now: noise is the one sound that carries no information, so there is
   * nothing in a recording of it that this loop does not also produce. Made once
   * because a second of float samples is a few hundred kilobytes and every cue
   * only ever reads a window of it.
   */
  private noise(context: AudioContext): AudioBuffer {
    if (this.grain) return this.grain
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
    this.grain = buffer
    return buffer
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
        const url = this.sources[name]
        if (!url) return
        try {
          const response = await fetch(url)
          this.buffers.set(name, await context.decodeAudioData(await response.arrayBuffer()))
        } catch {
          // A missing or undecodable cue costs its sound and nothing else. The
          // page is not about the audio.
        }
      }),
    )
  }
}
