# Download Research Bot for Android

[**Download the signed Research Bot 0.3.3 APK**](https://github.com/Srimi1/research------bot/raw/refs/heads/main/downloads/android/research-bot-0.3.3-android.apk)

Supports Android 8 or later and targets Android 16. Open the downloaded APK on your phone, allow installation from your browser/file manager when prompted, and choose **Install**.

This APK uses the same personal signing certificate as the previously supplied 0.3.1 and 0.3.2 APKs. Install over those builds to retain your projects. If your existing app uses another signing certificate, export projects before uninstalling it. This version is installed manually.

## Verify the download

[SHA256SUMS.txt](SHA256SUMS.txt) contains the APK's SHA-256:

```text
289f00adeac6c8689e5c053c53752e13d648e249a0ef836a2ce43225308697de
```

From this folder on a computer:

```sh
sha256sum -c SHA256SUMS.txt
```

Package: `com.researchbot.android`. Version: `0.3.3` / code `303`. Signing certificate SHA-256: `98580ca053712555a2b8a3a8fecfc15c85d83c5d192480e3b6b09ca13a633441`.

Built from [b620924](https://github.com/Srimi1/research------bot/commit/b620924841b29b161c111604514f66cf9c499e51), with passing [platform CI](https://github.com/Srimi1/research------bot/actions/runs/37508336190), Android release compilation/lint and signature/alignment checks. The signing key is private and is not included in the repository. Physical-phone behavior and live ChatGPT sign-in remain unverified.

[BUILD_INFO.json](BUILD_INFO.json) records public build metadata. The release workflow can verify this APK with `node scripts/verify-release-apk.mjs` and publish it without copying the signing key to CI.

See the [Android guide](../../docs/android.md) and [audit report](../../docs/audits/2026-10-06.md).
