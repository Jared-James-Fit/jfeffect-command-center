#!/usr/bin/env python3
"""
The iPhone app's icon and launch image, every build (.github/workflows/ios-build.yml).

`npx cap add ios` regenerates the Xcode project from Capacitor's template on every
build, and that template ships Capacitor's own placeholder icon
(AppIcon.appiconset/AppIcon-512@2x.png) and launch image (Splash.imageset, the
Capacitor logo on white). App Review rejected build 35 under guideline 2.3.8
("the app icons appear to be placeholder icons"), so this script:

  generate  wipes both sets and writes JF Effect's own: every iPhone and iPad
            icon size plus the 1024 App Store icon (all RGB, no alpha channel,
            which App Store Connect refuses on the 1024) from AppIcon-1024.png at
            the repo root, and a launch image (the icon, rounded, centred on the
            app's dark background #0B0B0F) at the template's three scales.
  check     fails the build if any icon or launch image is missing, the wrong
            size, has an alpha channel (the 1024), looks like Capacitor's
            placeholder, or doesn't look like AppIcon-1024.png.
  check-app the same check on an icon PNG taken out of the built .app (after
            `sips` turned Xcode's optimised PNG back into a normal one).

Needs Pillow. Run from the repo root.
"""
import json
import os
import shutil
import sys
import tarfile
from io import BytesIO

from PIL import Image, ImageChops, ImageDraw, ImageStat

BACKGROUND = (0x0B, 0x0B, 0x0F)  # capacitor.config.ts SplashScreen / StatusBar
SPLASH_PX = 2732
SPLASH_LOGO_PX = 560  # about 170 pt tall on a 6.1-inch iPhone (the image is aspect-filled)

# (points, scale, idiom): every slot of a full legacy AppIcon set, iPhone + iPad + App Store.
ICON_SLOTS = [
    ("20x20", 2, "iphone"), ("20x20", 3, "iphone"),
    ("29x29", 2, "iphone"), ("29x29", 3, "iphone"),
    ("40x40", 2, "iphone"), ("40x40", 3, "iphone"),
    ("60x60", 2, "iphone"), ("60x60", 3, "iphone"),
    ("20x20", 1, "ipad"), ("20x20", 2, "ipad"),
    ("29x29", 1, "ipad"), ("29x29", 2, "ipad"),
    ("40x40", 1, "ipad"), ("40x40", 2, "ipad"),
    ("76x76", 1, "ipad"), ("76x76", 2, "ipad"),
    ("83.5x83.5", 2, "ipad"),
    ("1024x1024", 1, "ios-marketing"),
]
SPLASH_FILES = [("splash-2732x2732-2.png", "1x"), ("splash-2732x2732-1.png", "2x"), ("splash-2732x2732.png", "3x")]

# How alike two pictures are: mean absolute difference per channel at 64 x 64 (0 = identical, 255 = opposite).
LIKE_SOURCE_MAX = 12.0
UNLIKE_PLACEHOLDER_MIN = 30.0


def icon_name(points, scale, idiom):
    return f"AppIcon-{idiom}-{points.replace('.', '_')}@{scale}x.png"


def icon_px(points, scale):
    return int(round(float(points.split("x")[0]) * scale))


def diff(a, b):
    a = a.convert("RGB").resize((64, 64), Image.LANCZOS)
    b = b.convert("RGB").resize((64, 64), Image.LANCZOS)
    return sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 3


def flat_rgb(img):
    """RGB with no alpha channel: anything transparent sits on the app's background."""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        base = Image.new("RGB", rgba.size, BACKGROUND)
        base.paste(rgba, mask=rgba.split()[3])
        return base
    return img.convert("RGB")


def capacitor_placeholders(template_tgz):
    """Capacitor's own icon and launch image, read from the template `cap add ios` copies."""
    found = {}
    if not template_tgz or not os.path.exists(template_tgz):
        return found
    with tarfile.open(template_tgz, "r:gz") as t:
        for m in t.getmembers():
            if m.name.endswith("AppIcon.appiconset/AppIcon-512@2x.png"):
                found["icon"] = Image.open(BytesIO(t.extractfile(m).read())).copy()
            elif m.name.endswith("Splash.imageset/splash-2732x2732.png"):
                found["splash"] = Image.open(BytesIO(t.extractfile(m).read())).copy()
    return found


def generate(src, iconset, splashset):
    icon = flat_rgb(Image.open(src))
    if icon.size != (1024, 1024):
        sys.exit(f"::error::{src} is {icon.size[0]}x{icon.size[1]}; the App Store icon must be 1024x1024")

    # A clean set: nothing of Capacitor's template stays behind, unreferenced or not.
    for d in (iconset, splashset):
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)

    images = []
    for points, scale, idiom in ICON_SLOTS:
        name = icon_name(points, scale, idiom)
        px = icon_px(points, scale)
        out = icon if px == 1024 else icon.resize((px, px), Image.LANCZOS)
        out.save(os.path.join(iconset, name), "PNG", optimize=True)
        images.append({"filename": name, "idiom": idiom, "scale": f"{scale}x", "size": points})
    with open(os.path.join(iconset, "Contents.json"), "w") as f:
        json.dump({"images": images, "info": {"author": "xcode", "version": 1}}, f, indent=2)

    logo = icon.resize((SPLASH_LOGO_PX, SPLASH_LOGO_PX), Image.LANCZOS)
    mask = Image.new("L", logo.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SPLASH_LOGO_PX - 1, SPLASH_LOGO_PX - 1), radius=int(SPLASH_LOGO_PX * 0.2237), fill=255)
    splash = Image.new("RGB", (SPLASH_PX, SPLASH_PX), BACKGROUND)
    at = (SPLASH_PX - SPLASH_LOGO_PX) // 2
    splash.paste(logo, (at, at), mask)
    simages = []
    for name, scale in SPLASH_FILES:
        splash.save(os.path.join(splashset, name), "PNG", optimize=True)
        simages.append({"idiom": "universal", "filename": name, "scale": scale})
    with open(os.path.join(splashset, "Contents.json"), "w") as f:
        json.dump({"images": simages, "info": {"version": 1, "author": "xcode"}}, f, indent=2)
    print(f"✅ {len(images)} app icons and {len(simages)} launch images from {src}")


def check(src, iconset, splashset, template_tgz):
    problems = []
    source = flat_rgb(Image.open(src))
    ph = capacitor_placeholders(template_tgz)
    if not ph:
        problems.append(f"Capacitor's template ({template_tgz}) couldn't be read to compare against its placeholder icon")
    if "icon" in ph and diff(source, ph["icon"]) < UNLIKE_PLACEHOLDER_MIN:
        problems.append(f"{src} itself looks like Capacitor's placeholder icon")

    try:
        contents = json.load(open(os.path.join(iconset, "Contents.json")))
    except Exception as e:  # noqa: BLE001
        contents = {"images": []}
        problems.append(f"AppIcon Contents.json unreadable: {e}")
    listed = {(i.get("size"), i.get("scale"), i.get("idiom")): i.get("filename") for i in contents.get("images", [])}
    for points, scale, idiom in ICON_SLOTS:
        name = listed.get((points, f"{scale}x", idiom))
        if not name:
            problems.append(f"no {idiom} {points}@{scale}x icon in Contents.json")
            continue
        path = os.path.join(iconset, name)
        if not os.path.exists(path):
            problems.append(f"{name} is listed but missing")
            continue
        img = Image.open(path)
        px = icon_px(points, scale)
        if img.size != (px, px):
            problems.append(f"{name} is {img.size[0]}x{img.size[1]}, should be {px}x{px}")
        if idiom == "ios-marketing" and (img.mode in ("RGBA", "LA") or "transparency" in img.info):
            problems.append(f"{name} (the App Store icon) has an alpha channel")
        if "icon" in ph and diff(img, ph["icon"]) < UNLIKE_PLACEHOLDER_MIN:
            problems.append(f"{name} looks like Capacitor's placeholder icon")
        if diff(img, source) > LIKE_SOURCE_MAX:
            problems.append(f"{name} doesn't look like {src}")
    for f in os.listdir(iconset):
        if f.endswith(".png") and f not in listed.values():
            problems.append(f"{f} is in the icon set but not listed (Capacitor's leftover?)")

    for name, _ in SPLASH_FILES:
        path = os.path.join(splashset, name)
        if not os.path.exists(path):
            problems.append(f"launch image {name} missing")
            continue
        img = Image.open(path)
        if "splash" in ph and diff(img, ph["splash"]) < UNLIKE_PLACEHOLDER_MIN:
            problems.append(f"launch image {name} looks like Capacitor's placeholder")

    if problems:
        for p in problems:
            print(f"::error::{p}")
        sys.exit(1)
    print(f"✅ Icon set and launch image are JF Effect's own ({len(ICON_SLOTS)} icons, no placeholder, no alpha on the 1024)")


def check_app(src, icon_png, template_tgz):
    img = Image.open(icon_png)
    source = flat_rgb(Image.open(src))
    ph = capacitor_placeholders(template_tgz)
    problems = []
    if "icon" in ph and diff(img, ph["icon"]) < UNLIKE_PLACEHOLDER_MIN:
        problems.append(f"the built app's icon ({os.path.basename(icon_png)}) is Capacitor's placeholder")
    if diff(img, source) > LIKE_SOURCE_MAX:
        problems.append(f"the built app's icon ({os.path.basename(icon_png)}) doesn't look like {src}")
    if problems:
        for p in problems:
            print(f"::error::{p}")
        sys.exit(1)
    print(f"✅ The built app's icon is JF Effect's ({os.path.basename(icon_png)}, {img.size[0]}x{img.size[1]})")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "generate" and len(sys.argv) == 5:
        generate(*sys.argv[2:5])
    elif cmd == "check" and len(sys.argv) == 6:
        check(*sys.argv[2:6])
    elif cmd == "check-app" and len(sys.argv) == 5:
        check_app(*sys.argv[2:5])
    else:
        sys.exit(
            "usage: app_art.py generate <AppIcon-1024.png> <AppIcon.appiconset> <Splash.imageset>\n"
            "       app_art.py check <AppIcon-1024.png> <AppIcon.appiconset> <Splash.imageset> <ios-pods-template.tar.gz>\n"
            "       app_art.py check-app <AppIcon-1024.png> <icon.png from the .app> <ios-pods-template.tar.gz>"
        )
