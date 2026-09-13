package org.electerm.electerm;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * electerm native save bridge (WebView -> public Downloads).
 *
 * Why this exists
 * ---------------
 * The electerm UI is served by the on-device Node.js backend on
 * http://127.0.0.1:5577, which is *not* the Capacitor local-server origin.
 * Capacitor only injects its JS runtime (window.Capacitor + PluginHeaders)
 * into documents of its own origin (http://localhost), so on the real UI page
 * `window.Capacitor.PluginHeaders` is undefined. Every Capacitor plugin call
 * therefore silently degrades to its "web" fallback — a blob/anchor download —
 * and `<a download>` is a no-op inside a WebView. Result: "download from
 * browser" saved nothing, while "upload from browser" worked, because upload
 * goes through the native file chooser and never touches JS plugins.
 *
 * What it does
 * ------------
 * Exposes two methods to the page as `window.ElectermNative`:
 *
 *   saveUrl(url, token, fallbackName, callbackId)
 *     Streams an /api/download response straight into the public Downloads
 *     collection (MediaStore on Android 10+, the public/external Downloads
 *     dir before that). Streamed, so big files and directory tarballs never
 *     have to travel through a base64 string.
 *
 *   saveBase64(filename, base64Data, contentType, callbackId)
 *     Writes in-memory content (theme/quick-command/config exports) the same
 *     way.
 *
 * Both report back asynchronously by evaluating
 *   window.__etNativeSaveResult(callbackId, ok, dataJson, errorString)
 * (see web-components/native-file-save.js). Methods run on a single worker
 * thread so the WebView thread is never blocked.
 *
 * Note: the bridge object is reachable from every document loaded in this
 * WebView. The WebView only ever loads the packaged loading page and the
 * loopback backend (see capacitor.config.ts allowNavigation), so no third
 * party page can reach it.
 */
public class ElectermSaveBridge {

    /** Version marker: lets the web app feature-detect this bridge. */
    private static final String VERSION = "1";

    private static final Pattern STAR_FILENAME =
            Pattern.compile("filename\\*\\s*=\\s*UTF-8''([^;]+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern PLAIN_FILENAME =
            Pattern.compile("filename\\s*=\\s*\"([^\"]+)\"|filename\\s*=\\s*([^;]+)", Pattern.CASE_INSENSITIVE);

    private static final Uri DOWNLOADS_URI = Uri.parse("content://media/external/downloads");

    private final Context context;
    private final WebView webView;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    public ElectermSaveBridge(Context context, WebView webView) {
        this.context = context.getApplicationContext();
        this.webView = webView;
    }

    @JavascriptInterface
    public String getVersion() {
        return VERSION;
    }

    /**
     * Fetch `url` (with the electerm token header) and store the response
     * body in the public Downloads collection.
     */
    @JavascriptInterface
    public void saveUrl(final String url, final String token, final String fallbackName, final String callbackId) {
        submit(callbackId, new Job() {
            @Override
            public JSONObject run() throws Exception {
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    if (token != null && token.length() > 0) {
                        conn.setRequestProperty("token", token);
                    }
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(120000);
                    int code = conn.getResponseCode();
                    if (code < 200 || code >= 300) {
                        throw new IOException("server responded " + code);
                    }
                    String contentType = conn.getHeaderField("Content-Type");
                    String name = resolveFilename(conn.getHeaderField("Content-Disposition"), fallbackName);
                    // The backend tars directories but only signals it via headers.
                    if (isGzip(contentType) && !name.toLowerCase().endsWith(".tar.gz")) {
                        name = name + ".tar.gz";
                    }
                    InputStream in = new BufferedInputStream(conn.getInputStream(), 64 * 1024);
                    try {
                        return save(name, mimeOf(name, contentType), in);
                    } finally {
                        in.close();
                    }
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                }
            }
        });
    }

    /** Store in-memory content (base64) in the public Downloads collection. */
    @JavascriptInterface
    public void saveBase64(final String filename, final String base64Data, final String contentType, final String callbackId) {
        submit(callbackId, new Job() {
            @Override
            public JSONObject run() throws Exception {
                byte[] data = Base64.decode(stripDataUrl(base64Data), Base64.DEFAULT);
                String name = sanitize(filename);
                return save(name, mimeOf(name, contentType), new ByteArrayInputStream(data));
            }
        });
    }

    private interface Job {
        JSONObject run() throws Exception;
    }

    private void submit(final String callbackId, final Job job) {
        worker.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    report(callbackId, true, job.run(), null);
                } catch (Throwable t) {
                    String msg = t.getMessage();
                    if (msg == null || msg.length() == 0) {
                        msg = t.toString();
                    }
                    report(callbackId, false, null, msg);
                }
            }
        });
    }

    private void report(final String callbackId, final boolean ok, final JSONObject data, final String error) {
        final String script = "window.__etNativeSaveResult(" +
                JSONObject.quote(callbackId) + "," +
                (ok ? "true" : "false") + "," +
                (data == null ? "null" : JSONObject.quote(data.toString())) + "," +
                (error == null ? "null" : JSONObject.quote(error)) +
                ");";
        webView.post(new Runnable() {
            @Override
            public void run() {
                try {
                    webView.evaluateJavascript(script, null);
                } catch (Throwable ignored) {
                    // WebView gone (activity destroyed) - nothing to report to.
                }
            }
        });
    }

    private JSONObject save(String displayName, String mimeType, InputStream in) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return saveToMediaStore(displayName, mimeType, in);
        }
        return saveToLegacyDownloads(displayName, in);
    }

    /** Android 10+ : MediaStore owns the public Downloads collection. */
    @TargetApi(Build.VERSION_CODES.Q)
    @SuppressLint("NewApi")
    private JSONObject saveToMediaStore(String name, String mimeType, InputStream in) throws Exception {
        ContentResolver cr = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put("_display_name", name);
        values.put("mime_type", mimeType);
        values.put("relative_path", Environment.DIRECTORY_DOWNLOADS);
        values.put("is_pending", 1);

        Uri item = cr.insert(DOWNLOADS_URI, values);
        if (item == null) {
            throw new IOException("could not create a Downloads entry");
        }
        try (OutputStream out = cr.openOutputStream(item)) {
            if (out == null) {
                throw new IOException("could not open the Downloads entry");
            }
            copy(in, out);
        } catch (IOException e) {
            try {
                cr.delete(item, null, null);
            } catch (Exception ignored) {
                // best effort cleanup
            }
            throw e;
        }

        ContentValues done = new ContentValues();
        done.put("is_pending", 0);
        cr.update(item, done, null, null);

        JSONObject res = new JSONObject();
        res.put("name", name);
        res.put("location", Environment.DIRECTORY_DOWNLOADS + "/" + name);
        return res;
    }

    /**
     * Android 9 and older: no MediaStore Downloads collection. Try the public
     * Downloads directory (only writable with the storage permission, which
     * this app does not request), then fall back to the app's external files
     * dir - which file managers can still browse on those releases.
     */
    private JSONObject saveToLegacyDownloads(String name, InputStream in) throws Exception {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null || !(dir.isDirectory() || dir.mkdirs()) || !dir.canWrite()) {
            dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        }
        if (dir == null) {
            throw new IOException("no writable Downloads directory");
        }
        if (!dir.isDirectory() && !dir.mkdirs()) {
            throw new IOException("could not create " + dir.getAbsolutePath());
        }
        File file = uniqueFile(dir, name);
        try (FileOutputStream out = new FileOutputStream(file)) {
            copy(in, out);
        }
        JSONObject res = new JSONObject();
        res.put("name", file.getName());
        res.put("location", file.getAbsolutePath());
        return res;
    }

    private static File uniqueFile(File dir, String name) {
        File file = new File(dir, name);
        if (!file.exists()) {
            return file;
        }
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; i < 1000; i++) {
            File candidate = new File(dir, base + " (" + i + ")" + ext);
            if (!candidate.exists()) {
                return candidate;
            }
        }
        return file;
    }

    private static String resolveFilename(String disposition, String fallback) {
        String name = null;
        if (disposition != null) {
            Matcher star = STAR_FILENAME.matcher(disposition);
            if (star.find() && star.group(1) != null) {
                name = percentDecode(star.group(1).replace("\"", "").trim());
            }
            if (name == null || name.length() == 0) {
                Matcher plain = PLAIN_FILENAME.matcher(disposition);
                if (plain.find()) {
                    String raw = plain.group(1) != null ? plain.group(1) : plain.group(2);
                    // RFC 6266: the plain form is a literal, already-decoded name.
                    if (raw != null) {
                        name = raw.trim();
                    }
                }
            }
        }
        if (name == null || name.length() == 0) {
            name = fallback;
        }
        return sanitize(name);
    }

    private static String percentDecode(String value) {
        try {
            // encodeURIComponent() never emits a bare '+', so URLDecoder's
            // plus-to-space rule cannot corrupt the name.
            return java.net.URLDecoder.decode(value, "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }

    private static String sanitize(String name) {
        if (name == null) {
            return "download";
        }
        String clean = name.replace('\\', '/');
        int slash = clean.lastIndexOf('/');
        if (slash >= 0) {
            clean = clean.substring(slash + 1);
        }
        clean = clean.replaceAll("[\\p{Cntrl}*?\"<>|]", "_").trim();
        if (clean.length() == 0 || ".".equals(clean) || "..".equals(clean)) {
            return "download";
        }
        return clean;
    }

    private static boolean isGzip(String contentType) {
        return contentType != null && contentType.toLowerCase().contains("gzip");
    }

    private static String mimeOf(String filename, String contentType) {
        if (contentType != null && contentType.length() > 0 && !contentType.startsWith("application/octet-stream")) {
            return contentType;
        }
        String lower = filename.toLowerCase();
        if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz") || lower.endsWith(".gz")) return "application/gzip";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".txt") || lower.endsWith(".log") || lower.endsWith(".md")) return "text/plain";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        return "application/octet-stream";
    }

    private static String stripDataUrl(String base64Data) {
        if (base64Data == null) {
            return "";
        }
        String trimmed = base64Data.trim();
        int comma = trimmed.indexOf(',');
        if (comma > -1 && trimmed.substring(0, comma).toLowerCase().contains("base64")) {
            return trimmed.substring(comma + 1).replaceAll("\\s", "");
        }
        return trimmed.replaceAll("\\s", "");
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = in.read(buffer)) > 0) {
            out.write(buffer, 0, read);
        }
        out.flush();
    }
}
