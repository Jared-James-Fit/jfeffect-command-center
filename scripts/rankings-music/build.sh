#!/usr/bin/env bash
# Rebuilds src/assets/music/main-event.m4a from scratch: downloads the CC0
# samples (VSCO-2-CE, via npm), renders the loop and encodes it.
#   bash scripts/rankings-music/build.sh [work dir]
# Needs python3 with numpy, scipy and soundfile, and ffmpeg.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="${1:-$(mktemp -d)}"
mkdir -p "$work/samples"
for n in 1 2; do
  if [ ! -d "$work/samples/s$n/package" ]; then
    mkdir -p "$work/samples/s$n"
    curl -sfL "https://registry.npmjs.org/@minicut/music-samples-$n/-/music-samples-$n-1.0.0.tgz" -o "$work/s$n.tgz"
    tar -xzf "$work/s$n.tgz" -C "$work/samples/s$n"
  fi
done
python3 "$here/render.py" --samples "$work/samples" --out "$work/main-event.wav"
python3 "$here/encode.py" --in "$work/main-event.wav" --out "$repo/src/assets/music/main-event.m4a"
ffmpeg -hide_banner -nostats -i "$work/main-event.wav" -af ebur128=peak=true -f null - 2>&1 | grep -A12 Summary
