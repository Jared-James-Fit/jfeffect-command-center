"""The smaller widths of each public-page app screenshot (src/assets/{landing,coaching}/app-*.webp),
made from the original, for their srcsets: 390 and 585 px for a phone screen (PhoneShot,
src/components/sales/phone-shot-sources.ts), 1280 px for a computer screen (app-*-desktop.webp).
Run after re-capturing screenshots: python3 scripts/landing/resize-shots.py"""
import glob
import re
from PIL import Image

for f in sorted(glob.glob("src/assets/landing/app-*.webp") + glob.glob("src/assets/coaching/app-*.webp")):
    if re.search(r"-(390|585|1280)\.webp$", f):
        continue
    im = Image.open(f).convert("RGB")
    widths = (1280,) if f.endswith("-desktop.webp") else (390, 585)
    for w in widths:
        h = round(im.size[1] * w / im.size[0])
        im.resize((w, h), Image.LANCZOS).save(f"{f[:-5]}-{w}.webp", "WEBP", quality=80, method=6)
