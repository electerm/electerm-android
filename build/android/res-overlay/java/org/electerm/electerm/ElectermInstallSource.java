package org.electerm.electerm;

import android.content.Context;
import android.content.pm.InstallSourceInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;
import android.webkit.JavascriptInterface;

/**
 * Install-source bridge (WebView -> "who installed this app?").
 *
 * Why this exists
 * ---------------
 * The GitHub/APK build of electerm self-checks for updates and points the user
 * at a new APK on electerm.org. The Google Play build must not: Play owns
 * updates there, and Play policy forbids steering users to a download outside
 * the store. The two builds are otherwise the *same artifact pipeline* (see
 * .github/workflows/publish-google-play.yml — it runs the same
 * `npm run build:android`), so "is this the Play build" is not something the
 * build can answer: it is a property of how the app got onto the device.
 *
 * Android knows the answer: PackageManager records the installer package, and
 * for store installs it is the store's own package name (`com.android.vending`
 * for Google Play). This bridge exposes that fact to the page.
 *
 * Bridge contract (page side: build/replace/src/client/web-components/web-pre.js)
 *   window.ElectermInstallSource.isPlayInstall()        -> boolean
 *   window.ElectermInstallSource.getInstallingPackage() -> string ('' if unknown)
 *   window.ElectermInstallSource.getVersion()           -> '1' (feature detect)
 *
 * The page sets `window.et.disableUpgradeCheck = true` when
 * {@link #isPlayInstall()} is true, which is the same switch a desktop build
 * uses to hide the whole upgrade flow (see @electerm/electerm-react's
 * upgrade.jsx / info-modal.jsx).
 *
 * Detection caveats, all resolved as "not Play" so the updater keeps working:
 *   - installed by `adb install` / a file manager / a preload: no installer;
 *   - a Play install later updated by a sideloaded APK: the *updater* replaces
 *     the recorded installer, and the user is back on the manual path.
 * The answer is queried once at boot and cached by the page, so it cannot flip
 * while the app is running.
 *
 * Note: like the other bridges, this object is reachable from every document
 * loaded in this WebView. The WebView only ever loads the packaged loading page
 * and the loopback backend (see capacitor.config.ts allowNavigation), so no
 * third-party page can reach it.
 */
public class ElectermInstallSource {

    private static final String TAG = "ElectermInstallSource";

    /** Version marker: lets the page feature-detect this bridge. */
    private static final String VERSION = "1";

    /** Google Play's package name, as reported by PackageManager. */
    private static final String PLAY_STORE_PACKAGE = "com.android.vending";

    private final Context context;

    public ElectermInstallSource(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public String getVersion() {
        return VERSION;
    }

    /** true when this package was installed (or last updated) by Google Play. */
    @JavascriptInterface
    public boolean isPlayInstall() {
        return PLAY_STORE_PACKAGE.equals(installingPackage());
    }

    /**
     * The installer package name, or '' when the platform does not know it.
     * Exposed for debugging over chrome://inspect — the boolean above is what
     * the app actually branches on.
     */
    @JavascriptInterface
    public String getInstallingPackage() {
        String installer = installingPackage();
        return installer == null ? "" : installer;
    }

    /**
     * Installer package name. `getInstallerPackageName` is deprecated but is the
     * only API below API 30; `getInstallSourceInfo` is the replacement and also
     * reports the *updating* package on modern versions.
     */
    private String installingPackage() {
        PackageManager pm = context.getPackageManager();
        String pkg = context.getPackageName();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                InstallSourceInfo info = pm.getInstallSourceInfo(pkg);
                return info == null ? null : info.getInstallingPackageName();
            }
            //noinspection deprecation
            return pm.getInstallerPackageName(pkg);
        } catch (PackageManager.NameNotFoundException | RuntimeException e) {
            Log.w(TAG, "cannot resolve the installer package: " + e);
            return null;
        }
    }
}
