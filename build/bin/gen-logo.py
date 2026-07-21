#!/usr/bin/env python3
"""
Generate ALL Android launcher icons, splash assets, and related XML from
two source images:

  build/electerm-logo-square.png   (2160x2160 square logo  -> all icons)
  build/electerm.png               (766x266   wordmark    -> splash screen)

Usage:
  npm run logo

The square logo may have a solid background — it is auto-removed by
detecting the corner colour (with anti-aliased edge handling).
Already-transparent PNGs are used as-is.

After updating either source image, just run `npm run logo` to regenerate
everything in build/android/res-overlay.
"""
import os
import sys
from PIL import Image, ImageChops, ImageDraw

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOGO_SRC = os.path.join(ROOT, "build", "electerm-logo-square.png")
WORDMARK_SRC = os.path.join(ROOT, "build", "electerm.png")
RES = os.path.join(ROOT, "build", "android", "res-overlay")

# ---------------------------------------------------------------------------
# Brand colours
# ---------------------------------------------------------------------------
BG = (21, 23, 26, 255)        # #15171a — electerm dark slate
BG_HEX = "#15171a"

# ---------------------------------------------------------------------------
# Density maps (108dp canvas for adaptive, standard sizes for legacy)
# ---------------------------------------------------------------------------
FOREGROUND_DENSITIES = {
    "drawable-mdpi":    108,   # 108dp @ 1x
    "drawable-hdpi":    162,   # 108dp @ 1.5x
    "drawable-xhdpi":   216,   # 108dp @ 2x
    "drawable-xxhdpi":  324,   # 108dp @ 3x
    "drawable-xxxhdpi": 432,   # 108dp @ 4x
}

LEGACY_DENSITIES = {
    "mipmap-mdpi":     48,
    "mipmap-hdpi":     72,
    "mipmap-xhdpi":    96,
    "mipmap-xxhdpi":   144,
    "mipmap-xxxhdpi":  192,
}

# Logo size as a fraction of the icon canvas.
# Adaptive icon safe zone = 66dp / 108dp ~ 61%.
# 60% keeps the logo comfortably inside the safe zone on all launchers.
LOGO_FRACTION = 0.60

# Splash wordmark height (pixels).
SPLASH_LOGO_HEIGHT = 200

# Background-removal parameters.
# BG_TOL:        pixels within this Chebyshev distance of the corner
#                colour are fully transparent.
# BG_GRADIENT:   distance at which alpha reaches 255.  Between BG_TOL
#                and BG_GRADIENT alpha is linearly interpolated, which
#                preserves smooth anti-aliased edges.
BG_TOL = 30
BG_GRADIENT = 100

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_logo_cache = None


def ensure_dir(p):
    os.makedirs(p, exist_ok=True)


def paste_centered(canvas, img):
    """Paste *img* onto *canvas* centred, respecting alpha."""
    cw, ch = canvas.size
    iw, ih = img.size
    left = (cw - iw) // 2
    top = (ch - ih) // 2
    canvas.paste(img, (left, top), img)


def make_circular_bg(size, color):
    """Circular background with anti-aliased edges (4x supersampled)."""
    scale = 4
    big = size * scale
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.ellipse((0, 0, big - 1, big - 1), fill=color)
    return canvas.resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------------------
# Source loading
# ---------------------------------------------------------------------------
def remove_background(im):
    """
    Detect the solid background colour from the four corners and make it
    transparent, with a smooth gradient at anti-aliased edges.

    Uses PIL ImageChops (C-level operations) for speed — no per-pixel
    Python loops over the 4.7M-pixel source.
    """
    w, h = im.size

    # --- detect background colour from corners ---
    corners = [
        im.getpixel((0, 0)),
        im.getpixel((w - 1, 0)),
        im.getpixel((0, h - 1)),
        im.getpixel((w - 1, h - 1)),
    ]
    bg = tuple(sum(c[i] for c in corners) // len(corners) for i in range(3))

    # --- compute Chebyshev distance from background ---
    # ImageChops.difference gives |im - bg| per channel.
    # ImageChops.lighter gives pixel-wise max  =>  max(r, g, b) distance.
    bg_img = Image.new("RGBA", (w, h), bg + (255,))
    diff = ImageChops.difference(im, bg_img)
    r_d, g_d, b_d = diff.split()[:3]
    max_diff = ImageChops.lighter(ImageChops.lighter(r_d, g_d), b_d)

    # --- map distance -> alpha via LUT (fast C-level point op) ---
    table = []
    for d in range(256):
        if d <= BG_TOL:
            table.append(0)
        elif d < BG_GRADIENT:
            table.append(int(255 * (d - BG_TOL) / (BG_GRADIENT - BG_TOL)))
        else:
            table.append(255)
    alpha = max_diff.point(table, mode="L")

    # --- replace alpha channel ---
    r, g, b = im.split()[:3]
    im = Image.merge("RGBA", (r, g, b, alpha))

    # --- crop to content ---
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    return im


def load_square_logo():
    """
    Load build/electerm-logo-square.png.

    If the image already has transparency it is used as-is (just cropped
    to its bounding box).  Otherwise the solid background is auto-
    detected and removed.
    """
    global _logo_cache
    if _logo_cache is not None:
        return _logo_cache

    if not os.path.exists(LOGO_SRC):
        sys.exit("ERROR: square logo not found: " + LOGO_SRC)

    im = Image.open(LOGO_SRC).convert("RGBA")
    print("  Loaded square logo:", im.size, im.mode)

    # Detect whether the image already has meaningful transparency.
    extrema = im.getextrema()           # [(r_min,r_max), …, (a_min,a_max)]
    has_alpha = len(extrema) > 3 and extrema[3][0] < 255

    if has_alpha:
        print("  Image already transparent — using as-is")
        bbox = im.getbbox()
        if bbox:
            im = im.crop(bbox)
    else:
        print("  Removing solid background…")
        im = remove_background(im)

    print("  Final logo size:", im.size)
    _logo_cache = im
    return im


def get_logo(max_size=None):
    """Return a (optionally scaled) copy of the processed square logo."""
    im = load_square_logo().copy()
    if max_size:
        im.thumbnail((max_size, max_size), Image.LANCZOS)
    return im


def load_wordmark(height):
    """Load build/electerm.png and scale to *height* pixels."""
    if not os.path.exists(WORDMARK_SRC):
        sys.exit("ERROR: wordmark not found: " + WORDMARK_SRC)
    im = Image.open(WORDMARK_SRC).convert("RGBA")
    w, h = im.size
    new_w = int(round(w * height / h))
    return im.resize((new_w, height), Image.LANCZOS)


# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------

def gen_foreground():
    """
    Adaptive icon foreground (108dp canvas, logo inside the 66dp safe
    zone).  Generated at every standard density so Android never upscales.

    Also removes the old single-density foreground that used to live in
    drawable/ (432px in drawable/ was treated as mdpi = 432dp, 4x too
    large for the 108dp adaptive-icon canvas).
    """
    old_fg = os.path.join(RES, "drawable", "ic_launcher_foreground.png")
    if os.path.exists(old_fg):
        os.remove(old_fg)
        print("  Removed old single-density foreground:", old_fg)

    for folder, size in FOREGROUND_DENSITIES.items():
        out = os.path.join(RES, folder)
        ensure_dir(out)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        logo = get_logo(max_size=int(size * LOGO_FRACTION))
        paste_centered(canvas, logo)
        canvas.save(os.path.join(out, "ic_launcher_foreground.png"))


def gen_legacy():
    """
    Legacy (pre-26) launcher icons.

    Both ic_launcher.png and ic_launcher_round.png use a CIRCULAR brand
    background with transparent corners, so the icon looks round even on
    launchers that don't mask adaptive icons.
    """
    for folder, size in LEGACY_DENSITIES.items():
        out = os.path.join(RES, folder)
        ensure_dir(out)
        bg = make_circular_bg(size, BG)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(bg, (0, 0), bg)
        logo = get_logo(max_size=int(size * LOGO_FRACTION))
        paste_centered(canvas, logo)
        canvas.save(os.path.join(out, "ic_launcher.png"))
        canvas.save(os.path.join(out, "ic_launcher_round.png"))


# Adaptive icon XML — both square and round reference the same
# foreground/background; the launcher's own mask is applied on top.
ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
"""


def gen_adaptive_xml():
    out = os.path.join(RES, "mipmap-anydpi-v26")
    ensure_dir(out)
    with open(os.path.join(out, "ic_launcher.xml"), "w") as f:
        f.write(ADAPTIVE_XML)
    with open(os.path.join(out, "ic_launcher_round.xml"), "w") as f:
        f.write(ADAPTIVE_XML)


def gen_splash():
    """Splash: brand background + centred wordmark."""
    drawable = os.path.join(RES, "drawable")
    ensure_dir(drawable)
    logo = load_wordmark(height=SPLASH_LOGO_HEIGHT)
    logo.save(os.path.join(drawable, "splash_logo.png"))

    with open(os.path.join(drawable, "splash.xml"), "w") as f:
        f.write(
            """<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <color android:color="@color/electerm_bg" />
    </item>
    <item>
        <bitmap
            android:src="@drawable/splash_logo"
            android:gravity="center"
            android:tileMode="disabled" />
    </item>
</layer-list>
"""
        )


def gen_values():
    """
    Colours + styles + network security config.

    Written as SEPARATE files (colors-electerm.xml / splash-styles.xml)
    so they merge with Capacitor's generated resources instead of
    overwriting them.
    """
    v = os.path.join(RES, "values")
    ensure_dir(v)
    with open(os.path.join(v, "colors-electerm.xml"), "w") as f:
        f.write(
            """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="electerm_bg">""" + BG_HEX + """</color>
    <color name="ic_launcher_background">""" + BG_HEX + """</color>
</resources>
"""
        )
    with open(os.path.join(v, "splash-styles.xml"), "w") as f:
        f.write(
            """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme.Splash" parent="Theme.AppCompat.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:windowBackground">@drawable/splash</item>
    </style>
</resources>
"""
        )
    xml = os.path.join(RES, "xml")
    ensure_dir(xml)
    with open(os.path.join(xml, "network_security_config.xml"), "w") as f:
        f.write(
            """<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">127.0.0.1</domain>
        <domain includeSubdomains="true">localhost</domain>
    </domain-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
"""
        )


def gen_manifest():
    """
    AndroidManifest.xml overlay (full file; copied over the generated
    one).  Includes android:roundIcon so tablet launchers that look for
    a round icon get the electerm round icon.
    """
    with open(os.path.join(RES, "AndroidManifest.xml"), "w") as f:
        f.write(
            """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:usesCleartextTraffic="true"
        android:networkSecurityConfig="@xml/network_security_config"
        android:theme="@style/AppTheme.Splash">
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:launchMode="singleTask"
            android:exported="true"
            android:theme="@style/AppTheme.Splash">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
</manifest>
"""
        )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 60)
    print("  electerm Android — logo & splash asset generator")
    print("=" * 60)
    print("  Square logo source:", LOGO_SRC)
    print("  Wordmark source:   ", WORDMARK_SRC)
    print("  Output directory:  ", RES)
    print()

    load_square_logo()
    print()

    print("[1/6] Adaptive icon foregrounds …")
    gen_foreground()
    print("[2/6] Legacy launcher icons …")
    gen_legacy()
    print("[3/6] Adaptive icon XML …")
    gen_adaptive_xml()
    print("[4/6] Splash screen …")
    gen_splash()
    print("[5/6] Colours, styles & security config …")
    gen_values()
    print("[6/6] AndroidManifest.xml …")
    gen_manifest()

    print()
    print("Done! All assets generated in:")
    print("  " + RES)
    print()
    print("To apply them to the native project, run:")
    print("  cd build/android && npx cap sync android && npm run overlay")
