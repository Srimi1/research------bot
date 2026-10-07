# Download Research Bot for Android

[**Download the signed Research Bot 0.3.5 APK**](https://github.com/Srimi1/research------bot/raw/refs/heads/main/downloads/android/research-bot-0.3.5-android.apk)

Supports Android 8 or later and targets Android 16. Open the downloaded APK on your phone, allow installation from your browser/file manager when prompted, and choose **Install**.

This APK uses the same personal signing certificate as the previously supplied 0.3.1, 0.3.2 and released 0.3.3 and 0.3.4 APKs. Install over those builds to retain your projects. If your existing app uses another signing certificate, export projects before uninstalling it. This version is installed manually.

## Verify the download

[SHA256SUMS.txt](SHA256SUMS.txt) contains the APK's SHA-256:

```text
d3b1e346aa06abf04699cac35bfef84844c3c3e9739c7f66e3ed5b4bcb2aecdd
```

From this folder on a computer:

```sh
sha256sum -c SHA256SUMS.txt
```

Package: `com.researchbot.android`. Version: `0.3.5` / code `305`. Signing certificate SHA-256: `98580ca053712555a2b8a3a8fecfc15c85d83c5d192480e3b6b09ca13a633441`.

Built from [1a462cd](https://github.com/Srimi1/research------bot/commit/1a462cd42ee703227d1f930c9ad4d54a7317b918), with passing regression tests, production Android SQLite/CSP checks, Android release compilation/lint and signature/alignment checks. The release workflow verifies the actual signed APK on Android 16 before publication. The signing key is private and is not included in the repository. Physical-phone behavior and live ChatGPT sign-in remain unverified.

[BUILD_INFO.json](BUILD_INFO.json) records public build metadata. The release workflow can verify this APK with `node scripts/verify-release-apk.mjs` and publish it without copying the signing key to CI.

See the [Android guide](../../docs/android.md), [startup investigation](../../docs/audits/2026-10-07-android-startup.md) and [complete audit](../../docs/audits/2026-10-06.md).

Version 0.3.5 fixes the callback response race that could display “This sign-in is no longer active.” Start a new sign-in from the app after installing; do not reuse the previous localhost callback. See the [sign-in investigation and Mac release review](../../docs/audits/2026-10-07-signin-and-macos.md).
