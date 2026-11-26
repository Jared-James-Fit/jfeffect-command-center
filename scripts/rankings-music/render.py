#!/usr/bin/env python3
"""Renders "Main Event", the Crew → Rankings theme, to a seamless loop.

An original piece made for JF Effect (nothing licensed from anyone, so it's
ours outright): dark cinematic trap in C minor at 144 BPM (a half-time feel,
72), 32 bars, built from recorded orchestral samples that are in the public
domain (CC0) and drums designed here:

  - Versilian Studios' VS Chamber Orchestra 2: Community Edition
    (VSCO-2-CE), CC0 1.0: cello section (spiccato, sustain), violin section,
    F horn, tenor trombone, tuba, timpani and concert bass drum, from the npm
    packages @minicut/music-samples-1 and -2 (1.0.0), which carry the original
    LICENSE file. See docs/licenses/rankings-music.md.
  - The 808 bass, kick, clap, hi-hats, risers and sub drops are synthesized
    below (an 808 is a synthesizer by design).

Form (2 bars a chord, Cm · A♭ · Fm · G, the G major pulling home):
   1–8   the groove: cello spiccato, 808, low brass under it, an impact on one
   9–16  the horns' theme over it, trombones an octave down
  17–24  the lift: violins high, drums thin out, the 808 holds, a timpani roll
         and a riser into
  25–32  the main event: everything, the theme in octaves, a fill back into 1

It's rendered once past its end and the tail is wrapped onto its start, so
the end of bar 32 runs straight into bar 1: a loop with no seam at all.

  python3 scripts/rankings-music/render.py --samples <dir> --out <wav>

<dir> holds the two packages' `package` folders as s1/ and s2/ (build.sh
downloads them). Needs numpy, scipy and soundfile.
"""
from __future__ import annotations

import argparse
import functools
import math
import os
import re
from dataclasses import dataclass

import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
BPM = 144
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 32
# 32 bars at 144 BPM is a whole number of samples at both 44.1 and 48 kHz
LOOP = int(round(BARS * BAR * SR))
TAIL = 7.0
N = LOOP + int(TAIL * SR)
SIXTEENTH = BEAT / 4

rng = np.random.default_rng(144)


def mtof(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def name_midi(name: str, octave: int) -> int:
    # VSCO names a note an octave below concert pitch (its cello "C1" is 65.4 Hz, C2)
    return NOTE[name] + 12 * (octave + 2)


# ── samples ─────────────────────────────────────────────────────────────────


@dataclass
class Sample:
    path: str
    midi: int
    vel: int
    rr: int


def scan(root: str, sub: str, pattern: str) -> list[Sample]:
    out: list[Sample] = []
    for pkg in ("s1", "s2"):
        d = os.path.join(root, pkg, "package", sub)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            m = re.match(pattern, f)
            if not m:
                continue
            g = m.groupdict()
            out.append(Sample(os.path.join(d, f), name_midi(g["n"], int(g["o"])), int(g.get("v") or 1), int(g.get("rr") or 1)))
    if not out:
        raise SystemExit(f"no samples in {sub}")
    return out


@functools.lru_cache(maxsize=None)
def load(path: str) -> np.ndarray:
    x, sr = sf.read(path, always_2d=True, dtype="float32")
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    x = x[:, :2]
    assert sr == 44100, (path, sr)
    # start on the note: a few ms before it crosses -40 dB of its peak
    env = np.abs(x).max(axis=1)
    peak = env.max() or 1.0
    i = int(np.argmax(env > peak * 0.01))
    i = max(0, i - int(0.004 * sr))
    return x[i:]


@functools.lru_cache(maxsize=None)
def pitched(path: str, semis: float, seconds: float) -> np.ndarray:
    """The sample at 48 kHz, `semis` higher, `seconds` long (high-quality FFT resampling)."""
    src = load(path)
    step = 2 ** (semis / 12) * 44100 / SR  # source samples per output sample
    want = int(seconds * SR)
    take = min(len(src), int(math.ceil(want * step)) + 64)
    seg = src[:take]
    # taper the very end so the FFT resampler doesn't wrap the cut back onto the start
    t = min(256, len(seg) // 4)
    seg = seg.copy()
    seg[-t:] *= np.linspace(1, 0, t)[:, None]
    out = signal.resample(seg, int(len(seg) / step), axis=0).astype(np.float32)
    return out[:want]


def pick(samples: list[Sample], midi: int, vel: int, rr: int | None = None) -> Sample:
    best = min(abs(s.midi - midi) for s in samples)
    near = [s for s in samples if abs(s.midi - midi) == best]
    near.sort(key=lambda s: (abs(s.vel - vel), s.midi))
    v = near[0].vel
    same = [s for s in near if s.vel == v]
    if rr is not None and len(same) > 1:
        return same[rr % len(same)]
    return same[0]


# ── the mix ─────────────────────────────────────────────────────────────────

BUSES = ["kick", "b808", "clap", "hats", "spic", "pad", "brass", "theme", "violins", "perc", "fx"]
bus = {b: np.zeros((N, 2), dtype=np.float32) for b in BUSES}


def place(name: str, at: float, x: np.ndarray, gain: float = 1.0, pan: float = 0.0):
    """Mix x (stereo or mono) into a bus at `at` seconds; pan -1..1 (equal power)."""
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    i = int(round(at * SR))
    if i >= N:
        return
    if i < 0:
        x = x[-i:]
        i = 0
    n = min(len(x), N - i)
    a = (pan + 1) * math.pi / 4
    g = np.array([math.cos(a), math.sin(a)], dtype=np.float32) * math.sqrt(2) * gain
    bus[name][i : i + n] += x[:n] * g


def fade(x: np.ndarray, attack: float, release: float) -> np.ndarray:
    x = x.copy()
    a = min(len(x), int(attack * SR))
    r = min(len(x), int(release * SR))
    if a:
        x[:a] *= np.linspace(0, 1, a)[:, None] if x.ndim == 2 else np.linspace(0, 1, a)
    if r:
        curve = np.cos(np.linspace(0, math.pi / 2, r)) ** 2
        x[-r:] *= curve[:, None] if x.ndim == 2 else curve
    return x


def sampled(samples, midi, vel, dur, release, rr=None, attack=0.004):
    s = pick(samples, midi, vel, rr)
    return fade(pitched(s.path, midi - s.midi, dur + release), attack, release)


def butter(x, kind, freq, order=2):
    sos = signal.butter(order, freq, btype=kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0).astype(np.float32)


def noise(seconds: float) -> np.ndarray:
    return rng.standard_normal(int(seconds * SR)).astype(np.float32)


def t_of(bar: int, beat: float = 0.0) -> float:
    """Bar (1-based) and beat (0-based, in quarter notes) to seconds."""
    return (bar - 1) * BAR + beat * BEAT


# ── drums (designed here) ──────────────────────────────────────────────────


def kick() -> np.ndarray:
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 46 + 120 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2)
    click = butter(noise(0.5), "highpass", 2500) * np.exp(-t / 0.004) * 0.35
    y = np.tanh(2.2 * (body + click)) / np.tanh(2.2)
    return fade(y, 0.0005, 0.05)


def clap(tail: float = 0.13) -> np.ndarray:
    n = int(0.7 * SR)
    t = np.arange(n) / SR
    env = np.zeros(n, dtype=np.float32)
    for k, d in enumerate((0.0, 0.009, 0.019, 0.031)):
        tt = np.clip(t - d, 0, None)
        env += np.where(t >= d, np.exp(-tt / (0.007 if k < 3 else tail)), 0) * (0.8 if k < 3 else 1.0)
    nz = butter(butter(noise(0.7), "bandpass", [750, 3200]), "highpass", 450)
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.045) * 0.5
    y = nz * env + body
    y = np.tanh(1.6 * y / (np.abs(y).max() + 1e-9))
    return fade(y.astype(np.float32), 0.0005, 0.08)


METAL = (205.3, 304.4, 369.6, 522.7, 540.0, 800.0)


@functools.lru_cache(maxsize=None)
def hat(decay: float) -> np.ndarray:
    n = int((decay * 6 + 0.02) * SR)
    t = np.arange(n) / SR
    y = sum(signal.square(2 * np.pi * f * 1.02 * t) for f in METAL).astype(np.float32)
    y = butter(butter(y, "bandpass", [7000, 13500], 3), "highpass", 6500)
    y += butter(noise(n / SR), "highpass", 9000) * 0.25
    y *= np.exp(-t / decay)
    y /= np.abs(y).max() + 1e-9
    return fade(y.astype(np.float32), 0.0003, 0.01)


def b808(midi: float, dur: float, glide: tuple[float, float] | None = None) -> np.ndarray:
    """An 808: a sine with a fast pitch punch, a long fade, saturated so a phone speaker hears its harmonics."""
    rel = 0.06
    n = int((dur + rel) * SR)
    t = np.arange(n) / SR
    f = np.full(n, mtof(midi))
    f *= 1 + 0.9 * np.exp(-t / 0.01)
    if glide:
        at, semis = glide
        f *= 2 ** (semis * np.clip((t - at) / 0.07, 0, 1) / 12)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR)
    # mostly even harmonics (octaves, consonant) so the 808 reads on a phone
    # without the odd 5th harmonic sounding a major third against the minor key
    y = np.tanh(2.2 * (y + 0.18)) - math.tanh(2.2 * 0.18)
    y = y / np.tanh(2.2 * 1.18) + 0.1 * y * y
    amp = np.exp(-t / 2.2)
    y = butter(y * amp, "lowpass", 2600)
    return fade(y.astype(np.float32), 0.002, rel)


def sub_drop(seconds: float = 1.6) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    f = 30 + 52 * np.exp(-t / 0.35)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.55)
    return fade(np.tanh(1.5 * y).astype(np.float32), 0.003, 0.2)


def riser(seconds: float) -> np.ndarray:
    """Noise through a band-pass that climbs (a state-variable filter), swelling into the downbeat."""
    x = noise(seconds)
    n = len(x)
    out = np.zeros(n, dtype=np.float32)
    lo, bp = 0.0, 0.0
    q = 1 / 4.0
    for i in range(n):
        p = i / n
        fc = 250 * (7000 / 250) ** (p**1.6)
        g = 2 * math.sin(math.pi * fc / SR)
        hp = x[i] - lo - q * bp
        bp += g * hp
        lo += g * bp
        out[i] = bp
    out *= (np.linspace(0, 1, n) ** 2.2)
    out /= np.abs(out).max() + 1e-9
    return np.stack([out, np.roll(out, 113)], axis=1)


def reverse_swell(seconds: float) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    y = butter(noise(seconds), "highpass", 3500) * np.exp(-(seconds - t) / 0.45)
    y /= np.abs(y).max() + 1e-9
    return np.stack([y, np.roll(y, 211)], axis=1)


# ── space ───────────────────────────────────────────────────────────────────


def hall_ir(seconds: float, rt60: float, low_cut: float, high_cut: float, predelay: float) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    decay = np.exp(-6.9 * t / rt60)
    chans = []
    for _ in range(2):
        x = rng.standard_normal(n).astype(np.float32) * decay
        # darker as it decays: blend a low-passed copy in over time
        dark = butter(x, "lowpass", high_cut * 0.35)
        mix = np.clip(t / rt60, 0, 1)
        x = x * (1 - mix) + dark * mix
        x = butter(butter(x, "highpass", low_cut), "lowpass", high_cut)
        chans.append(x)
    ir = np.stack(chans, axis=1)
    ir = np.concatenate([np.zeros((int(predelay * SR), 2), np.float32), ir])
    return ir / np.sqrt((ir**2).sum(axis=0).mean())


def convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    return np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], axis=1).astype(np.float32)


# ── the piece ───────────────────────────────────────────────────────────────

# Cm · A♭ · Fm · G, 2 bars each (the progression repeats every 8 bars)
CHORDS = [
    {"root": 48, "triad": (48, 51, 55)},  # C minor
    {"root": 44, "triad": (44, 48, 51)},  # A♭ major
    {"root": 41, "triad": (41, 44, 48)},  # F minor
    {"root": 43, "triad": (43, 47, 50)},  # G major (B natural pulls home)
]


# the bass register (808 and tuba): C2, A♭1, F1, G1
BASS = {48: 36, 44: 32, 41: 29, 43: 31}


def chord_at(bar: int) -> dict:
    return CHORDS[((bar - 1) % 8) // 2]


# The horns' theme over one 8-bar phrase: (bar in phrase 1–8, beat, midi, beats)
THEME = [
    (1, 0, 60, 2), (1, 2, 63, 1), (1, 3, 62, 1), (2, 0, 60, 3), (2, 3, 55, 1),
    (3, 0, 56, 2), (3, 2, 60, 1), (3, 3, 63, 1), (4, 0, 63, 3), (4, 3, 60, 1),
    (5, 0, 65, 2), (5, 2, 63, 1), (5, 3, 60, 1), (6, 0, 56, 3), (6, 3, 60, 1),
    (7, 0, 59, 2), (7, 2, 62, 1), (7, 3, 65, 1), (8, 0, 67, 4),
]
# the violins' line in the lift and the main event: two voices, a chord each
VIOLINS = [(75, 72), (75, 72), (77, 72), (74, 71)]


def section(bar: int) -> str:
    return "A" if bar <= 8 else "B" if bar <= 16 else "C" if bar <= 24 else "D"


def render(samples_root: str) -> np.ndarray:
    V = "VSCO-2-CE"
    spic = scan(samples_root, f"{V}/Strings/Cello Section/spic", r"spic_(?P<n>[A-G]#?)(?P<o>\d)_v(?P<v>\d)_RR(?P<rr>\d)\.wav")
    cello = scan(samples_root, f"{V}/Strings/Cello Section/susvib", r"susvib_(?P<n>[A-G]#?)(?P<o>\d)_v(?P<v>\d)_(?P<rr>\d)\.wav")
    violin = scan(samples_root, f"{V}/Strings/Violin Section/susVib", r"VlnEns_susVib_(?P<n>[A-G]#?)(?P<o>\d)_v(?P<v>\d)\.wav")
    horn = scan(samples_root, f"{V}/Brass/F Horn/sus", r"MOHorn_sus_(?P<n>[A-G]#?)(?P<o>\d)_v(?P<v>\d)_(?P<rr>\d)\.wav")
    tbn = scan(samples_root, f"{V}/Brass/Tenor Trombone/sus", r"tenortbn_sus_(?P<n>[A-G]#?)(?P<o>\d)_v(?P<v>\d)_(?P<rr>\d)\.wav")
    tuba = scan(samples_root, f"{V}/Brass/Tuba/sus", r"Tuba3_sus_(?P<n>[A-G]#?)(?P<o>\d)_v(?P<v>\d)_rr(?P<rr>\d)_Mid\.wav")
    timp_dir = os.path.join(samples_root, "s2", "package", V, "Percussion", "Timpani")
    timp = load(os.path.join(timp_dir, "Timpani1_Hit_v3_rr1_Sum.wav"))
    timp2 = load(os.path.join(timp_dir, "Timpani1_Hit_v3_rr2_Sum.wav"))
    bd_dir = os.path.join(samples_root, "s2", "package", V, "VSCO 1 Percussion", "drums", "bass")
    bdrum = load(os.path.join(bd_dir, "bdrum_fff_1.wav"))
    bdrum_soft = load(os.path.join(bd_dir, "bdrum_ff_1.wav"))

    # The timpani's lowest drum rings near 89.6 Hz: tuned up to G2 (98 Hz), the fifth of C minor
    def resamp(x, semis):
        step = 2 ** (semis / 12) * 44100 / SR
        return signal.resample(x, int(len(x) / step), axis=0).astype(np.float32)

    timp_g = fade(resamp(timp[: int(4 * 44100)], 1.54), 0.001, 1.2)
    timp_g2 = fade(resamp(timp2[: int(4 * 44100)], 1.54), 0.001, 1.2)
    timp_c = fade(resamp(timp[: int(4 * 44100)], 1.54 - 7), 0.001, 1.2)  # C2 under the impacts
    # the concert bass drum's modes ring at 35.5 / 132.7 / 202 Hz (C♯, C, G♯): a semitone down
    # puts them on C1 and G, inside C minor
    boom = fade(resamp(bdrum[: int(5 * 44100)], -1), 0.001, 1.5)
    boom_soft = fade(resamp(bdrum_soft[: int(4 * 44100)], -1), 0.001, 1.0)

    K, CL, CL_BIG = kick(), clap(), clap(0.2)
    SUB = sub_drop()

    def impact(at: float, big: bool = True):
        place("perc", at, boom if big else boom_soft, 0.9 if big else 0.6)
        place("perc", at, timp_c, 0.55 if big else 0.4)
        place("b808", at, SUB, 0.55 if big else 0.35)

    for bar in range(1, BARS + 1):
        sec = section(bar)
        ch = chord_at(bar)
        root = ch["root"]
        t0 = t_of(bar)
        in_phrase = (bar - 1) % 8 + 1
        first_of_chord = in_phrase % 2 == 1
        last_of_phrase = in_phrase == 8

        # ── drums ──
        thin = sec == "C" and bar <= 22  # the lift drops to the kick on one and the clap
        if thin:
            kicks = [0] if first_of_chord else []
        elif sec == "A":
            kicks = [0, 10] if first_of_chord else [0, 7, 10]
        else:
            kicks = [0, 10, 13] if first_of_chord else [0, 3, 7, 10]
        for k in kicks:
            v = 1.0 if k == 0 else 0.82
            place("kick", t0 + k * SIXTEENTH, K, v * (0.95 + 0.05 * rng.random()))
        # clap on three (the half-time backbeat); a bigger one in the main event
        if not (sec == "C" and bar in (17, 18)):
            place("clap", t0 + 8 * SIXTEENTH, CL_BIG if sec == "D" else CL, 1.0)
        # a ghost clap before the turnaround
        if last_of_phrase and sec != "C":
            place("clap", t0 + 15 * SIXTEENTH, CL, 0.35)

        # hats: 8ths, with 16ths, triplet and 32nd rolls at the end of each 2-bar group
        if not thin or bar >= 21:
            steps: list[tuple[float, float]] = []
            for s in range(0, 16, 2):
                steps.append((s * SIXTEENTH, 0.9 if s % 4 == 0 else 0.6))
            if sec in ("B", "D") or bar >= 21:
                for s in range(1, 16, 2):
                    if s not in (13, 15):
                        steps.append((s * SIXTEENTH, 0.32))
            if not first_of_chord:
                # beat 4: a roll (16th triplets, or 32nds on the phrase's last bar)
                steps = [x for x in steps if x[0] < 12 * SIXTEENTH]
                div = 8 if last_of_phrase else 6
                for j in range(div):
                    steps.append((3 * BEAT + j * BEAT / div, 0.35 + 0.45 * j / div))
            for at, v in steps:
                pan = 0.18 + 0.1 * math.sin(at * 7.3)
                place("hats", t0 + at, hat(0.022 if v < 0.5 else 0.03), v * (0.9 + 0.2 * rng.random()), pan)
            if sec == "D" and in_phrase in (2, 6):
                place("hats", t0 + 3.5 * BEAT, hat(0.16), 0.45, 0.25)

        # ── 808: the root on the kicks, held; a glide up the octave going into the next chord ──
        b_root = BASS[root]  # C2, A♭1, F1, G1
        if first_of_chord:
            if thin:
                place("b808", t0, b808(b_root, BAR * 2 - 0.05), 0.95)
            else:
                place("b808", t0, b808(b_root, 10 * SIXTEENTH - 0.03), 1.0)
                place("b808", t0 + 10 * SIXTEENTH, b808(b_root, 6 * SIXTEENTH + BAR - 0.03), 0.95)
        elif not thin:
            nb = BASS[chord_at(bar + 1 if bar < BARS else 1)["root"]]
            ks = kicks
            for i, k in enumerate(ks):
                end = ks[i + 1] if i + 1 < len(ks) else 16
                dur = (end - k) * SIXTEENTH - 0.02
                glide = None
                note = b_root
                if i == len(ks) - 1:
                    # slide toward the next root (or up an octave and back when it's the same)
                    glide = (dur - 0.16, (nb - b_root) if nb != b_root else 12)
                if i == 1 and sec == "D":
                    note = b_root + 12
                place("b808", t0 + k * SIXTEENTH, b808(note, dur, glide), 0.9)

        # ── cello spiccato: the engine, 8ths in A, 16ths from the lift on ──
        triad = ch["triad"]
        low = triad[0] - 12 if triad[0] >= 46 else triad[0]
        third = triad[1] - triad[0]
        pattern8 = [low, low, low + 12, low, low + 7, low, low + third + 12, low + 7]
        if sec == "A" or (sec == "B"):
            for j, m in enumerate(pattern8):
                accent = 1.0 if j in (0, 3, 6) else 0.7
                x = sampled(spic, m, 2 if accent > 0.9 else 1, 0.32, 0.05, rr=j)
                place("spic", t0 + j * 2 * SIXTEENTH, x, accent * (0.92 + 0.12 * rng.random()), -0.15)
        else:
            for j in range(16):
                m = pattern8[j // 2] if j % 2 == 0 else low
                accent = 1.0 if j % 4 == 0 else 0.62
                x = sampled(spic, m, 2 if accent > 0.9 else 1, 0.18, 0.04, rr=j)
                place("spic", t0 + j * SIXTEENTH, x, accent * (0.9 + 0.15 * rng.random()), -0.15)

        # ── low strings and brass under it all: the chord's root and fifth, swelling ──
        if first_of_chord:
            dur = 2 * BAR
            cr = root - 12 if root - 12 >= 36 else root  # the cellos' lowest note is C2
            place("pad", t0, sampled(cello, cr, 1, dur, 0.6, attack=0.25), 0.6, -0.3)
            place("pad", t0, sampled(cello, root - 5, 1, dur, 0.6, attack=0.4), 0.45, 0.3)
            place("pad", t0, sampled(cello, triad[1] - 12 if triad[1] - 12 >= 48 else triad[1], 1, dur, 0.6, attack=0.5), 0.38, 0.1)
            if sec != "A" or bar >= 5:
                bass = BASS[root]
                place("brass", t0, sampled(tuba, bass, 2, dur, 0.5, attack=0.12), 0.7)
                place("brass", t0, sampled(tbn, bass + 12, 2, dur * 0.55, 0.45, attack=0.06), 0.55, -0.2)
                place("brass", t0, sampled(tbn, bass + 19, 2, dur * 0.55, 0.45, attack=0.06), 0.45, 0.2)
                # the horns hold the third, soft, from the theme's first bar on
                if sec != "A":
                    place("brass", t0, sampled(horn, triad[1] + 12 if triad[1] < 55 else triad[1], 1, dur, 0.6, attack=0.4), 0.3, 0.3)

        # ── the horns' theme (B and D), trombones an octave down; in D the horns double up an octave ──
        if sec in ("B", "D"):
            for (pb, beat, m, beats) in THEME:
                if pb != in_phrase:
                    continue
                at = t0 + beat * BEAT
                dur = beats * BEAT - 0.04
                vel = 2
                g = 1.25 if sec == "D" else 1.0
                place("theme", at, sampled(horn, m, vel, dur, 0.35, attack=0.02), 0.85 * g, -0.1)
                place("theme", at, sampled(tbn, m - 12, vel, dur, 0.3, attack=0.02), 0.6 * g, 0.15)
                if sec == "D":
                    place("theme", at, sampled(horn, m + 12, 2, dur, 0.35, attack=0.02), 0.18, 0.05)

        # ── violins, high and sustained: the lift and the main event ──
        if sec in ("C", "D") and first_of_chord:
            a, b = VIOLINS[((bar - 1) % 8) // 2]
            vel = 1 if sec == "C" else 2
            g = 1.0 if sec == "C" else 0.45
            place("violins", t0, sampled(violin, a, vel, 2 * BAR, 0.7, attack=0.35), 0.6 * g, 0.25)
            place("violins", t0, sampled(violin, b, vel, 2 * BAR, 0.7, attack=0.35), 0.5 * g, -0.25)

        # ── percussion: timpani on the off-beats of the main event, a roll into it ──
        if sec == "D":
            for k in (6, 14):
                place("perc", t0 + k * SIXTEENTH, timp_g if k == 6 else timp_g2, 0.38, 0.2)
        if bar in (23, 24):
            hits = 8 if bar == 23 else 16
            for j in range(hits):
                frac = ((bar - 23) * hits + j) / 24
                place("perc", t0 + j * (BAR / hits), timp_g if j % 2 == 0 else timp_g2, 0.12 + 0.35 * frac, 0.25 if j % 2 else -0.25)

    # ── impacts and transitions ──
    impact(t_of(1), big=True)
    impact(t_of(9), big=False)
    impact(t_of(17), big=False)
    impact(t_of(25), big=True)
    place("fx", t_of(23), riser(2 * BAR), 0.5)
    place("fx", t_of(24, 2), reverse_swell(2 * BEAT), 0.5)
    place("fx", t_of(32, 2), reverse_swell(2 * BEAT), 0.4)  # into bar 1, round the loop
    place("fx", t_of(8, 3), reverse_swell(BEAT), 0.25)
    place("fx", t_of(16, 3), reverse_swell(BEAT), 0.3)

    return mixdown()


def loudness_gain(x: np.ndarray, target_rms_db: float) -> float:
    rms = math.sqrt(float((x.astype(np.float64) ** 2).mean()) + 1e-12)
    return 10 ** (target_rms_db / 20) / rms


def sidechain(kick_bus: np.ndarray, depth_db: float, release: float) -> np.ndarray:
    env = np.abs(kick_bus).max(axis=1)
    # follower: instant attack, exponential release
    k = math.exp(-1 / (release * SR))
    out = signal.lfilter([1 - k], [1, -k], env)
    out = np.maximum(out, env)
    out /= out.max() + 1e-9
    return (10 ** (-depth_db * out / 20)).astype(np.float32)[:, None]


def limiter(x: np.ndarray, ceiling_db: float = -1.0, look: float = 0.005, release: float = 0.12) -> np.ndarray:
    ceiling = 10 ** (ceiling_db / 20)
    peak = np.abs(x).max(axis=1)
    need = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    w = int(look * SR)
    # the lowest gain needed anywhere in the look-ahead window
    from scipy.ndimage import minimum_filter1d

    g = minimum_filter1d(need, size=2 * w + 1, mode="nearest")
    k = math.exp(-1 / (release * SR))
    # smooth: falls instantly (already looked ahead), recovers with `release`
    sm = np.empty_like(g)
    acc = 1.0
    for i in range(len(g)):  # noqa: PERF203 (a few seconds; clear beats clever here)
        acc = g[i] if g[i] < acc else g[i] + (acc - g[i]) * k
        sm[i] = acc
    y = x * sm[:, None]
    return np.clip(y, -ceiling, ceiling)


def mixdown() -> np.ndarray:
    # relative levels (RMS, dB) per stem, set against each other, then a master gain
    levels = {
        "kick": -19.0, "b808": -17.5, "clap": -23.0, "hats": -29.0, "spic": -22.0, "pad": -27.5,
        "brass": -25.0, "theme": -24.5, "violins": -26.0, "perc": -24.0, "fx": -31.0,
    }
    stems = {}
    for name, x in bus.items():
        y = x
        if name in ("spic", "pad", "brass", "theme", "violins"):
            # the orchestra sits dark and out of the 808's way
            y = butter(butter(y, "highpass", 75), "lowpass", 7500)
        if name == "hats":
            y = butter(y, "highpass", 5000)
        if name in ("b808", "kick"):
            y = butter(y, "highpass", 30)
        stems[name] = y * loudness_gain(y[:LOOP], levels[name])

    if os.environ.get("RENDER_REPORT"):
        # per stem, per section: level and where its energy sits (for checking the balance)
        for name, y in stems.items():
            row = []
            for a, b in ((0, 8), (8, 16), (16, 24), (24, 32)):
                seg = y[int(a * BAR * SR) : int(b * BAR * SR)].mean(axis=1)
                rms = 10 * math.log10(float((seg.astype(np.float64) ** 2).mean()) + 1e-20)
                f, p = signal.welch(seg, SR, nperseg=8192)
                tot = p.sum() + 1e-30
                lo = p[(f >= 120) & (f < 500)].sum() / tot
                mid = p[(f >= 500) & (f < 2000)].sum() / tot
                row.append(f"{rms:6.1f}dB lm{lo:4.2f} m{mid:4.2f}")
            print(f"{name:8s} " + " | ".join(row))

    # the 808 and the sustained parts duck a little under the kick
    duck = sidechain(stems["kick"], 4.0, 0.16)
    duck_soft = sidechain(stems["kick"], 2.0, 0.2)
    stems["b808"] *= duck
    for n in ("pad", "brass", "violins", "spic"):
        stems[n] *= duck_soft

    hall = hall_ir(3.2, 2.6, 180, 7000, 0.025)
    plate = hall_ir(1.4, 1.1, 300, 9000, 0.012)
    send_hall = stems["spic"] * 0.22 + stems["pad"] * 0.35 + stems["brass"] * 0.3 + stems["theme"] * 0.38 + stems["violins"] * 0.45 + stems["perc"] * 0.3 + stems["fx"] * 0.25
    send_plate = stems["clap"] * 0.35 + stems["hats"] * 0.06
    wet = convolve(send_hall, hall) * 0.55 + convolve(send_plate, plate) * 0.45

    music = sum(stems.values()) + wet

    # glue: a gentle saturation on the drums and bass so they hit on a phone
    drums = stems["kick"] + stems["clap"] + stems["b808"]
    music = music - drums + np.tanh(1.3 * drums) / 1.3

    # wrap the tail round: the end of bar 32 runs into bar 1, no seam
    loop = music[:LOOP].copy()
    loop[: N - LOOP] += music[LOOP:]
    # master: clean below 28 Hz, a touch darker up top, then the level and a limiter
    loop = butter(loop, "highpass", 28)
    loop = butter(loop, "lowpass", 15000)
    # the filters run from silence, so the first moments of the loop come from
    # filtering the loop again with its own end in front of it (still seamless)
    pre = np.concatenate([loop[-SR:], loop])
    pre = butter(butter(pre, "highpass", 28), "lowpass", 15000)
    loop = pre[SR:]
    # about -16 LUFS integrated (measured with ffmpeg's ebur128); the app plays it well under that
    loop *= loudness_gain(loop, -17.6)
    # limiting is circular too: limit three copies and keep the middle one
    three = np.concatenate([loop, loop, loop])
    three = limiter(three, -1.5)
    return three[LOOP : 2 * LOOP].astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    y = render(a.samples)
    sf.write(a.out, y, SR, subtype="FLOAT")
    print(f"{a.out}: {len(y)} samples, {len(y) / SR:.3f} s, peak {20 * math.log10(np.abs(y).max()):.2f} dBFS")


if __name__ == "__main__":
    main()
