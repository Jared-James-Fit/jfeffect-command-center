#!/usr/bin/env bash
# Mobile Lighthouse (PageSpeed's default: Moto G Power on slow 4G, simulated) on the live site.
set -u
OUT=.perf/out/lh
mkdir -p "$OUT"
LABEL="${LABEL:-run}"
for page in "/" "/coaching" "/about" "/join" "/auth"; do
  name=$(echo "$page" | sed 's#^/$#home#; s#^/##; s#/#_#g')
  for i in 1 2 3; do
    lighthouse "https://jfeffect.com${page}" --quiet --only-categories=performance \
      --chrome-flags="--headless=new --no-sandbox" --output=json \
      --output-path="$OUT/${LABEL}-${name}-mobile-${i}.json" || true
  done
done
lighthouse "https://jfeffect.com/" --quiet --preset=desktop --only-categories=performance \
  --chrome-flags="--headless=new --no-sandbox" --output=json --output-path="$OUT/${LABEL}-home-desktop-1.json" || true
node .perf/summarize.mjs "$OUT" > ".perf/out/${LABEL}-summary.json"
# full report of one home run, for the network and main-thread detail
cp "$OUT/${LABEL}-home-mobile-1.json" ".perf/out/${LABEL}-home-mobile-full.json" 2>/dev/null || true
rm -f "$OUT"/*.json
