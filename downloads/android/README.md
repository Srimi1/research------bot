# Download Research Bot for Android

[**Download the signed Research Bot 0.3.6 APK**](https://github.com/Srimi1/research------bot/raw/refs/heads/main/downloads/android/research-bot-0.3.6-android.apk)

Supports Android 8 or later and targets Android 16. Open the downloaded APK on your phone, allow installation from your browser/file manager when prompted, and choose **Install**.

This APK uses the same personal signing certificate as versions 0.3.1 through 0.3.5. Install over your existing build to retain projects. If your existing app uses another signing certificate, export projects before uninstalling it. This version is installed manually.

## Verify the download

[SHA256SUMS.txt](SHA256SUMS.txt) contains the APK's SHA-256:

```text
ebe0e194088890e2a686a6b34e0e9abe0d2e5efd895d504c551107769bcf1cd5
```

From this folder on a computer:

```sh
sha256sum -c SHA256SUMS.txt
```

Package: `com.researchbot.android`. Version: `0.3.6` / code `306`. Signing certificate SHA-256: `98580ca053712555a2b8a3a8fecfc15c85d83c5d192480e3b6b09ca13a633441`.

Built from [21c2bc2](https://github.com/Srimi1/research------bot/commit/21c2bc27cad9483bc8ce231f0074c9b78c41eeb8), with passing regression tests, production Android SQLite/CSP and synthetic OAuth checks, Android release compilation/lint, and signature/alignment checks. [The release workflow](https://github.com/Srimi1/research------bot/actions/runs/37616964369) passed native launch, project creation, note saving and cold-restart checks for this actual signed APK on Android 16 before publication. The public release download was then verified against the SHA-256 above. The signing key is private and is not included in the repository. Physical-phone behavior and live ChatGPT sign-in remain unverified.

[BUILD_INFO.json](BUILD_INFO.json) records public build metadata. The release workflow can verify this APK with `node scripts/verify-release-apk.mjs` and publish it without copying the signing key to CI.

Version 0.3.6 shows a safe sign-in reason near the sign-in button and on the callback page, retains that notice after restarting, and reuses an issued registration on retry. Install over your existing app, then start a new sign-in. If it still fails, share only the `RB-AUTH-…` error text. See the [sign-in failure investigation](../../docs/audits/2026-10-07-signin-diagnostics.md).

See the [Android guide](../../docs/android.md), [startup investigation](../../docs/audits/2026-10-07-android-startup.md) and [complete audit](../../docs/audits/2026-10-06.md).
