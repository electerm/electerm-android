package org.electerm.electerm;

import android.os.Bundle;
import android.view.View;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

/**
 * electerm custom MainActivity.
 *
 * Problem: On Android 15+ (API 35+, e.g. Google Pixel 9), Capacitor's
 * BridgeActivity enables edge-to-edge display by calling
 *   WindowCompat.setDecorFitsSystemWindows(getWindow(), false)
 * and setting up its own OnApplyWindowInsetsListener that consumes system
 * bar insets without applying them as padding. This causes the WebView
 * content to extend under the status bar, making the tab bar area
 * unclickable.
 *
 * Simply calling setDecorFitsSystemWindows(true) is NOT enough because
 * Capacitor's listener still consumes the insets without applying padding.
 *
 * Fix: Override the content view's OnApplyWindowInsetsListener to apply
 * system bar insets (status bar + navigation bar) as padding on the root
 * content FrameLayout. This constrains the WebView within the safe area.
 * The listener is re-applied in onPostCreate/onResume and via post() to
 * ensure it runs after Capacitor's bridge initialization.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        applySafeAreaPadding();
    }

    @Override
    protected void onPostCreate(Bundle savedInstanceState) {
        super.onPostCreate(savedInstanceState);
        applySafeAreaPadding();
    }

    @Override
    protected void onResume() {
        super.onResume();
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        applySafeAreaPadding();
    }

    /**
     * Apply system bar insets (status bar + navigation bar) as padding to
     * the root content view (android.R.id.content) so the WebView stays
     * within the safe area.
     *
     * We override any OnApplyWindowInsetsListener that Capacitor's Bridge
     * may have set on the content view, and apply the insets as padding.
     * The listener is set both synchronously and via post() to ensure it
     * runs after Capacitor's (possibly async) bridge initialization.
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
            v.setPadding(0, top, 0, bottom);
            // Consume system window insets so the WebView (child) doesn't
            // double-apply them. The keyboard is handled via
            // android:windowSoftInputMode=adjustResize in the theme, which
            // resizes the window rather than relying on insets dispatch.
            return insets.consumeSystemWindowInsets();
        });
        contentView.requestApplyInsets();
    }
}
