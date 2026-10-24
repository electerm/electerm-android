package org.electerm.electerm;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.widget.FrameLayout;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/**
 * Window chrome — the two system strips that live OUTSIDE the web page.
 *
 * Why this exists
 * ---------------
 * The status-bar strip (top) and the navigation / gesture strip (bottom) are
 * not part of the web page, and they are no longer colour-able from the theme:
 * apps targeting SDK 35+ get edge-to-edge enforced, and
 * `android:statusBarColor` / `android:navigationBarColor` are ignored. Left
 * alone the strips keep the *system* light/dark default, so a dark electerm
 * theme on a light-mode phone shows a white status bar and a white bottom
 * strip, with near-invisible dark icons.
 *
 * So: MainActivity draws edge-to-edge ({@code setDecorFitsSystemWindows(false)})
 * and this class owns the two strips — two plain coloured views that sit in the
 * insets band of the content view (its padding), on top of the WebView.
 *
 * Two callers set the colours:
 *   - MainActivity's inset listener, which keeps the strip heights in sync with
 *     the system-bar insets (rotation, gesture-nav switch, cutouts);
 *   - the page itself, through {@link #setWindowChrome}, whenever the UI theme
 *     changes — see build/replace/src/client/web-components/window-chrome.js.
 *     That is what makes the strips follow the theme instead of a hardcoded
 *     colour.
 *
 * Bridge contract (page side: src/client/web-components/window-chrome.js):
 *   window.ElectermChrome.setWindowChrome(topArgb, bottomArgb)
 *     topArgb    '#AARRGGBB' for the status-bar strip; matches --main-dark,
 *                the tab bar / header it continues.
 *     bottomArgb '#AARRGGBB' for the navigation-bar strip; matches --main, the
 *                footer (and main surface) it continues.
 * The clock / battery / gesture-pill appearance is derived from each colour's
 * luminance, so no separate foreground argument is needed.
 *
 * Same feature as electerm-harmony's entry/src/main/ets/WindowChrome.ets.
 */
public class ElectermWindowChrome {

    private static final String TAG = "ElectermWindowChrome";

    /** Version marker: lets the page feature-detect this bridge. */
    private static final String VERSION = "1";

    /** Boot colours — electerm's dark default (#15171a, see colors-electerm.xml). */
    private static final int DEFAULT_TOP = 0xFF15171A;
    private static final int DEFAULT_BOTTOM = 0xFF15171A;

    /**
     * Last colours reported by the page. Static so a recreated activity (WebView
     * still on the old theme) keeps them instead of flashing the boot colour.
     */
    private static int topColor = DEFAULT_TOP;
    private static int bottomColor = DEFAULT_BOTTOM;

    private final Activity activity;
    private final Handler main = new Handler(Looper.getMainLooper());

    private View topStrip;
    private View bottomStrip;

    public ElectermWindowChrome(Activity activity) {
        this.activity = activity;
    }

    /** Bridge metadata. */
    @JavascriptInterface
    public String getVersion() {
        return VERSION;
    }

    /**
     * Repaint both strips with the UI theme's own colours.
     *
     * Called from the WebView's JS bridge thread, so the actual view work is
     * posted to the UI thread. Invalid / partially transparent colours are
     * ignored: a transparent strip would just show the system default again.
     */
    @JavascriptInterface
    public void setWindowChrome(final String topArgb, final String bottomArgb) {
        final Integer top = parseColor(topArgb);
        final Integer bottom = parseColor(bottomArgb);
        main.post(new Runnable() {
            @Override
            public void run() {
                if (top != null) {
                    topColor = top;
                }
                if (bottom != null) {
                    bottomColor = bottom;
                }
                applyColors();
            }
        });
    }

    /**
     * Keep the strips inside the system-bar insets bands.
     *
     * Called from MainActivity's OnApplyWindowInsetsListener, which also applies
     * the same numbers as content padding — the strips live in exactly that
     * padding, so the WebView never draws underneath them.
     */
    void applyInsets(View contentView, int topInset, int bottomInset) {
        contentView.setPadding(0, topInset, 0, bottomInset);
        if (!(contentView instanceof ViewGroup)) {
            return;
        }
        ViewGroup group = (ViewGroup) contentView;
        // The strips are positioned in the padding band, which is outside the
        // padding box — with the default clipToPadding=true the parent clips
        // them away entirely (they are laid out but never drawn).
        group.setClipToPadding(false);
        group.setClipChildren(false);
        ensureStrips(group);
        setBand(topStrip, topInset, true);
        setBand(bottomStrip, bottomInset, false);
    }

    /** Re-apply the current colours (activity recreated / resumed). */
    void refresh() {
        applyColors();
    }

    // ------------------------------------------------------------------
    // internals
    // ------------------------------------------------------------------

    private void applyColors() {
        if (topStrip != null) {
            topStrip.setBackgroundColor(topColor);
        }
        if (bottomStrip != null) {
            bottomStrip.setBackgroundColor(bottomColor);
        }

        Log.i(TAG, "applyColors top=#" + Integer.toHexString(topColor)
                + " bottom=#" + Integer.toHexString(bottomColor)
                + " strips=" + (topStrip != null));

        Window window = activity.getWindow();
        if (window == null) {
            return;
        }

        // Deliberately NOT window.setBackgroundDrawable() here: the window
        // background is the splash drawable, and replacing it would drop the
        // electerm splash. The bands are covered by the strip views instead —
        // an empty band is painted by the *system* bar background (the light
        // #fafafa strip this whole class exists to get rid of), so the strips
        // are what decide the colour.

        // The system draws a translucent contrast scrim over a "transparent"
        // navigation bar on API 29+; ours is opaque and already the right
        // colour, so the scrim would only muddy it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                window.setNavigationBarContrastEnforced(false);
            } catch (Throwable ignored) {
                // not available on this build
            }
        }

        // Clock / battery / gesture pill: dark glyphs on a light strip, light
        // glyphs on a dark one.
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(isLight(topColor));
            controller.setAppearanceLightNavigationBars(isLight(bottomColor));
        }
    }

    private void ensureStrips(ViewGroup group) {
        if (topStrip == null) {
            topStrip = new View(group.getContext());
            topStrip.setBackgroundColor(topColor);
            group.addView(topStrip, stripParams(Gravity.TOP));
        }
        if (bottomStrip == null) {
            bottomStrip = new View(group.getContext());
            bottomStrip.setBackgroundColor(bottomColor);
            group.addView(bottomStrip, stripParams(Gravity.BOTTOM));
        }
    }

    private static ViewGroup.LayoutParams stripParams(int gravity) {
        return new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, 0, gravity);
    }

    /**
     * Size and position one strip inside the content view's padding band.
     *
     * The content view is padded by the insets so the WebView stays in the safe
     * area, and FrameLayout lays children out *inside* that padding — a child
     * with gravity TOP therefore starts at paddingTop, i.e. exactly where the
     * WebView starts. The strips have to cover the padding band instead
     * (0..paddingTop and height-paddingBottom..height), so their margins are
     * negated by the inset.
     */
    private static void setBand(View view, int inset, boolean top) {
        if (view == null) {
            return;
        }
        ViewGroup.LayoutParams lp = view.getLayoutParams();
        if (lp == null) {
            return;
        }
        boolean changed = lp.height != inset;
        lp.height = inset;
        if (lp instanceof ViewGroup.MarginLayoutParams) {
            ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) lp;
            int margin = -inset;
            if (top) {
                changed |= mlp.topMargin != margin;
                mlp.topMargin = margin;
            } else {
                changed |= mlp.bottomMargin != margin;
                mlp.bottomMargin = margin;
            }
        }
        if (changed) {
            view.setLayoutParams(lp);
        }
    }

    /** '#RRGGBB' / '#AARRGGBB' -> opaque colour int, or null when unusable. */
    private static Integer parseColor(String value) {
        if (value == null) {
            return null;
        }
        String text = value.trim();
        if (text.isEmpty()) {
            return null;
        }
        try {
            int parsed = Color.parseColor(text);
            // A translucent strip would show the system default through it.
            return Color.alpha(parsed) < 255 ? (parsed | 0xFF000000) : parsed;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * True when the strip is light enough to need dark system-bar glyphs.
     * Straight sRGB luminance weighting — enough to pick between two options.
     */
    private static boolean isLight(int color) {
        double luma = (0.299 * Color.red(color)
                + 0.587 * Color.green(color)
                + 0.114 * Color.blue(color)) / 255.0;
        return luma > 0.6;
    }
}
