# Android token transport and WebView compatibility

The maintainer's updated Android screenshot shows `RB-AUTH-EXCHANGE-NETWORK` near the sign-in button. A separate screenshot reaches the official ChatGPT consent screen. This is evidence that the earlier error-visibility fix works on their phone, but does not establish the underlying exception or a successful token exchange. Personal account details and the screenshots are excluded from this repository.

The maintainer reports that no VPN, ad blocker, firewall or custom Private DNS is enabled. These settings are not an established cause.

## Confirmed compatibility bug

The token request evaluated `AbortSignal.any` before calling the Android HTTP bridge. That API requires Chromium/WebView 116; it is newer than the production JavaScript build's Chrome 107 baseline. Removing the API in the shipped-bundle authentication fixture reproduced the exact `RB-AUTH-EXCHANGE-NETWORK` message with **zero native token requests**. A generic network label therefore did not prove DNS, VPN or server failure.

Version 0.3.7 uses a shared signal-composition fallback when the API is absent. It preserves already-aborted signals, the first cancellation reason and subsequent cancellation, and removes parent listeners when the combined signal aborts. Token exchange, authenticated requests and scholarly search use the same helper. Existing time limits remain in place. See [MDN's compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/AbortSignal.json).

This is a reproduced app bug, **not a confirmed diagnosis of the maintainer's phone**: its installed WebView version is still unknown.

## Safe native diagnostics

Capacitor may reject with a serialized object rather than an `Error`. The native fetch adapter previously discarded that object's useful failure classification. Java now emits fixed allowlisted codes for DNS, TLS, timeout and connection failures. Both opening and reading a response preserve that classification through the adapter, without retaining raw exceptions, URLs or response bodies. Token exchange turns those codes into visible `RB-AUTH-EXCHANGE-DNS`, `-TLS`, `-TIMEOUT` or `-CONNECT` notices. Unknown failures retain the generic code. Unexpected redirects and invalid native responses have their own fixed reasons.

The app also shows its version and the installed Android WebView version beside a sign-in failure. These values remain local and are not included in credentials. A real connection failure should now be distinguishable from the compatibility bug. PKCE, state, nonce, issuer, audience, signature, account binding and encrypted credential storage remain enforced.

## Validation

- 86 unit tests pass, including missing-API cancellation controls and serialized native error/redaction tests.
- All seven browser/UI smoke scripts pass; the production Android OAuth fixture passes with `AbortSignal.any` removed. Native services and OpenAI credentials/responses in these browser tests are synthetic.
- Production CSP, SQLite persistence, encrypted authentication recovery, the visible native DNS code and the WebView support label pass the production-bundle fixtures.
- Lint, type checking, formatting, dependency/toolchain checks, 24 Electron-Node tests, packaged Electron smoke checks, Android debug compilation and Android lint pass locally. The dependency audit reports zero vulnerabilities.
- The new instrumented Android test uses the actual WebView/Java HTTPS bridge for public OpenID metadata, then a real token POST with a deliberately invalid code and unissued fixture client while a system browser is open. It disables `AbortSignal.any` for the exchange. It must receive an HTTP rejection and must never connect an account. This is a transport check, not a real-account sign-in. The instrumented Android 16 check passed in source CI. The initial test only answered the first dummy callback and timed out during the app’s normal one-retry flow; the corrected test answers both attempts and verifies the final rejection.

Source [CI run 37623448889](https://github.com/Srimi1/research------bot/actions/runs/37623448889) passed all six jobs on `7c1d61a37bff1a1b653d311969b3a50e523fa2b1`: the full suite, Windows/Linux packaging, mounted/installed Apple Silicon and Intel DMGs, and native Android launch/create/save/cold-restart plus the real HTTPS transport test. The signed release APK’s separate runtime/public-download checks will be recorded after publication.

## Remaining validation

The OnePlus 7T Pro / Android 16 / Legion OS failure still needs a fresh attempt with the corrected APK. Phone-specific network restrictions, installed WebView version, live account eligibility and inference are not established by these tests. Keep the existing app data; install the update over the app and begin a fresh sign-in. If it fails, share only the fixed error text and the displayed app/WebView versions, never a localhost callback URL, authorization code or token.
