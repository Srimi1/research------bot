# Android sign-in: token exchange blocked behind the browser (7 October 2026)

Scope: Android APK only. Reporting device: OnePlus 7T Pro, Android 16 (Legion OS), Android System WebView 153.0.8010.36, Research Bot 0.3.7 and 0.3.8. Fresh attempts failed on Wi-Fi and mobile data with no VPN, ad blocker, firewall or custom Private DNS. Screenshots and account details are excluded.

## The contradiction on the phone

On the phone, 0.3.8's **Check connection** reached every identity endpoint: native HTTPS 200, metadata 200, signing keys 200, and the dummy token exchange 400. That 400 is a real answer from the token server. The real sign-in still failed with `RB-AUTH-EXCHANGE-DNS` against the same host. The resolver works while Research Bot is on screen, so the question was what differs during consent.

## Cause

The OAuth redirect reaches the app's RFC 8252 loopback listener while the browser's consent page is still in front. In 0.3.8 and earlier, the token exchange ran inside that callback handler. That was before Research Bot returned to the foreground, and the app returned only after the exchange finished.

Android blocks networking for an app whose process is not in a foreground state. Android 15 and later do this by default for apps outside a valid process lifecycle. Data Saver and battery restrictions block background apps the same way. A blocked app's DNS lookup fails, so Java raises `UnknownHostException` and the app reports `RB-AUTH-EXCHANGE-DNS`. Wi-Fi and mobile data behave the same because the block is per app, not per network.

Earlier emulator checks missed this for two reasons. An instrumented test process counts as foreground. Those tests also answered the callback within seconds, before Android's background block took effect.

## Reproduction (before the fix)

`scripts/android-background-exchange.mjs` drives the real debug APK on the Android 16 emulator (SDK 36, Google APIs image, WebView 133) **without instrumentation**, through WebView DevTools. That bridge exists only in debuggable builds. A real browser opens over the app on a public page. After a wait like a user reading consent, a dummy loopback callback is delivered. Only fixed reason codes, HTTP statuses and Android process/network-policy states are logged. The callback URL is never printed. The script uses no account, real authorization code or token.

[CI run 37638070126](https://github.com/Srimi1/research------bot/actions/runs/37638070126) on `59ea997`, with the auth code unchanged from 0.3.8:

| Moment                                       | Research Bot process | Android network policy for the app                                            | Result                                                                                 |
| -------------------------------------------- | -------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| App in front                                 | `TOP`                | `effective=NONE`                                                              | Check connection: HTTP 200 / 200 / 200 / 400                                           |
| Browser in front, +15 s                      | `LAST_ACTIVITY`      | `effective=APP_BACKGROUND` (stock Android 16; also `DATA_SAVER` when enabled) | Waiting for the callback                                                               |
| Callback delivered at +20 s (Data Saver run) | `LAST_ACTIVITY`      | blocked                                                                       | Native token POST `RB_NET_DNS` after 5 ms; browser and app show `RB-AUTH-EXCHANGE-DNS` |

This matches the phone exactly: the foreground check passes and the real exchange fails as a DNS error. Stock Android 16 alone, with no Data Saver, already reports `APP_BACKGROUND` blocking 15 seconds after the browser opens. In a 75-second stock run the cached app was frozen and did not answer the callback until it returned to the foreground. That run's first foreground check also failed before the freshly booted emulator's network was ready. The script now waits for a working foreground network first.

## Fix (0.3.9)

On Android, after the callback passes the constant-time state check and the code is read:

1. The browser gets a neutral reply ("Authorization received. Return to Research Bot to finish connecting ChatGPT."), and Android is asked to bring Research Bot back. The browser never sees the outcome.
2. The new native `awaitForeground` resolves once the activity is resumed. It also waits until `ConnectivityManager` reports the app's active network as connected, not blocked, with a 10-second bound. This uses the normal, install-time `ACCESS_NETWORK_STATE` permission.
3. Only then are the PKCE token exchange and identity verification performed. Cancelling, closing the dialog or the five-minute limit aborts the wait without sending the code.

PKCE, state, nonce, issuer, audience and RS256 signature checks, account binding and Keystore-encrypted credentials are unchanged. TLS verification is untouched. Desktop behavior is unchanged. Projects and notes are not touched.

## Validation

Fixed-build results are recorded in [docs/releases/v0.3.9.md](../releases/v0.3.9.md) and the PR. Emulator results do not substitute for a live sign-in on the reporting phone, which remains unconfirmed until the maintainer tries 0.3.9.
