#!/usr/bin/env python3
"""Turns the rendered loop into the file the app ships.

The file is the loop with half a second of its own end in front of it and
half a second of its start after it (pre-roll, post-roll):

    [ last 0.5 s ][ the whole loop ][ first 0.5 s ]

The player loops from PRE to PRE + LOOP. An AAC or MP3 decoder may add a few
ms of priming at the front (some browsers trim it, some don't), which shifts
both loop points by the same amount; with the rolls on either side the
audio at both points is still the same moment of the loop, so the loop is
seamless whichever way a browser decodes it.

The loop is circular, so where the file starts it is free: it starts at the
loop's quietest instant (ROTATION, printed), because the two encoded copies
of that instant (the end of the loop and the pre-roll) differ by the codec's
noise, and noise scales with the music: at the quietest point the jump is
inaudible. The player maps loop time to file time with it.

  python3 scripts/rankings-music/encode.py --in <loop.wav> --out src/assets/music/main-event.m4a
"""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile

import numpy as np
import soundfile as sf

PRE = 0.5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bitrate", default="128k")
    a = ap.parse_args()
    loop, sr = sf.read(a.src, always_2d=True, dtype="float32")
    n = int(PRE * sr)
    # the quietest 20 ms window of the loop (circularly)
    w = int(0.02 * sr)
    energy = (loop.astype(np.float64) ** 2).sum(axis=1)
    run = np.convolve(np.concatenate([energy, energy[:w]]), np.ones(w), "valid")[: len(loop)]
    rot = int(np.argmin(run)) + w // 2
    loop = np.roll(loop, -rot, axis=0)
    rolled = np.concatenate([loop[-n:], loop, loop[:n]])
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        sf.write(tmp.name, rolled, sr, subtype="PCM_24")
        subprocess.run(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", tmp.name,
                "-c:a", "aac", "-b:a", a.bitrate, "-ar", str(sr), "-ac", "2",
                "-map_metadata", "-1", "-movflags", "+faststart",
                "-metadata", "title=Main Event", "-metadata", "artist=JF Effect",
                a.out,
            ],
            check=True,
        )
    print(json.dumps({"sampleRate": sr, "loopSamples": len(loop), "loopStart": PRE, "loopEnd": PRE + len(loop) / sr, "rotationSamples": rot}))


if __name__ == "__main__":
    main()
