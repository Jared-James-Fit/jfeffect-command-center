"""The 390 and 585 px widths of each public-page app screenshot (src/assets/{landing,coaching}/app-*.webp),
made from the 780 px original, for PhoneShot's srcset (src/components/sales/phone-shot-sources.ts).
Run after re-capturing screenshots: python3 scripts/landing/resize-shots.py"""
import glob
from PIL import Image

for f in sorted(glob.glob("src/assets/landing/app-*.webp") + glob.glob("src/assets/coaching/app-*.webp")):
    if f.endswith(("-390.webp", "-585.webp")):
        continue
    im = Image.open(f).convert("RGB")
    for w in (390, 585):
        h = round(im.size[1] * w / im.size[0])
        im.resize((w, h), Image.LANCZOS).save(f"{f[:-5]}-{w}.webp", "WEBP", quality=80, method=6)
