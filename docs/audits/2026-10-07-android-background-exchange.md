# Android sign-in: token exchange blocked behind the browser (7 October 2026)

Scope: Android APK only. Reporting device: OnePlus 7T Pro, Android 16 (Legion OS), Android System WebView 153.0.8010.36, Research Bot 0.3.7 and 0.3.8. Fresh attempts failed on Wi-Fi and mobile data with no VPN, ad blocker, firewall or custom Private DNS. Screenshots and account details are excluded.

## The contradiction on the phone

On the phone, 0.3.8's **Check connection** reached every identity endpoint: native HTTPS 200, metadata 200, signing keys 200, and the dummy token exchange 400. That 400 is a real answer from the token server. The real sign-in still failed with `RB-AUTH-EXCHANGE-DNS` against the same host. The resolver works while Research Bot is on screen, so the question was what differs during consent.

## Cause

The OAuth redirect reaches the app's RFC 8252 loopback listener while the browser's consent page is still in front. In 0.3.8 and earlier, the token exchange ran inside that callback handler. That was before Research Bot returned to the foreground, and the app returned only after the exchange finished.

Android can block networking while an app is cached behind the browser. The Android 16 emulator reproduced this with its stock network policy; Data Saver and battery restrictions can also block background access. A blocked app's DNS lookup fails, so Java raises `UnknownHostException` and the app reports `RB-AUTH-EXCHANGE-DNS`. Wi-Fi and mobile data behave the same because the block is per app, not per network.

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

The same script on the fixed debug build ([CI run 37641427802](https://github.com/Srimi1/research------bot/actions/runs/37641427802), commit `456a868`, Android 16 emulator):

| Scenario                                                   | Browser reply        | Back in front        | Native token POST      |
| ---------------------------------------------------------- | -------------------- | -------------------- | ---------------------- |
| Stock, 20 s at consent (`APP_BACKGROUND` blocked)          | HTTP 200, no outcome | By itself            | HTTP 400 after 1046 ms |
| Stock, 75 s at consent (app frozen until the user returns) | HTTP 200 once back   | After switching back | HTTP 400 after 625 ms  |
| Data Saver on metered data, 20 s                           | HTTP 200, no outcome | By itself            | HTTP 400 after 378 ms  |

HTTP 400 is the token server rejecting the dummy code. The app then starts its single fresh authorization for `invalid_grant`, as designed. Before the fix the same Data Saver case failed with `RB_NET_DNS` in 5 ms.

Other checks on that commit: 95 unit tests (including the new ordering and cancellation cases), the production-bundle Android OAuth smoke in normal and legacy-WebView modes, the instrumented native transport test on Android 16, startup and saved-project recovery on Android 16, lint, format, type checks and desktop packaging. The signed release additionally installs the APK fresh and over the published 0.3.8 APK, then verifies saved notes after a cold restart before publishing.

All of this ran on the emulator. Live ChatGPT sign-in on the reporting OnePlus 7T Pro remains unconfirmed until the maintainer tries 0.3.9.

## Android-only release follow-up

Version 0.3.9 was present as an unpublished draft. The previous release attempts stopped at GitHub's signing-key restoration step and attached no APK. The original private signing backup is available locally, so the release is being completed with a locally signed APK and the existing **prebuilt** workflow path. No private signing material is uploaded to GitHub.

The APK is built from merged commit `202b077ef54620e10211bf268277c3cf1a253afe`; all six jobs in [source CI 37649730288](https://github.com/Srimi1/research------bot/actions/runs/37649730288) passed. That run confirms real rejected token requests after 20-second and 75-second browser consent waits and the Data Saver case without instrumentation. Local formatting, lint, dependency/toolchain checks and all 95 unit tests pass; the dependency audit reports zero vulnerabilities. Signed fresh-install/0.3.8-upgrade and public-download checks remain pending the release gate.

The local signed release build and Android lint passed. The APK is 4,772,587 bytes with SHA-256 `4ecaac44c15ea2d500b9e2be85e971fa583b6f3ed92c8453c91f3aedff3df2ff`. Verification confirms the existing signing certificate, package/version 0.3.9 (309), SDK 26–36, 16 KiB alignment, no release debug flag, and packaged WebView debugging disabled.
