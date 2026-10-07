# Download Research Bot for Android

[**Download the signed Research Bot 0.3.8 APK**](https://github.com/Srimi1/research------bot/raw/refs/heads/main/downloads/android/research-bot-0.3.8-android.apk)

Supports Android 8 or later and targets Android 16. Open the downloaded APK on your phone and choose **Install**. This APK uses the existing signing certificate from 0.3.1–0.3.7; install over your existing app to keep projects and notes.

## Verify the download

[SHA256SUMS.txt](SHA256SUMS.txt) contains the APK SHA-256:

```text
df6362dad0964b43b91476123bbc781c1e655ba4dcef9883c985df0de32c46de
```

From this folder on a computer:

```sh
sha256sum -c SHA256SUMS.txt
```

Package: `com.researchbot.android`. Version: `0.3.8` / code `308`. Signing certificate SHA-256: `98580ca053712555a2b8a3a8fecfc15c85d83c5d192480e3b6b09ca13a633441`.

Built from [f741d2b](https://github.com/Srimi1/research------bot/commit/f741d2b24eb938f698b48fa925ecbdbfb5850d56). The production Android backend/OAuth fixtures, 93 unit tests and Android release build/lint pass. The [APK-only release check](https://github.com/Srimi1/research------bot/actions/runs/37633791255) passed fresh Android 16 launch/create/save/cold-restart and an upgrade from the published 0.3.7 APK retaining synthetic projects and notes. The three public release assets were downloaded with HTTP 200, verified hashes and the expected APK signature. [BUILD_INFO.json](BUILD_INFO.json) records public metadata and validation results; the signing key remains private.

## Sign-in follow-up

Version 0.3.8 fixes missing WebView timeout and secure-UUID APIs, preserves version information when optional Android queries fail, and labels saved errors **Previous sign-in attempt**. The maintainer’s latest 0.3.7 screenshot shows `RB-AUTH-EXCHANGE-DNS` with WebView `153.0.8010.36` on both Wi-Fi and mobile data. These compatibility fixes do not explain that phone’s resolver failure; use the connection check for the next diagnosis.

Start a fresh **Continue with ChatGPT** attempt after installing. If it fails, tap **Check connection** in **Account & preferences**, then **Copy connection results**. The report contains only versions, support flags and HTTP statuses/fixed error codes. The check uses public endpoints and deliberately invalid fixture credentials, never your account credentials. Share the new `RB-AUTH-…` message and the report; exclude callback URLs, codes and tokens.

See the [Android guide](../../docs/android.md), [follow-up audit](../../docs/audits/2026-10-07-android-auth-follow-up.md) and [complete audit](../../docs/audits/2026-10-06.md).
