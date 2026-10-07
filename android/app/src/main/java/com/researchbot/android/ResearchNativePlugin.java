package com.researchbot.android;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.content.FileProvider;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.ConnectException;
import java.net.UnknownHostException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.SSLException;

/**
 * The device services the shared research backend needs on Android: HTTPS with streamed bodies
 * (the WebView's fetch is limited by CORS), the RFC 8252 loopback receiver for ChatGPT sign-in,
 * Android Keystore encryption for credentials, private files, document export and APK updates.
 */
@CapacitorPlugin(name = "ResearchNative")
public class ResearchNativePlugin extends Plugin {

    private static final String KEY_ALIAS = "research-bot-credentials";
    private static final Pattern FILE_NAME = Pattern.compile("^[a-z0-9][a-z0-9._-]{0,63}$");
    private static final int CHUNK = 64 * 1024;
    private static final long MAX_UPDATE_BYTES = 300L * 1024 * 1024;
    private static final Set<String> UPDATE_HOSTS = new HashSet<>(
        Arrays.asList("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
    );

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final AtomicInteger ids = new AtomicInteger();
    private final Map<String, HttpURLConnection> connections = new ConcurrentHashMap<>();
    private final Map<String, InputStream> bodies = new ConcurrentHashMap<>();
    private final Map<String, ServerSocket> servers = new ConcurrentHashMap<>();
    private final Map<String, Socket> callbacks = new ConcurrentHashMap<>();
    private final List<PluginCall> foregroundWaiters = new ArrayList<>();
    private boolean resumed;

    @Override
    protected void handleOnResume() {
        List<PluginCall> waiting;
        synchronized (foregroundWaiters) {
            resumed = true;
            waiting = new ArrayList<>(foregroundWaiters);
            foregroundWaiters.clear();
        }
        for (PluginCall call : waiting) executor.execute(() -> resolveWhenNetworkAllowed(call));
    }

    @Override
    protected void handleOnPause() {
        synchronized (foregroundWaiters) {
            resumed = false;
        }
    }

    @Override
    protected void handleOnDestroy() {
        getContext().stopService(new Intent(getContext(), SignInService.class));
        for (String id : connections.keySet()) closeHttp(id);
        for (String id : servers.keySet()) closeServer(id);
        executor.shutdownNow();
    }

    // HTTPS -----------------------------------------------------------------------------------

    /** Sends a request and resolves with status and headers; the body is pulled with httpRead. */
    @PluginMethod
    public void httpOpen(PluginCall call) {
        String id = call.getString("id");
        String target = call.getString("url");
        if (id == null || target == null) {
            call.reject("A request needs an ID and a URL.");
            return;
        }
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(target);
                if (!"https".equals(url.getProtocol())) throw new IOException("Only HTTPS requests are allowed.");
                connection = (HttpURLConnection) url.openConnection();
                connections.put(id, connection);
                // HttpURLConnection never follows a redirect to another protocol, so HTTPS stays HTTPS.
                connection.setInstanceFollowRedirects(call.getBoolean("follow", false));
                connection.setUseCaches(false);
                connection.setConnectTimeout(30_000);
                connection.setReadTimeout(call.getInt("readTimeout", 300_000));
                String method = call.getString("method", "GET");
                connection.setRequestMethod(method);
                JSObject headers = call.getObject("headers", new JSObject());
                Iterator<String> names = headers.keys();
                while (names.hasNext()) {
                    String name = names.next();
                    connection.setRequestProperty(name, headers.getString(name));
                }
                String body = call.getString("body");
                if (body != null) {
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(bytes);
                    }
                }
                int status = connection.getResponseCode();
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (stream != null) bodies.put(id, stream);
                JSObject responseHeaders = new JSObject();
                for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                    if (entry.getKey() == null) continue;
                    responseHeaders.put(entry.getKey().toLowerCase(Locale.ROOT), String.join(", ", entry.getValue()));
                }
                JSObject result = new JSObject();
                result.put("status", status);
                result.put("statusText", connection.getResponseMessage() == null ? "" : connection.getResponseMessage());
                result.put("headers", responseHeaders);
                if (!connections.containsKey(id)) throw new IOException("Request cancelled.");
                call.resolve(result);
            } catch (Exception error) {
                closeHttp(id);
                rejectNetwork(call, error);
            }
        });
    }

    /** The next body chunk as base64, or done when the body has ended. */
    @PluginMethod
    public void httpRead(PluginCall call) {
        String id = call.getString("id", "");
        executor.execute(() -> {
            InputStream stream = bodies.get(id);
            JSObject result = new JSObject();
            if (stream == null) {
                result.put("done", true);
                call.resolve(result);
                return;
            }
            try {
                byte[] buffer = new byte[CHUNK];
                int read = stream.read(buffer);
                if (read < 0) {
                    closeHttp(id);
                    result.put("done", true);
                } else {
                    result.put("done", false);
                    result.put("data", Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP));
                }
                call.resolve(result);
            } catch (Exception error) {
                closeHttp(id);
                rejectNetwork(call, error);
            }
        });
    }

    @PluginMethod
    public void httpClose(PluginCall call) {
        String id = call.getString("id", "");
        executor.execute(() -> closeHttp(id));
        call.resolve();
    }

    private void closeHttp(String id) {
        InputStream stream = bodies.remove(id);
        HttpURLConnection connection = connections.remove(id);
        try {
            if (stream != null) stream.close();
        } catch (IOException ignored) {}
        if (connection != null) connection.disconnect();
    }

    private static void rejectNetwork(PluginCall call, Exception error) {
        String code = error instanceof UnknownHostException ? "RB_NET_DNS"
            : error instanceof SSLException ? "RB_NET_TLS"
            : error instanceof SocketTimeoutException ? "RB_NET_TIMEOUT"
            : error instanceof ConnectException ? "RB_NET_CONNECT" : "RB_NET_IO";
        // Do not send exception text or attach its stack: it can contain request details.
        call.reject("The Android network request failed.", code);
    }

    // Foreground network -------------------------------------------------------------------------

    @PluginMethod
    public void signInKeepAliveStart(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            synchronized (foregroundWaiters) {
                if (!resumed) {
                    call.reject("Return to Research Bot before starting sign-in.");
                    return;
                }
            }
            Handler handler = new Handler(Looper.getMainLooper());
            Runnable timeout = () -> {
                getContext().stopService(new Intent(getContext(), SignInService.class));
                call.reject("The sign-in service did not start.");
            };
            ResultReceiver reply = new ResultReceiver(handler) {
                @Override
                protected void onReceiveResult(int resultCode, android.os.Bundle data) {
                    handler.removeCallbacks(timeout);
                    if (resultCode == 0) call.resolve();
                    else call.reject("The sign-in service could not start.");
                }
            };
            try {
                handler.postDelayed(timeout, 10_000);
                ContextCompat.startForegroundService(
                    getContext(), new Intent(getContext(), SignInService.class).putExtra("reply", reply)
                );
            } catch (RuntimeException error) {
                handler.removeCallbacks(timeout);
                call.reject("The sign-in service could not start.");
            }
        });
    }

    @PluginMethod
    public void signInKeepAliveStop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), SignInService.class));
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName())
            ));
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Android app settings could not open.");
        }
    }

    /**
     * Resolves once the activity is resumed and Android reports this app's network as usable.
     * While the browser is in front, Android may block the app's networking (Android 15+ background
     * restrictions, Data Saver, battery restrictions); the resolver then fails as an unknown host.
     */
    @PluginMethod
    public void awaitForeground(PluginCall call) {
        synchronized (foregroundWaiters) {
            if (!resumed) {
                foregroundWaiters.add(call);
                return;
            }
        }
        executor.execute(() -> resolveWhenNetworkAllowed(call));
    }

    private void resolveWhenNetworkAllowed(PluginCall call) {
        // Network rules follow the process state asynchronously after the activity resumes.
        long end = System.nanoTime() + 10_000_000_000L;
        try {
            while (!networkAllowed() && System.nanoTime() < end) Thread.sleep(100);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        // Resolve even if still blocked; the request then reports its own fixed network reason.
        call.resolve();
    }

    @SuppressWarnings("deprecation")
    private boolean networkAllowed() {
        try {
            ConnectivityManager manager = getContext().getSystemService(ConnectivityManager.class);
            if (manager == null) return true;
            // The active network is reported as BLOCKED (not connected) when this UID is blocked.
            NetworkInfo info = manager.getActiveNetworkInfo();
            return info != null && info.isConnected();
        } catch (RuntimeException unavailable) {
            return true;
        }
    }

    // Loopback sign-in callback ----------------------------------------------------------------

    @PluginMethod
    public void loopbackStart(PluginCall call) {
        try {
            ServerSocket server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
            String serverId = "s" + ids.incrementAndGet();
            servers.put(serverId, server);
            executor.execute(() -> acceptLoop(serverId, server));
            JSObject result = new JSObject();
            result.put("serverId", serverId);
            result.put("port", server.getLocalPort());
            call.resolve(result);
        } catch (IOException error) {
            call.reject("The local ChatGPT callback could not start.");
        }
    }

    private void acceptLoop(String serverId, ServerSocket server) {
        while (!server.isClosed()) {
            Socket socket;
            try {
                socket = server.accept();
            } catch (IOException closed) {
                return;
            }
            executor.execute(() -> readCallback(serverId, socket));
        }
    }

    private void readCallback(String serverId, Socket socket) {
        try {
            socket.setSoTimeout(10_000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.ISO_8859_1));
            String line = reader.readLine();
            if (line == null || line.length() > 16_384) throw new IOException("Invalid request.");
            String[] parts = line.split(" ");
            if (parts.length != 3) throw new IOException("Invalid request.");
            // Drain headers; the callback carries everything it needs in the query string.
            int count = 0;
            for (String header = reader.readLine(); header != null && !header.isEmpty(); header = reader.readLine()) {
                if (++count > 100) throw new IOException("Too many headers.");
            }
            String requestId = serverId + "-" + ids.incrementAndGet();
            callbacks.put(requestId, socket);
            JSObject event = new JSObject();
            event.put("serverId", serverId);
            event.put("requestId", requestId);
            event.put("method", parts[0]);
            event.put("url", parts[1]);
            notifyListeners("loopbackRequest", event);
            // Answer for the app if it never does, so the browser tab does not hang.
            executor.execute(() -> {
                try {
                    Thread.sleep(60_000);
                } catch (InterruptedException ignored) {}
                respond(requestId, 500, "Research Bot did not answer. Return to the app and try again.");
            });
        } catch (IOException error) {
            try {
                socket.close();
            } catch (IOException ignored) {}
        }
    }

    @PluginMethod
    public void loopbackRespond(PluginCall call) {
        String requestId = call.getString("requestId", "");
        int status = call.getInt("status", 500);
        String body = call.getString("body", "");
        executor.execute(() -> {
            respond(requestId, status, body);
            // Acknowledge only after the socket write: JS closes the server after this resolves.
            call.resolve();
            if (status == 200 || call.getBoolean("returnToApp", false)) returnToApp();
        });
    }

    /** Bring the app back after a state-validated sign-in outcome, including a failed attempt. */
    private void returnToApp() {
        Activity activity = getActivity();
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(
                    new Intent(activity, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                );
            } catch (RuntimeException ignored) {
                // Android may refuse; the browser page tells the researcher to switch back.
            }
        });
    }

    private void respond(String requestId, int status, String body) {
        Socket socket = callbacks.remove(requestId);
        if (socket == null) return;
        try (Socket closing = socket; OutputStream output = closing.getOutputStream()) {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            String reason = status == 200 ? "OK" : status == 404 ? "Not Found" : status == 400 ? "Bad Request" : "Error";
            String head =
                "HTTP/1.1 " + status + " " + reason + "\r\n" +
                "Content-Type: text/plain; charset=utf-8\r\n" +
                "Cache-Control: no-store\r\n" +
                "Content-Security-Policy: default-src 'none'\r\n" +
                "Content-Length: " + bytes.length + "\r\n" +
                "Connection: close\r\n\r\n";
            output.write(head.getBytes(StandardCharsets.ISO_8859_1));
            output.write(bytes);
            output.flush();
        } catch (IOException ignored) {}
    }

    @PluginMethod
    public void loopbackClose(PluginCall call) {
        closeServer(call.getString("serverId", ""));
        call.resolve();
    }

    private void closeServer(String serverId) {
        ServerSocket server = servers.remove(serverId);
        if (server != null) {
            try {
                server.close();
            } catch (IOException ignored) {}
        }
        for (String requestId : callbacks.keySet()) {
            if (requestId.startsWith(serverId + "-")) respond(requestId, 400, "This sign-in is no longer active.");
        }
    }

    // Credentials -------------------------------------------------------------------------------

    private SecretKey credentialKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    @PluginMethod
    public void encrypt(PluginCall call) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, credentialKey());
            byte[] iv = cipher.getIV();
            byte[] sealed = cipher.doFinal(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            byte[] output = new byte[1 + iv.length + sealed.length];
            output[0] = (byte) iv.length;
            System.arraycopy(iv, 0, output, 1, iv.length);
            System.arraycopy(sealed, 0, output, 1 + iv.length, sealed.length);
            JSObject result = new JSObject();
            result.put("data", Base64.encodeToString(output, Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Android Keystore could not protect the ChatGPT credentials.");
        }
    }

    @PluginMethod
    public void decrypt(PluginCall call) {
        try {
            byte[] input = Base64.decode(call.getString("data", ""), Base64.NO_WRAP);
            int ivLength = input[0];
            if (ivLength < 12 || ivLength > 16 || input.length < 1 + ivLength + 16) throw new IOException("Invalid record.");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, credentialKey(), new GCMParameterSpec(128, input, 1, ivLength));
            byte[] plain = cipher.doFinal(input, 1 + ivLength, input.length - 1 - ivLength);
            JSObject result = new JSObject();
            result.put("text", new String(plain, StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Saved ChatGPT credentials could not be unlocked.");
        }
    }

    // Private files -----------------------------------------------------------------------------

    private File privateFile(String name) throws IOException {
        if (name == null || !FILE_NAME.matcher(name).matches()) throw new IOException("Invalid file name.");
        File directory = new File(getContext().getFilesDir(), "research");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Storage is unavailable.");
        return new File(directory, name);
    }

    @PluginMethod
    public void fileRead(PluginCall call) {
        executor.execute(() -> {
            try {
                File file = privateFile(call.getString("name"));
                JSObject result = new JSObject();
                if (!file.exists()) {
                    result.put("missing", true);
                } else {
                    byte[] data = new byte[(int) file.length()];
                    try (FileInputStream input = new FileInputStream(file)) {
                        int offset = 0;
                        while (offset < data.length) {
                            int read = input.read(data, offset, data.length - offset);
                            if (read < 0) throw new IOException("The file changed while reading.");
                            offset += read;
                        }
                    }
                    result.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
                }
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Research Bot could not read its saved data: " + describe(error));
            }
        });
    }

    @PluginMethod
    public void fileWrite(PluginCall call) {
        executor.execute(() -> {
            try {
                File file = privateFile(call.getString("name"));
                byte[] data = Base64.decode(call.getString("data", ""), Base64.NO_WRAP);
                File temporary = new File(file.getParentFile(), file.getName() + ".tmp");
                try (FileOutputStream output = new FileOutputStream(temporary)) {
                    output.write(data);
                    output.getFD().sync();
                }
                if (!temporary.renameTo(file)) throw new IOException("The saved file could not be replaced.");
                call.resolve();
            } catch (Exception error) {
                call.reject("Research Bot could not save its data: " + describe(error));
            }
        });
    }

    @PluginMethod
    public void fileRemove(PluginCall call) {
        try {
            File file = privateFile(call.getString("name"));
            if (file.exists() && !file.delete()) throw new IOException("The file could not be removed.");
            call.resolve();
        } catch (Exception error) {
            call.reject(describe(error));
        }
    }

    // Links and export --------------------------------------------------------------------------

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) {
            call.reject("Only web links can be opened.");
            return;
        }
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                new CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(activity, uri);
                call.resolve();
            } catch (ActivityNotFoundException missing) {
                try {
                    activity.startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
                    call.resolve();
                } catch (ActivityNotFoundException none) {
                    call.reject("No browser is installed to open this link.");
                }
            }
        });
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(call.getString("mimeType", "text/plain"))
            .putExtra(Intent.EXTRA_TITLE, call.getString("name", "research-project.txt"));
        startActivityForResult(call, intent, "savedDocument");
    }

    @ActivityCallback
    private void savedDocument(PluginCall call, ActivityResult result) {
        JSObject answer = new JSObject();
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            answer.put("saved", false);
            call.resolve(answer);
            return;
        }
        Uri uri = result.getData().getData();
        executor.execute(() -> {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new IOException("The chosen location cannot be written.");
                output.write(call.getString("content", "").getBytes(StandardCharsets.UTF_8));
                answer.put("saved", true);
                answer.put("path", uri.getLastPathSegment() == null ? call.getString("name") : uri.getLastPathSegment());
                call.resolve(answer);
            } catch (Exception error) {
                call.reject("The export could not be saved: " + describe(error));
            }
        });
    }

    // Updates -----------------------------------------------------------------------------------

    @PluginMethod
    public void appInfo(PluginCall call) {
        try {
            PackageInfo info = packageInfo(getContext().getPackageName(), false);
            JSObject result = new JSObject();
            result.put("version", info.versionName);
            result.put("versionCode", versionCode(info));
            result.put("sdk", Build.VERSION.SDK_INT);
            try {
                PackageInfo webview = WebView.getCurrentWebViewPackage();
                result.put("webviewVersion", webview == null ? "unavailable" : webview.versionName);
            } catch (RuntimeException unavailable) {
                result.put("webviewVersion", "unavailable");
            }
            boolean canInstall = false;
            try {
                canInstall = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
            } catch (RuntimeException unavailable) {
                // An optional installer query must not discard app/version information.
            }
            result.put("canInstall", canInstall);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(describe(error));
        }
    }

    /** Downloads the release APK, then checks its checksum, package, version and signing certificate. */
    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String target = call.getString("url", "");
        String expected = call.getString("sha256", "").toLowerCase(Locale.ROOT);
        if (!expected.matches("^[0-9a-f]{64}$")) {
            call.reject("The update checksum is missing.");
            return;
        }
        executor.execute(() -> {
            File directory = new File(getContext().getCacheDir(), "updates");
            File apk = new File(directory, "update.apk");
            try {
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Storage is unavailable.");
                HttpURLConnection connection = openUpdate(target);
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long total = 0;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[CHUNK];
                    for (int read = input.read(buffer); read >= 0; read = input.read(buffer)) {
                        total += read;
                        if (total > MAX_UPDATE_BYTES) throw new IOException("The update is larger than expected.");
                        digest.update(buffer, 0, read);
                        output.write(buffer, 0, read);
                    }
                    output.getFD().sync();
                } finally {
                    connection.disconnect();
                }
                if (!hex(digest.digest()).equals(expected)) throw new IOException("The update checksum did not match.");
                PackageInfo installed = packageInfo(getContext().getPackageName(), true);
                PackageInfo update = archiveInfo(apk);
                if (update == null || !getContext().getPackageName().equals(update.packageName)) throw new IOException("The update is not a Research Bot package.");
                if (versionCode(update) <= versionCode(installed)) throw new IOException("The update is not newer than this version.");
                if (!certificates(update).equals(certificates(installed))) throw new IOException("The update was signed by a different key.");
                JSObject result = new JSObject();
                result.put("version", update.versionName);
                call.resolve(result);
            } catch (Exception error) {
                apk.delete();
                call.reject("The update could not be downloaded: " + describe(error));
            }
        });
    }

    private HttpURLConnection openUpdate(String target) throws IOException {
        URL url = new URL(target);
        for (int hop = 0; hop < 5; hop++) {
            if (!"https".equals(url.getProtocol()) || !UPDATE_HOSTS.contains(url.getHost())) throw new IOException("Unexpected download location.");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(60_000);
            connection.setRequestProperty("Accept", "application/octet-stream");
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IOException("Invalid redirect.");
                url = new URL(url, location);
                continue;
            }
            if (status != 200) {
                connection.disconnect();
                throw new IOException("HTTP " + status);
            }
            return connection;
        }
        throw new IOException("Too many redirects.");
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        File apk = new File(new File(getContext().getCacheDir(), "updates"), "update.apk");
        if (!apk.exists()) {
            call.reject("Download the update first.");
            return;
        }
        Activity activity = getActivity();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            activity.startActivity(
                new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))
            );
            call.reject("Allow Research Bot to install updates in the screen that just opened, then choose Install again.");
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("Android's package installer could not be opened.");
        }
    }

    @SuppressWarnings("deprecation")
    private PackageInfo packageInfo(String name, boolean signatures) throws PackageManager.NameNotFoundException {
        PackageManager manager = getContext().getPackageManager();
        int flags = signatures ? (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES) : 0;
        return manager.getPackageInfo(name, flags);
    }

    @SuppressWarnings("deprecation")
    private PackageInfo archiveInfo(File apk) {
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        return getContext().getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), flags);
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    /** SHA-256 fingerprints of the certificates the package is currently signed with. */
    @SuppressWarnings("deprecation")
    private static Set<String> certificates(PackageInfo info) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo signing = info.signingInfo;
            if (signing == null) throw new IOException("The package is not signed.");
            if (signing.hasMultipleSigners()) {
                signatures = signing.getApkContentsSigners();
            } else {
                // The history lists the original certificate first and the current one last.
                Signature[] history = signing.getSigningCertificateHistory();
                signatures = history == null || history.length == 0 ? null : new Signature[] { history[history.length - 1] };
            }
        } else {
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length == 0) throw new IOException("The package is not signed.");
        Set<String> result = new HashSet<>();
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (Signature signature : signatures) result.add(hex(digest.digest(signature.toByteArray())));
        return result;
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) builder.append(String.format(Locale.ROOT, "%02x", value));
        return builder.toString();
    }

    private static String describe(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }
}
