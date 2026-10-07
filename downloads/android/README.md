# Download Research Bot for Android

[**Download the signed Research Bot 0.3.9 APK**](https://github.com/Srimi1/research------bot/raw/refs/heads/main/downloads/android/research-bot-0.3.9-android.apk)

Supports Android 8 or later and targets Android 16. Open the downloaded APK and choose **Install**. It uses the existing signing certificate from 0.3.1–0.3.8; install over your existing app to keep projects and notes.

## Sign-in change in 0.3.9

After browser consent, token exchange now waits until Research Bot returns to the foreground and Android allows its network. This addresses the DNS failure reproduced when the app was behind the browser. If Android leaves the browser open, switch back to Research Bot to finish connecting. Start a fresh **Continue with ChatGPT** attempt after installing.

The foreground exchange passed Android 16 checks without instrumentation after 20-second and 75-second browser waits and with Data Saver enabled. These use deliberately invalid codes and never sign in a real account. Live ChatGPT sign-in on the reporting OnePlus/Legion OS phone remains unconfirmed. See the [investigation](../../docs/audits/2026-10-07-android-background-exchange.md).

## Verify the download

[SHA256SUMS.txt](SHA256SUMS.txt) contains the APK SHA-256:

```text
4ecaac44c15ea2d500b9e2be85e971fa583b6f3ed92c8453c91f3aedff3df2ff
```

From this folder on a computer:

```sh
sha256sum -c SHA256SUMS.txt
```

Package: `com.researchbot.android`. Version: `0.3.9` / code `309`. Signing certificate SHA-256: `98580ca053712555a2b8a3a8fecfc15c85d83c5d192480e3b6b09ca13a633441`.

Built from [202b077](https://github.com/Srimi1/research------bot/commit/202b077ef54620e10211bf268277c3cf1a253afe). All six [source CI jobs](https://github.com/Srimi1/research------bot/actions/runs/37649730288) passed, including 95 unit tests, production Android/OAuth fixtures and native Android 16 checks. Android release build/lint also passed locally. Publication requires the actual signed APK to pass fresh launch/create/save/cold-restart and an upgrade from published 0.3.8 with retained notes. [BUILD_INFO.json](BUILD_INFO.json) records public metadata and results. The signing key remains private.

If it still fails, run **Account & preferences → Check connection**, then **Copy connection results**. Report the fresh fixed `RB-AUTH-…` error and that report. Callback URLs, authorization codes, tokens and account details must stay private.

See the [Android guide](../../docs/android.md).
