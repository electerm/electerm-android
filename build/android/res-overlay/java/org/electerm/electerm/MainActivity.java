package org.electerm.electerm;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

/**
 * electerm custom MainActivity.
 *
 * Problem: On Android 15+ (API 35+, e.g. Google Pixel 9), edge-to-edge display
 * is enforced. Capacitor's BridgeActivity.onCreate() calls
 *   WindowCompat.setDecorFitsSystemWindows(getWindow(), false)
 * which opts INTO edge-to-edge, causing the WebView content to extend under the
 * system status bar. This makes the tab bar area (top 36px of the app)
 * unclickable — the status bar overlays it.
 *
 * On some devices (e.g. Huawei Mate 40 running EMUI / older Android) this does
 * not happen because the manufacturer's system does not enforce edge-to-edge or
 * handles insets differently.
 *
 * Fix: Override BridgeActivity.onCreate() and call
 *   WindowCompat.setDecorFitsSystemWindows(getWindow(), true)
 * AFTER super.onCreate(). This tells the system to apply automatic padding for
 * status-bar and navigation-bar insets, so the WebView content stays within the
 * safe area and the tab bar is fully clickable on all devices.
 *
 * This is the app-level (native) fix — no CSS safe-area-inset hacks needed.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Override Capacitor's edge-to-edge default so content does not extend
        // under system bars (status bar at top, navigation bar at bottom).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    }
}
