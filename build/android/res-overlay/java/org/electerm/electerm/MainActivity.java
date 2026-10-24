package org.electerm.electerm;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * electerm custom MainActivity.
 *
 * Layout: the Activity runs edge-to-edge
 * (WindowCompat.setDecorFitsSystemWindows(window, false)) and the root content
 * view is padded by the system-bar insets, so the WebView stays inside the safe
 * area. The decor background under the WebView is not reachable from CSS, hence
 * the explicit padding instead of letting the page bleed under the bars.
 *
 * Edge-to-edge is not optional here: with the previous
 * setDecorFitsSystemWindows(true) the framework inset the window and Capacitor's
 * own OnApplyWindowInsetsListener consumed the insets without applying them,
 * leaving the tab bar under the status bar on Android 15+. Padding explicitly is
 * the fix, and it is also what lets {@link ElectermWindowChrome} paint the two
 * system-bar strips — on targetSdk 35+ android:statusBarColor and
 * android:navigationBarColor are ignored by the framework.
 *
 * It also installs two WebView -> native bridges. The UI page is served by the
 * on-device Node backend (http://127.0.0.1:5577), outside Capacitor's own
 * origin, so Capacitor never injects its plugin runtime there and every plugin
 * silently falls back to its web implementation (a no-op in a WebView). Anything
 * that must reach native is a plain @JavascriptInterface object attached here:
 *
 *   window.ElectermNative  {@link ElectermSaveBridge}    - public Downloads save
 *   window.ElectermChrome  {@link ElectermWindowChrome}  - system-bar colours
 *                                                          from the UI theme
 */
public class MainActivity extends BridgeActivity {

    private ElectermWindowChrome windowChrome;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        windowChrome = new ElectermWindowChrome(this);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        installBridges();
        applySafeAreaPadding();
    }

    @Override
    protected void onPostCreate(Bundle savedInstanceState) {
        super.onPostCreate(savedInstanceState);
        applySafeAreaPadding();
    }

    @Override
    public void onResume() {
        super.onResume();
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // Re-attach: it is idempotent, and it guarantees the bridges are present
        // even if the WebView was recreated while we were backgrounded.
        installBridges();
        applySafeAreaPadding();
        if (windowChrome != null) {
            windowChrome.refresh();
        }
    }

    /**
     * Attach the native bridges to Capacitor's WebView. addJavascriptInterface
     * injects into the live JS context and every document loaded afterwards, so
     * this only needs to happen before the page needs them.
     */
    private void installBridges() {
        Bridge bridge = getBridge();
        if (bridge == null) {
            return;
        }
        WebView webView = bridge.getWebView();
        if (webView == null) {
            return;
        }
        webView.addJavascriptInterface(
            new ElectermSaveBridge(getApplicationContext(), webView),
            "ElectermNative"
        );
        if (windowChrome != null) {
            webView.addJavascriptInterface(windowChrome, "ElectermChrome");
        }
    }

    /**
     * Apply system bar insets (status bar + navigation bar) as padding to
     * the root content view (android.R.id.content) so the WebView stays
     * within the safe area — and hand the same numbers to the window chrome,
     * which paints those padding bands with the current theme colours.
     *
     * We override any OnApplyWindowInsetsListener that Capacitor's Bridge
     * may have set on the content view. The listener is set both synchronously
     * and via post() to ensure it runs after Capacitor's (possibly async)
     * bridge initialization.
     */
    private void applySafeAreaPadding() {
        View contentView = findViewById(android.R.id.content);
        if (contentView == null) return;

        setInsetListener(contentView);
        // Also post to run after all pending main-thread messages,
        // which is after Capacitor's async bridge setup.
        contentView.post(() -> setInsetListener(contentView));
    }

    private void setInsetListener(View contentView) {
        contentView.setOnApplyWindowInsetsListener((v, insets) -> {
            int top = insets.getSystemWindowInsetTop();
            int bottom = insets.getSystemWindowInsetBottom();
            if (windowChrome != null) {
                windowChrome.applyInsets(v, top, bottom);
            }
            // Consume system window insets so the WebView (child) doesn't
            // double-apply them. The keyboard is handled via
            // android:windowSoftInputMode=adjustResize in the theme, which
            // resizes the window rather than relying on insets dispatch.
            return insets.consumeSystemWindowInsets();
        });
        contentView.requestApplyInsets();
    }
}
