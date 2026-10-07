package com.researchbot.android;

import static org.junit.Assert.*;

import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real WebView/bridge/HTTPS checks. No real account, authorization code or token is used. */
@RunWith(AndroidJUnit4.class)
public class NativeAuthTransportTest {
    private WebView webView;

    private String evaluate(String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            webView.evaluateJavascript(script, result -> { value.set(result); done.countDown(); })
        );
        assertTrue("WebView did not answer the test", done.await(10, TimeUnit.SECONDS));
        return value.get();
    }

    private void waitFor(String expression, int seconds) throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
        while (System.nanoTime() < end) {
            if ("true".equals(evaluate("Boolean(" + expression + ")"))) return;
            Thread.sleep(200);
        }
        fail("Native auth transport test timed out: " + expression);
    }

    /** Like a researcher switching back when Android does not return to the app by itself. */
    private void returnToAppIfNeeded() throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < end) {
            if ("true".equals(evaluate("document.visibilityState === 'visible'"))) return;
            Thread.sleep(250);
        }
        android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        context.startActivity(
            new android.content.Intent(context, MainActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        );
    }

    @Test
    public void nativeHttpsAndTokenExchangeAfterReturningFromBrowser() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> webView = activity.getBridge().getWebView());
            waitFor("window.research && window.Capacitor && window.Capacitor.nativePromise", 30);
            // Probe through the actual Java plugin before exercising the full JS fetch adapter.
            evaluate("""
                window.__qaMetadata = null;
                (async () => {
                  const c = window.Capacitor;
                  const id = 'qa-public-metadata';
                  try {
                    const head = await c.nativePromise('ResearchNative', 'httpOpen', {
                      id, url: 'https://auth.openai.com/.well-known/openid-configuration',
                      method: 'GET', headers: {}, follow: false, readTimeout: 30000
                    });
                    let body = '';
                    for (;;) {
                      const chunk = await c.nativePromise('ResearchNative', 'httpRead', {id});
                      if (chunk.done) break;
                      body += atob(chunk.data);
                    }
                    const value = JSON.parse(body);
                    window.__qaMetadata = {status: head.status, issuer: value.issuer};
                  } catch (_) { window.__qaMetadata = {failed: true}; }
                  finally { await c.nativePromise('ResearchNative', 'httpClose', {id}); }
                })();
                """);
            waitFor("window.__qaMetadata", 45);
            JSONObject metadata = new JSONObject((String) new org.json.JSONTokener(evaluate("JSON.stringify(window.__qaMetadata)")).nextValue());
            assertEquals("Native TLS/DNS request to public OpenID metadata failed", 200, metadata.optInt("status"));
            assertEquals("https://auth.openai.com", metadata.optString("issuer"));

            evaluate("""
                // Force the shipped compatibility path while keeping the real Android bridge.
                Object.defineProperty(AbortSignal, 'any', {value: undefined, configurable: true});
                Object.defineProperty(AbortSignal, 'timeout', {value: undefined, configurable: true});
                Object.defineProperty(crypto, 'randomUUID', {value: undefined, configurable: true});
                window.__qaAuthResult = null;
                window.__qaAuthorize = null;
                window.__qaAuthorizeCount = 0;
                window.__qaTokenHead = null;
                const original = window.Capacitor.nativePromise.bind(window.Capacitor);
                window.Capacitor.nativePromise = async (plugin, method, options) => {
                  if (plugin === 'ResearchNative' && method === 'openUrl') {
                    window.__qaAuthorize = options.url;
                    window.__qaAuthorizeCount++;
                    // The system browser really opens, but on public metadata instead of account consent.
                    return original(plugin, method, {url: 'https://auth.openai.com/.well-known/openid-configuration'});
                  }
                  if (plugin === 'ResearchNative' && method === 'httpOpen' &&
                      options.url === 'https://auth.openai.com/api/accounts/oauth/token') {
                    try {
                      const head = await original(plugin, method, options);
                      window.__qaTokenHead = {status: head.status};
                      return head;
                    } catch (error) {
                      window.__qaTokenHead = {failed: true, code: error.code || 'unknown'};
                      throw error;
                    }
                  }
                  return original(plugin, method, options);
                };
                window.research.signIn().then(
                  () => { window.__qaAuthResult = {unexpectedSuccess: true}; },
                  error => { window.__qaAuthResult = {message: String(error.message)}; }
                );
                """);
            waitFor("window.__qaAuthorize", 15);
            for (int attempt = 1; attempt <= 2; attempt++) {
                // The pending state and loopback URI remain private to this test and are never logged.
                String callbackJson = evaluate("JSON.stringify((() => { const u = new URL(window.__qaAuthorize); const r = new URL(u.searchParams.get('redirect_uri')); r.search = new URLSearchParams({state: u.searchParams.get('state'), code: 'synthetic-invalid-code', client_id: 'oaiapp_native_transport_fixture'}); return {port: Number(r.port), target: r.pathname + r.search}; })())");
                JSONObject callback = new JSONObject((String) new org.json.JSONTokener(callbackJson).nextValue());
                // A real callback only arrives after the browser has loaded consent, so wait until the
                // browser actually covers the app; otherwise its late launch could land on top again.
                waitFor("document.visibilityState === 'hidden'", 20);
                // Raw loopback sockets keep the app's HTTPS-only outbound policy intact.
                try (Socket socket = new Socket("127.0.0.1", callback.getInt("port"))) {
                    socket.setSoTimeout(45000);
                    String request = "GET " + callback.getString("target") + " HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
                    socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
                    byte[] reply = socket.getInputStream().readAllBytes();
                    assertTrue("The actual callback must answer the browser", reply.length > 0);
                    String text = new String(reply, StandardCharsets.UTF_8);
                    // The browser is answered before the exchange, which runs only once the app is in front
                    // again (Android blocks networking for an app behind the browser). It never sees the outcome.
                    assertTrue("A state-valid callback must be acknowledged", text.startsWith("HTTP/1.1 200"));
                    assertTrue(text.contains("Return to Research Bot to finish"));
                    assertFalse("The browser reply must not carry the outcome", text.contains("RB-AUTH-"));
                }
                returnToAppIfNeeded();
                // invalid_grant intentionally starts one fresh attempt. Answer that attempt too.
                waitFor("window.__qaAuthResult || window.__qaAuthorizeCount > " + attempt, 45);
                if ("true".equals(evaluate("Boolean(window.__qaAuthResult)"))) break;
            }
            waitFor("window.__qaAuthResult", 15);
            JSONObject head = new JSONObject((String) new org.json.JSONTokener(evaluate("JSON.stringify(window.__qaTokenHead)")).nextValue());
            assertTrue("Native token POST did not produce an HTTP response: " + head, head.optInt("status") >= 400);
            JSONObject outcome = new JSONObject((String) new org.json.JSONTokener(evaluate("JSON.stringify(window.__qaAuthResult)")).nextValue());
            assertFalse("A dummy code must never connect an account", outcome.optBoolean("unexpectedSuccess"));
            assertFalse("Stock Android native exchange failed before receiving its rejection: " + outcome, outcome.optString("message").contains("EXCHANGE-NETWORK"));
            assertTrue(outcome.optString("message").contains("RB-AUTH-"));
            evaluate("window.__qaConnection = null; window.research.checkSignInConnection(new AbortController().signal).then(result => window.__qaConnection = result)");
            waitFor("window.__qaConnection", 30);
            JSONObject connection = new JSONObject((String) new org.json.JSONTokener(evaluate("JSON.stringify(window.__qaConnection)")).nextValue());
            org.json.JSONArray checks = connection.getJSONArray("checks");
            assertEquals("HTTP 200", checks.getJSONObject(0).getString("result"));
            assertEquals("HTTP 200", checks.getJSONObject(1).getString("result"));
            assertEquals("HTTP 200", checks.getJSONObject(2).getString("result"));
            assertTrue("The dummy request must receive an HTTP rejection", checks.getJSONObject(3).getString("result").matches("HTTP [45][0-9]{2}"));
            assertFalse(connection.getJSONObject("features").getBoolean("signalAny"));
            assertFalse(connection.getJSONObject("features").getBoolean("signalTimeout"));
            assertFalse(connection.getJSONObject("features").getBoolean("randomUuid"));
            assertEquals("The bundled and native APK versions must match", connection.getJSONObject("device").getString("appVersion"), connection.getJSONObject("device").getString("nativeVersion"));
            // Do not leave the deliberately unissued fixture client in this isolated debug app.
            evaluate("Promise.all(['registration.json', 'signin.json'].map(name => window.Capacitor.nativePromise('ResearchNative', 'fileRemove', {name})))");
            System.out.println("Native Android HTTPS passed: public metadata, real token POST rejection and callback while a browser tab was open; no account credentials used.");
        }
    }
}
