#!/usr/bin/env python3
"""
Generate Android launcher icons (adaptive + legacy) and splash assets for
electerm-android from the source logos in ../temp.

Outputs everything into ../build/android/res-overlay so the CI build can copy
it over the Capacitor-generated android/ project.
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TEMP = os.path.join(ROOT, "temp")
RES = os.path.join(ROOT, "build", "android", "res-overlay")

LOGO = os.path.join(TEMP, "electerm-logo-2048-1.png")   # 2160x2160 RGBA, transparent
WORDMARK = os.path.join(TEMP, "electerm.png")            # 766x266 RGBA, transparent

# Brand background colour (electerm dark slate)
BG = (21, 23, 26, 255)          # #15171a
BG_HEX = "#15171a"

# Adaptive icon foreground densities (108dp canvas at each density).
# The foreground MUST be at the correct density so Android renders it at
# 108dp.  Previously a single 432px PNG sat in drawable/ (treated as mdpi =
# 432dp), which made the foreground 4x too large on the 108dp adaptive-icon
# canvas — the logo was massively cropped.
FOREGROUND_DENSITIES = {
    "drawable-mdpi": 108,    # 108dp @ 1x
    "drawable-hdpi": 162,    # 108dp @ 1.5x
    "drawable-xhdpi": 216,   # 108dp @ 2x
    "drawable-xxhdpi": 324,  # 108dp @ 3x
    "drawable-xxxhdpi": 432, # 108dp @ 4x
}

# Legacy launcher icon densities
LEGACY_DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

# Logo size as a fraction of the icon canvas.
# Adaptive icon safe zone = 66dp / 108dp ≈ 61%.
# 60% keeps the logo comfortably inside the safe zone on all launchers.
LOGO_FRACTION = 0.60

os.makedirs(RES, exist_ok=True)


def ensure_dir(p):
    os.makedirs(p, exist_ok=True)


def paste_centered(canvas, img):
    cw, ch = canvas.size
    iw, ih = img.size
    left = (cw - iw) // 2
    top = (ch - ih) // 2
    canvas.paste(img, (left, top), img)


def load_logo(max_size=None):
    im = Image.open(LOGO).convert("RGBA")
    if max_size:
        im.thumbnail((max_size, max_size), Image.LANCZOS)
    return im


def load_wordmark(height):
    im = Image.open(WORDMARK).convert("RGBA")
    w, h = im.size
    new_h = height
    new_w = int(round(w * height / h))
    return im.resize((new_w, new_h), Image.LANCZOS)


def make_circular_bg(size, color):
    """Create a circular background with anti-aliased edges (transparent
    corners outside the circle).  Supersampled at 4x then downscaled for
    smooth circle edges."""
    scale = 4
    big = size * scale
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.ellipse((0, 0, big - 1, big - 1), fill=color)
    return canvas.resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------------------
# Adaptive icon foreground (108dp canvas, logo kept inside the 66dp safe zone)
# Generated at every standard density so Android never has to upscale.
# ---------------------------------------------------------------------------
def gen_foreground():
    # Remove the old single-density foreground that used to live in drawable/.
    # (432px in drawable/ was treated as mdpi = 432dp, 4x too large for the
    # 108dp adaptive-icon canvas.)
    old_fg = os.path.join(RES, "drawable", "ic_launcher_foreground.png")
    if os.path.exists(old_fg):
        os.remove(old_fg)
        print("Removed old foreground:", old_fg)

    for folder, size in FOREGROUND_DENSITIES.items():
        out = os.path.join(RES, folder)
        ensure_dir(out)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        logo = load_logo(max_size=int(size * LOGO_FRACTION))
        paste_centered(canvas, logo)
        canvas.save(os.path.join(out, "ic_launcher_foreground.png"))


# ---------------------------------------------------------------------------
# Legacy (pre-26) launcher icons.
#
# Both ic_launcher.png and ic_launcher_round.png use a CIRCULAR brand
# background with transparent corners.  This ensures the icon looks round
# even on launchers that don't mask adaptive icons (e.g. some tablet
# launchers that display all icons as circles).  On API 26+ the adaptive
# icon XML is used instead and the launcher applies its own mask shape.
# ---------------------------------------------------------------------------
def gen_legacy():
    for folder, size in LEGACY_DENSITIES.items():
        out = os.path.join(RES, folder)
        ensure_dir(out)
        # Circular brand background with transparent corners
        bg = make_circular_bg(size, BG)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(bg, (0, 0), bg)
        # Logo on top, centred within the safe zone
        logo = load_logo(max_size=int(size * LOGO_FRACTION))
        paste_centered(canvas, logo)
        # ic_launcher.png and ic_launcher_round.png are identical — both
        # already circular so no square border is visible on any launcher.
        canvas.save(os.path.join(out, "ic_launcher.png"))
        canvas.save(os.path.join(out, "ic_launcher_round.png"))


# ---------------------------------------------------------------------------
# Adaptive icon XML + background colour.
# Both ic_launcher.xml and ic_launcher_round.xml reference the same
# foreground/background; the launcher's own mask shape is applied either way.
# ---------------------------------------------------------------------------
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
    # Round variant — referenced by android:roundIcon in the manifest.
    # Launchers that specifically request a round icon get the same adaptive
    # icon; the launcher's circular mask is applied on top.
    with open(os.path.join(out, "ic_launcher_round.xml"), "w") as f:
        f.write(ADAPTIVE_XML)


# ---------------------------------------------------------------------------
# Splash: brand background + centred wordmark.
# ---------------------------------------------------------------------------
def gen_splash():
    drawable = os.path.join(RES, "drawable")
    ensure_dir(drawable)
    # centred logo used by the splash layer-list
    logo = load_wordmark(height=200)
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


# ---------------------------------------------------------------------------
# Colours + styles + network security config.
# Written as SEPARATE files (colors-electerm.xml / splash-styles.xml) so they
# merge with Capacitor's generated resources instead of overwriting them.
# ---------------------------------------------------------------------------
def gen_values():
    v = os.path.join(RES, "values")
    ensure_dir(v)
    with open(os.path.join(v, "colors-electerm.xml"), "w") as f:
        f.write(
            f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="electerm_bg">{BG_HEX}</color>
    <color name="ic_launcher_background">{BG_HEX}</color>
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


# ---------------------------------------------------------------------------
# AndroidManifest overlay (full file; copied over the generated one).
# Includes android:roundIcon so tablet launchers that look for a round icon
# get the electerm round icon instead of falling back to the square default.
# ---------------------------------------------------------------------------
def gen_manifest():
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


if __name__ == "__main__":
    gen_foreground()
    gen_legacy()
    gen_adaptive_xml()
    gen_splash()
    gen_values()
    gen_manifest()
    print("Generated Android assets in", RES)
