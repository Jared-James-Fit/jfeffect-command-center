#!/usr/bin/env bash
# What the live site sends: the home page's HTML and the caching on each kind of file.
set -u
mkdir -p .perf/out
curl -s -A "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" -D .perf/out/home.headers -o .perf/out/home.html --compressed https://jfeffect.com/
{
  echo "== home"; cat .perf/out/home.headers
  for u in $(grep -oE '(src|href)="/[^"]+\.(js|css|webp|woff2|png)"' .perf/out/home.html | sed -E 's/^(src|href)="//; s/"$//' | sort -u | head -12); do
    echo "== $u"; curl -s -o /dev/null -D - --compressed "https://jfeffect.com$u" | grep -iE '^(HTTP|cache-control|content-type|content-length|content-encoding|cf-cache-status|age|etag)'
  done
  for u in /manifest.json /sw.js /logo.png /fonts/anton-latin-400.woff2; do
    echo "== $u"; curl -s -o /dev/null -D - --compressed "https://jfeffect.com$u" | grep -iE '^(HTTP|cache-control|content-type|content-length|content-encoding|cf-cache-status|age)'
  done
} > .perf/out/headers.txt 2>&1
wc -c .perf/out/home.html >> .perf/out/headers.txt
