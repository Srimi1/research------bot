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

    @Test
    public void nativeHttpsAndTokenExchangeWhileBrowserIsOpen() throws Exception {
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
                // Raw loopback sockets keep the app's HTTPS-only outbound policy intact.
                try (Socket socket = new Socket("127.0.0.1", callback.getInt("port"))) {
                    socket.setSoTimeout(45000);
                    String request = "GET " + callback.getString("target") + " HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
                    socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
                    byte[] reply = socket.getInputStream().readAllBytes();
                    assertTrue("The actual callback must answer the browser", reply.length > 0);
                    String text = new String(reply, StandardCharsets.UTF_8);
                    assertTrue("Dummy authorization must return a failed callback", text.startsWith("HTTP/1.1 400"));
                    // Print only a fixed local reason, never the callback URL or raw provider reply.
                    java.util.regex.Matcher reason = java.util.regex.Pattern.compile("RB-AUTH-[A-Z-]+").matcher(text);
                    System.out.println("Native dummy exchange callback: " + (reason.find() ? reason.group() : "missing safe reason"));
                }
                // invalid_grant intentionally starts one fresh attempt. Answer that attempt too.
                waitFor("window.__qaAuthResult || window.__qaAuthorizeCount > " + attempt, 15);
                if ("true".equals(evaluate("Boolean(window.__qaAuthResult)"))) break;
            }
            waitFor("window.__qaAuthResult", 15);
            JSONObject head = new JSONObject((String) new org.json.JSONTokener(evaluate("JSON.stringify(window.__qaTokenHead)")).nextValue());
            assertTrue("Native token POST did not produce an HTTP response: " + head, head.optInt("status") >= 400);
            JSONObject outcome = new JSONObject((String) new org.json.JSONTokener(evaluate("JSON.stringify(window.__qaAuthResult)")).nextValue());
            assertFalse("A dummy code must never connect an account", outcome.optBoolean("unexpectedSuccess"));
            assertFalse("Stock Android native exchange failed before receiving its rejection: " + outcome, outcome.optString("message").contains("EXCHANGE-NETWORK"));
            assertTrue(outcome.optString("message").contains("RB-AUTH-"));
            // Do not leave the deliberately unissued fixture client in this isolated debug app.
            evaluate("Promise.all(['registration.json', 'signin.json'].map(name => window.Capacitor.nativePromise('ResearchNative', 'fileRemove', {name})))");
            System.out.println("Native Android HTTPS passed: public metadata, real token POST rejection and callback while a browser tab was open; no account credentials used.");
        }
    }
}
