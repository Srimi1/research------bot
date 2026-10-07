# Download Research Bot for Android

[**Download the signed Research Bot 0.3.7 APK**](https://github.com/Srimi1/research------bot/raw/refs/heads/main/downloads/android/research-bot-0.3.7-android.apk)

Supports Android 8 or later and targets Android 16. Open the downloaded APK on your phone, allow installation from your browser/file manager when prompted, and choose **Install**.

This APK uses the same personal signing certificate as versions 0.3.1 through 0.3.6. Install over your existing build to retain projects. If your existing app uses another signing certificate, export projects before uninstalling it. This version is installed manually.

## Verify the download

[SHA256SUMS.txt](SHA256SUMS.txt) contains the APK's SHA-256:

```text
3d53f4d5acd8f19b11a246a6335c8e561704c74f67013d342a7d563e9b2919fb
```

From this folder on a computer:

```sh
sha256sum -c SHA256SUMS.txt
```

Package: `com.researchbot.android`. Version: `0.3.7` / code `307`. Signing certificate SHA-256: `98580ca053712555a2b8a3a8fecfc15c85d83c5d192480e3b6b09ca13a633441`.

Built from [7c1d61a](https://github.com/Srimi1/research------bot/commit/7c1d61a37bff1a1b653d311969b3a50e523fa2b1), with passing regression tests, production Android SQLite/CSP and synthetic OAuth checks (including a missing `AbortSignal.any`), Android release compilation/lint, and signature/alignment checks. The release pipeline installs and checks this actual signed APK on Android 16 before publication. The signing key is private and is not included in the repository. Physical-phone behavior and live ChatGPT sign-in remain unverified.

[BUILD_INFO.json](BUILD_INFO.json) records public build metadata. The release workflow can verify this APK with `node scripts/verify-release-apk.mjs` and publish it without copying the signing key to CI.

Version 0.3.7 fixes a reproduced sign-in failure when `AbortSignal.any` is unavailable in WebView. It also preserves safe native DNS/TLS/timeout/connection codes and shows the app and WebView versions beside an error. Install over your existing app, then start a fresh sign-in. If it still fails, share only the `RB-AUTH-…` error text and displayed versions. The actual cause on the maintainer’s phone remains unconfirmed. See the [transport investigation](../../docs/audits/2026-10-07-android-auth-transport.md).

See the [Android guide](../../docs/android.md), [startup investigation](../../docs/audits/2026-10-07-android-startup.md) and [complete audit](../../docs/audits/2026-10-06.md).
