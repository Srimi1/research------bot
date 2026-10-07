# Repeated Android sign-in failure investigation

The maintainer reported four failed sign-ins after browser consent on Android 16 / Legion OS / OnePlus 7T Pro. The supplied browser screenshot says “ChatGPT sign-in did not complete. Return to Research Bot to try again.” They reported no visible error after returning to the app. This differs from the earlier callback-reply race fixed in 0.3.5.

## Evidence and confirmed bugs

The displayed text comes from the state-validated OAuth callback's exception handler in `core/auth.ts`. It confirms that the app answered with its generic failure page. It does **not** identify whether the token exchange, identity verification or credential write failed.

1. The account dialog put its error below all preferences, outside the initial phone viewport. A production-bundle regression with a 412 × 892 viewport fails against the original UI because the complete error is below the screen. The revised UI passes the same geometry check for exchange, identity and storage failures.
2. The browser page concealed every specific error behind the same sentence; only successful callbacks returned automatically to the app. A validated failed callback now returns to Research Bot and shows an allowlisted reason on both surfaces. An invalid-state callback does not trigger that return.
3. Failed first sign-ins did not preserve the issued registration across restarts. They could repeat dynamic registration and consent. The app now retains the public client ID in app-private storage separately from encrypted credentials, and retries with that issued ID and the existing host ID. It still verifies the signature, issuer, audience, expiry, nonce and returning account before storing any token. A regression rejects an invalid nonce, restarts the auth service, reconnects using the retained registration, and checks that no credentials were saved before validation.
4. Error state existed only in the open React dialog. The backend now retains a fixed reason code and optional HTTP status in `signin.json`; reopening or restarting can display it. Arbitrary upstream descriptions, callback URLs, tokens and personal account details never enter this notice. Successful connection removes the failure notice and incomplete-registration checkpoint.

## Protocol review

Rechecked the official [local/open-source sign-in instructions](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [account/session guidance](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), and [integration walkthrough](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) on 2026-10-07.

The current authorize/token endpoints, fixed loopback host/path, exact per-attempt redirect URI, resource, scopes, stable host ID, dynamic/issued client handling, PKCE and nonce checks match that guidance. The public OpenID configuration and JWKS returned HTTP 200 and matched the pinned issuer, token endpoint and RS256 verification configuration. This review used public metadata only and did not attempt account authorization.

## Validation

- 83 unit tests and 24 tests using Electron's bundled Node passed.
- The original UI failed the phone error-visibility regression; the revised production bundle passed that check.
- The packaged Android authentication fixture exercises the actual backend, native JavaScript adapters and WebCrypto RSA validation under the shipped CSP. Synthetic responses cover HTTP 403 with an unreadable body, a mismatched nonce, encryption failure, successful recovery, model discovery and encrypted cold-restart persistence. Native services and OpenAI responses are mocked; the fixture does not establish real browser consent or native Keystore behavior.
- Callback adapter regressions check awaited response ordering, safe error redaction, restart recovery, fresh PKCE/state and return-to-app flags on trusted versus untrusted callbacks.
- Formatting, lint, toolchain compatibility and dependency audit passed; the audit reported zero vulnerabilities.

[All six source CI jobs](https://github.com/Srimi1/research------bot/actions/runs/37616249258) passed on source commit `21c2bc27cad9483bc8ce231f0074c9b78c41eeb8`, including debug APK startup/persistence and both installed Mac DMGs. [All seven release jobs](https://github.com/Srimi1/research------bot/actions/runs/37616964369) passed on installer commit `e625dde45c6c4e6b3e0af54f41a6663e0f2f2c25`. The actual signed APK passed native Android 16 launch/create/save/cold-restart checks before the release was published. Both released DMGs passed mount/install/runtime checks on their matching Mac architectures.

Published [version 0.3.6](https://github.com/Srimi1/research------bot/releases/tag/v0.3.6) as the latest non-prerelease. The public APK and both DMGs returned HTTP 200 and matched GitHub asset digests and the platform checksum files; the DMGs had valid UDIF trailers. All 15 release assets were checked against metadata/checksums, including Windows/Linux update manifests. The public APK signing certificate, SDK targets and 16 KiB alignment were verified. APK SHA-256: `ebe0e194088890e2a686a6b34e0e9abe0d2e5efd895d504c551107769bcf1cd5` (4,768,995 bytes).

## Remaining limit

Subsequent screenshots from the updated app expose `RB-AUTH-EXCHANGE-NETWORK`. The next [transport and WebView investigation](2026-10-07-android-auth-transport.md) reproduces a missing-API bug that can cause that exact code before any network request. The installed phone WebView and its actual underlying exception remain unknown.

The original device's precise failure is still unknown: its old browser page was generic, and the maintainer could not see the app's error. No real ChatGPT account credentials were available for consent, eligibility or inference validation. The update fixes the confirmed recovery/feedback bugs and makes a remaining failure diagnosable; it does not establish that this account can already complete sign-in. A safe `RB-AUTH-…` error from the updated app is needed if the attempt still fails.
