/**
 * Theme music for Crew → Rankings, one piece per board, synthesized live with
 * Web Audio: no files (nothing to download, no licensing), and this module
 * only loads once someone turns the music on.
 *
 *  - Monthly League, "Points on the Board": a race that resets every month.
 *    124 BPM, A minor (Am · F · C · G), four on the floor with claps on the
 *    backbeat, a pumping saw bass, a 16th-note pluck arpeggio and, on the
 *    second half of each 8-bar loop, a hook that climbs. Competitive and
 *    bright, like a scoreboard ticking over.
 *  - Hall of Strength, "Iron Legacy": the all-time records. 76 BPM, D minor
 *    (Dm · B♭ · Gm · A, the A major pulling home like a film score), war
 *    drums, a driving low-string ostinato, a choir pad, low brass hits and,
 *    on the second half, a brass melody over struck iron plates. Heavy,
 *    regal, timeless.
 *
 * Both are 8-bar loops scheduled a bar at a time on the audio thread, mixed
 * for a phone speaker (nothing that only lives under 80 Hz), and quiet
 * enough to sit under the screen (startAppMusic adds the fade and a limiter).
 * They follow the sounds switch and the silent switch like every app sound.
 */
import { plateStrike, startAppMusic, type MusicLoop } from "@/lib/app-sounds";

export type RankingsTheme = "league" | "hall";

export const THEMES: Record<RankingsTheme, { title: string; mood: string; bpm: number }> = {
  league: { title: "Points on the Board", mood: "Monthly League theme", bpm: 124 },
  hall: { title: "Iron Legacy", mood: "Hall of Strength theme", bpm: 76 },
};

/** Bars in a loop. */
export const LOOP_BARS = 8;

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// ── Shared instruments ─────────────────────────────────────────────────────

const NOISE = new Float32Array(44100);
for (let i = 0; i < NOISE.length; i++) NOISE[i] = Math.random() * 2 - 1;
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(c: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(c);
  if (!b) {
    b = c.createBuffer(1, NOISE.length, c.sampleRate);
    b.copyToChannel(NOISE, 0);
    noiseCache.set(c, b);
  }
  return b;
}

function filt(c: BaseAudioContext, out: AudioNode, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(out);
  return f;
}

function gainTo(c: BaseAudioContext, out: AudioNode, value: number): GainNode {
  const g = c.createGain();
  g.gain.value = value;
  g.connect(out);
  return g;
}

/** A noise hit into a shared filter (one filter per drum, not per hit). */
function noiseHit(c: BaseAudioContext, into: AudioNode, t: number, vel: number, decay: number, attack = 0.002) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  // long swells and cymbals outlast the one-second buffer
  src.loop = true;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  src.connect(g).connect(into);
  src.start(t, decay < 0.4 ? (t * 7.3) % 0.7 : 0);
  src.stop(t + attack + decay + 0.05);
}

/** A pitched drum: a sine falling from `from` to `to` (kick, taiko, boom). */
function drum(c: BaseAudioContext, out: AudioNode, t: number, from: number, to: number, drop: number, decay: number, vel: number) {
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + drop);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + decay + 0.05);
}

/** A synth note: oscillators (type, detune in cents, level) through its own filter envelope. */
function synthNote(
  c: BaseAudioContext,
  out: AudioNode,
  t: number,
  freq: number,
  dur: number,
  vel: number,
  opts: {
    oscs: [OscillatorType, number, number][];
    attack?: number;
    release?: number;
    /** filter: start → peak (over `sweep` s) → settle */
    cutoff?: [number, number, number];
    sweep?: number;
    q?: number;
  },
) {
  const attack = opts.attack ?? 0.01;
  const release = opts.release ?? 0.12;
  const end = t + dur;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + attack);
  g.gain.setValueAtTime(vel, Math.max(t + attack, end - 0.02));
  g.gain.exponentialRampToValueAtTime(0.0001, end + release);
  let into: AudioNode = g;
  if (opts.cutoff) {
    const [from, peak, settle] = opts.cutoff;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = opts.q ?? 0.8;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(peak, t + (opts.sweep ?? 0.08));
    f.frequency.exponentialRampToValueAtTime(settle, t + Math.max((opts.sweep ?? 0.08) + 0.05, Math.min(dur, 0.6)));
    f.connect(g);
    into = f;
  }
  g.connect(out);
  for (const [type, detune, level] of opts.oscs) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.setValueAtTime(detune, t);
    const og = c.createGain();
    og.gain.value = level;
    o.connect(og).connect(into);
    o.start(t);
    o.stop(end + release + 0.05);
  }
}

/** A light feedback echo for space (a "room"): returns its input. */
function room(c: BaseAudioContext, out: AudioNode, time: number, feedback: number, wet: number, tone = 2400): AudioNode {
  const input = c.createGain();
  input.gain.value = 1;
  const d = c.createDelay(2);
  d.delayTime.value = time;
  const fb = c.createGain();
  fb.gain.value = feedback;
  const lp = filt(c, fb, "lowpass", tone);
  const w = gainTo(c, out, wet);
  input.connect(d);
  d.connect(lp);
  fb.connect(d);
  d.connect(w);
  return input;
}

/** Duck a bus on the beat (the pump of a sidechained dance mix). */
function pump(g: GainNode, t: number, beat: number, depth: number) {
  g.gain.setValueAtTime(1 - depth, t);
  g.gain.linearRampToValueAtTime(1, t + beat * 0.6);
}

// ── Monthly League: "Points on the Board" ──────────────────────────────────

const LEAGUE = {
  bpm: 124,
  // Am · F · C · G, voiced around middle C so a phone speaker carries them
  chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
  roots: [45, 41, 48, 43],
  // the hook, bars 4–7 of the loop: [bar in loop, beat, midi, beats]
  hook: [
    [4, 0, 76, 0.5], [4, 0.5, 76, 0.5], [4, 1, 79, 1], [4, 2, 76, 0.5], [4, 2.5, 74, 0.5], [4, 3, 72, 1],
    [5, 0, 72, 0.5], [5, 0.5, 69, 0.5], [5, 1, 72, 0.5], [5, 1.5, 74, 0.5], [5, 2, 76, 1.5], [5, 3.5, 74, 0.5],
    [6, 0, 72, 0.5], [6, 0.5, 76, 0.5], [6, 1, 79, 1], [6, 2, 81, 1], [6, 3, 79, 1],
    [7, 0, 79, 1], [7, 1, 74, 0.5], [7, 1.5, 76, 0.5], [7, 2, 74, 2],
  ] as [number, number, number, number][],
  // the arpeggio's 16ths, as chord tones (3 = the root an octave up)
  arp: [0, 1, 2, 1, 3, 1, 2, 1, 0, 1, 2, 3, 2, 1, 2, 1],
};

export function leagueTheme(c: BaseAudioContext, out: AudioNode, t0: number): MusicLoop {
  const beat = 60 / LEAGUE.bpm;
  const bar = beat * 4;
  // nothing a phone speaker can't play, nothing that only booms in headphones
  const mix = filt(c, gainTo(c, out, 1), "highpass", 45);
  // drums: one filter each
  const drums = gainTo(c, mix, 0.9);
  const clap = filt(c, drums, "bandpass", 1500, 0.9);
  const hat = filt(c, drums, "highpass", 8200);
  const crash = filt(c, drums, "highpass", 5200);
  // the music under the kick pumps
  const pumped = gainTo(c, mix, 1);
  const bass = gainTo(c, pumped, 0.14);
  const padBus = filt(c, gainTo(c, pumped, 0.05), "lowpass", 1500);
  const arpBus = filt(c, gainTo(c, pumped, 0.05), "lowpass", 2600);
  const leadOut = gainTo(c, mix, 0.085);
  const lead = room(c, leadOut, beat * 0.75, 0.28, 0.35, 2800);
  lead.connect(leadOut);

  let n = 0;
  const schedule = (until: number) => {
    while (t0 + n * bar < until) {
      const t = t0 + n * bar;
      const inLoop = n % LOOP_BARS;
      const chordAt = inLoop % 4;
      const second = inLoop >= 4;
      const chord = LEAGUE.chords[chordAt];
      const root = LEAGUE.roots[chordAt];
      // the first bar of a play eases in: no crash on a cold start
      if (inLoop === 0 && n > 0) noiseHit(c, crash, t, 0.16, 1.6);
      if (inLoop === 4) noiseHit(c, crash, t, 0.12, 1.3);
      for (let b = 0; b < 4; b++) {
        const tb = t + b * beat;
        drum(c, drums, tb, 160, 54, 0.1, 0.3, 0.75);
        pump(pumped as GainNode, tb, beat, 0.55);
        if (b === 1 || b === 3) noiseHit(c, clap, tb, 0.32, 0.16);
        noiseHit(c, hat, tb + beat / 2, 0.11, 0.045);
        if (second) noiseHit(c, hat, tb + beat * 0.75, 0.05, 0.03);
      }
      // the bar before the hook: a short clap roll into it
      if (inLoop === 3 || inLoop === 7) for (let s = 12; s < 16; s++) noiseHit(c, clap, t + s * (beat / 4), 0.1 + (s - 12) * 0.05, 0.08);
      if (inLoop % 2 === 1) noiseHit(c, hat, t + 3.5 * beat, 0.08, 0.22);
      // bass: 8ths, the off-beats pushed
      for (let e = 0; e < 8; e++) {
        const off = e % 2 === 1;
        synthNote(c, bass, t + e * (beat / 2), hz(root + (e === 7 && chordAt === 3 ? 2 : 0)), beat / 2 - 0.03, off ? 1 : 0.7, {
          oscs: [["sawtooth", 0, 1], ["square", 0, 0.35]],
          cutoff: [1400, 1100, 280],
          sweep: 0.02,
          release: 0.04,
        });
      }
      // pad: the chord, two detuned saws a note
      for (const m of chord) {
        synthNote(c, padBus, t, hz(m), bar - 0.05, 0.5, { oscs: [["sawtooth", -9, 0.5], ["sawtooth", 8, 0.5]], attack: 0.18, release: 0.35 });
      }
      // arpeggio: 16ths over the chord
      const tones = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24];
      for (let s = 0; s < 16; s++) {
        synthNote(c, arpBus, t + s * (beat / 4), hz(tones[LEAGUE.arp[s]]), beat / 4 - 0.02, s % 4 === 0 ? 1 : 0.7, {
          oscs: [["square", 0, 0.6], ["triangle", 0, 0.5]],
          release: 0.08,
        });
      }
      // the hook on the second half
      for (const [b, at, m, len] of LEAGUE.hook) {
        if (b !== inLoop) continue;
        synthNote(c, lead, t + at * beat, hz(m), len * beat - 0.04, 1, {
          oscs: [["sawtooth", -6, 0.5], ["square", 5, 0.35], ["sine", 1200, 0.15]],
          attack: 0.012,
          release: 0.16,
          cutoff: [900, 3400, 2200],
          sweep: 0.05,
        });
      }
      n++;
    }
  };
  return { schedule };
}

// ── Hall of Strength: "Iron Legacy" ───────────────────────────────────────

const HALL = {
  bpm: 76,
  // Dm · B♭ · Gm · A (A major: the harmonic minor's pull back to D)
  chords: [[50, 53, 57, 62], [46, 53, 58, 62], [43, 50, 55, 58], [45, 52, 57, 61]],
  // the ostinato's root and its octave
  roots: [50, 46, 43, 45],
  // the brass melody, bars 4–7: [bar in loop, beat, midi, beats]
  melody: [
    [4, 0, 69, 1.5], [4, 1.5, 74, 0.5], [4, 2, 76, 1], [4, 3, 77, 1],
    [5, 0, 77, 2], [5, 2, 76, 1], [5, 3, 74, 1],
    [6, 0, 74, 1.5], [6, 1.5, 70, 0.5], [6, 2, 67, 1], [6, 3, 74, 1],
    [7, 0, 73, 1.5], [7, 1.5, 74, 0.5], [7, 2, 76, 2],
  ] as [number, number, number, number][],
  // 16ths of the ostinato per beat: 0 = root, 1 = octave up
  ostinato: [0, 0, 1, 0],
};

export function hallTheme(c: BaseAudioContext, out: AudioNode, t0: number): MusicLoop {
  const beat = 60 / HALL.bpm;
  const bar = beat * 4;
  const mix = filt(c, gainTo(c, out, 1), "highpass", 45);
  const hall = room(c, mix, 0.29, 0.38, 0.32, 2000);
  const drums = gainTo(c, mix, 0.95);
  drums.connect(hall);
  // the drum's skin carries the hit on a phone; the swell stays dark
  const skin = filt(c, drums, "bandpass", 260, 0.8);
  const swell = filt(c, drums, "bandpass", 2600, 0.6);
  const strings = filt(c, gainTo(c, mix, 0.07), "lowpass", 1250, 1);
  const choirOut = gainTo(c, mix, 0.04);
  choirOut.connect(hall);
  const choir = filt(c, choirOut, "lowpass", 1100);
  const brassOut = gainTo(c, mix, 0.09);
  brassOut.connect(hall);
  const iron = gainTo(c, mix, 1);
  iron.connect(hall);

  let n = 0;
  const schedule = (until: number) => {
    while (t0 + n * bar < until) {
      const t = t0 + n * bar;
      const inLoop = n % LOOP_BARS;
      const at = inLoop % 4;
      const second = inLoop >= 4;
      const chord = HALL.chords[at];
      const root = HALL.roots[at];

      // war drums: a boom on one, the pattern filling in as the loop builds
      drum(c, drums, t, 110, 58, 0.25, 0.85, 0.62);
      noiseHit(c, skin, t, 0.42, 0.28);
      const hits = second ? [1.5, 2, 3, 3.5] : inLoop % 2 ? [2, 3.5] : [2];
      for (const h of hits) {
        drum(c, drums, t + h * beat, 150, 78, 0.1, 0.45, h === 2 || h === 3 ? 0.45 : 0.3);
        noiseHit(c, skin, t + h * beat, 0.28, 0.16);
      }
      // a tom run into the brass, and a cymbal swell under it
      if (inLoop === 3) {
        for (let s = 12; s < 16; s++) drum(c, drums, t + s * (beat / 4), 190 - s * 4, 95, 0.08, 0.28, 0.25 + (s - 12) * 0.08);
        noiseHit(c, swell, t + 2 * beat, 0.05, 0.15, 2 * beat);
      }
      if (inLoop === 4) noiseHit(c, swell, t, 0.06, 2.2);

      // struck iron: a heavy plate on the loop's first beat, a lighter one on every backbeat of the second half
      if (inLoop === 0) plateStrike(c, iron, t, 196, n === 0 ? 0.03 : 0.055, 2.2);
      if (second) plateStrike(c, iron, t + 2 * beat, 392, 0.03, 1.2);

      // the low-string ostinato: 16ths, root and octave
      for (let s = 0; s < 16; s++) {
        const up = HALL.ostinato[s % 4] === 1;
        synthNote(c, strings, t + s * (beat / 4), hz(root + (up ? 12 : 0)), beat / 4 - 0.035, s % 4 === 0 ? 1 : up ? 0.8 : 0.6, {
          oscs: [["sawtooth", -4, 0.6], ["sawtooth", 5, 0.4]],
          attack: 0.006,
          release: 0.07,
        });
      }

      // choir: the chord, slow to bloom
      for (const m of chord) {
        synthNote(c, choir, t, hz(m), bar - 0.1, 0.45, { oscs: [["sawtooth", -10, 0.45], ["sawtooth", 9, 0.45], ["sine", 1200, 0.2]], attack: 0.9, release: 0.9 });
      }

      // low brass: a held hit on one (root and fifth)
      for (const m of [root, root + 7]) {
        synthNote(c, brassOut, t, hz(m), beat * 1.6, second ? 0.9 : 0.7, {
          oscs: [["sawtooth", -5, 0.5], ["sawtooth", 6, 0.5]],
          attack: 0.04,
          release: 0.4,
          cutoff: [260, 1500, 520],
          sweep: 0.12,
        });
      }

      // the brass melody on the second half
      for (const [b, beatAt, m, len] of HALL.melody) {
        if (b !== inLoop) continue;
        synthNote(c, brassOut, t + beatAt * beat, hz(m), len * beat - 0.05, 0.95, {
          oscs: [["sawtooth", -7, 0.45], ["sawtooth", 6, 0.45], ["square", -1200, 0.2]],
          attack: 0.06,
          release: 0.3,
          cutoff: [500, 2300, 1400],
          sweep: 0.12,
        });
      }
      n++;
    }
  };
  return { schedule };
}

/** Master level per theme: about −23 dBFS RMS, under the app's own sounds (measured offline in Chromium). */
export const THEME_VOLUME: Record<RankingsTheme, number> = { league: 0.34, hall: 0.48 };

const BUILD: Record<RankingsTheme, (c: BaseAudioContext, out: AudioNode, t0: number) => MusicLoop> = {
  league: leagueTheme,
  hall: hallTheme,
};

/** Start a board's theme on the app's sound engine; returns stop(fadeSeconds). */
export function playRankingsTheme(theme: RankingsTheme): (fade?: number) => void {
  return startAppMusic(BUILD[theme], { volume: THEME_VOLUME[theme], fadeIn: theme === "hall" ? 1.8 : 1 });
}
