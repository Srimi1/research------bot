# Download Research Bot for Android

[**Signed Research Bot 0.4.0 APK in this repository**](research-bot-0.4.0-android.apk)

The public 0.4.0 release is being prepared. Publication requires a green source check and Android 16 tests of this exact signed APK. [Published 0.3.9](https://github.com/Srimi1/research------bot/releases/tag/v0.3.9) remains available with its own checksums.

Supports Android 8 or later and targets Android 16. **0.4.0 uses a new signing key and requires a fresh installation.** It cannot update 0.3.9 in place. Export every project and verify the saved files before removing the old app; uninstalling deletes local projects, notes and settings. Exports are JSON/Markdown archives and automatic project import is not available.

## Sign-in change in 0.4.0

A short foreground service keeps sign-in alive during browser consent. Token exchange waits for Research Bot to return to the foreground and get network access. A native service timeout now aborts the pending sign-in and closes its loopback listener. If Android closes the process during consent, the next start shows `RB-AUTH-INTERRUPTED` and an **Open battery settings** action. Start a fresh **Continue with ChatGPT** attempt after installing.

Live ChatGPT sign-in and inference on the OnePlus 7T Pro / Android 16 / Legion OS phone remain unconfirmed. Native transport checks use public metadata and deliberately invalid credentials, never a real account. See the [investigation](../../docs/audits/2026-10-07-android-background-exchange.md).

## Verify the download

[SHA256SUMS.txt](SHA256SUMS.txt) contains the APK SHA-256:

```text
280356ec59459cf853408f70ec0316f24c979988a2fbbba1e82e7147835ea39c
```

From this folder on a computer:

```sh
sha256sum -c SHA256SUMS.txt
```

Package: `com.researchbot.android`. Version: `0.4.0` / code `400`. Signing certificate SHA-256: `e07d0f1bb2e400e248c1b2af756d314686d912718127aed1e65d4344ad555a35`.

Built from [cb069c9](https://github.com/Srimi1/research------bot/commit/cb069c9796e8ac98255e64899ed9d45b39430e4e). Local dependency installation, lint, format check, typecheck and all 106 tests passed. The signed Android release build/lint, certificate, package/version, SDK, alignment and disabled-debugging checks passed. Signed-APK startup and persistence validation is pending the release workflow. [BUILD_INFO.json](BUILD_INFO.json) records the public metadata; the private signing key stays outside Git.

If sign-in still fails, run **Account & preferences → Check connection**, then **Copy connection results**. Report the fresh fixed `RB-AUTH-…` error and that report. Callback URLs, authorization codes, tokens and account details must stay private.

See the [Android guide](../../docs/android.md).
