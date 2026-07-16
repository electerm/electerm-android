#!/usr/bin/env python3
"""
Generate Android launcher icons (adaptive + legacy) and splash assets for
electerm-android from the source logos in ../temp.

Outputs everything into ../build/android/res-overlay so the CI build can copy
it over the Capacitor-generated android/ project.
"""
import os
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TEMP = os.path.join(ROOT, "temp")
RES = os.path.join(ROOT, "build", "android", "res-overlay")

LOGO = os.path.join(TEMP, "electerm-logo-2048-1.png")   # 2160x2160 RGBA, transparent
WORDMARK = os.path.join(TEMP, "electerm.png")            # 766x266 RGBA, transparent

# Brand background colour (electerm dark slate)
BG = (21, 23, 26, 255)          # #15171a
BG_HEX = "#15171a"
COLOR_XML = BG_HEX

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


# ---------------------------------------------------------------------------
# Adaptive icon foreground (108dp canvas, logo kept inside the 66dp safe zone)
# Provided once at xxxhdpi (432px); Android scales down for lower densities.
# ---------------------------------------------------------------------------
def gen_foreground():
    out = os.path.join(RES, "drawable")
    ensure_dir(out)
    canvas = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    logo = load_logo(max_size=int(432 * 0.62))
    paste_centered(canvas, logo)
    canvas.save(os.path.join(out, "ic_launcher_foreground.png"))


# ---------------------------------------------------------------------------
# Legacy (pre-26) full launcher icons: logo on brand background.
# ---------------------------------------------------------------------------
def gen_legacy():
    densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    for folder, size in densities.items():
        out = os.path.join(RES, folder)
        ensure_dir(out)
        canvas = Image.new("RGBA", (size, size), BG)
        logo = load_logo(max_size=int(size * 0.62))
        paste_centered(canvas, logo)
        canvas.save(os.path.join(out, "ic_launcher.png"))


# ---------------------------------------------------------------------------
# Adaptive icon XML + background colour.
# ---------------------------------------------------------------------------
def gen_adaptive_xml():
    out = os.path.join(RES, "mipmap-anydpi-v26")
    ensure_dir(out)
    with open(os.path.join(out, "ic_launcher.xml"), "w") as f:
        f.write(
            """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
"""
        )


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
# ---------------------------------------------------------------------------
def gen_manifest():
    with open(os.path.join(RES, "AndroidManifest.xml"), "w") as f:
        f.write(
            """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
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
