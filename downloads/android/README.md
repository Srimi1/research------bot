# Download Research Bot for Android

[**Download the signed Research Bot 0.4.0 APK**](https://github.com/Srimi1/research------bot/releases/download/v0.4.0/research-bot-0.4.0-android.apk)

[Release 0.4.0](https://github.com/Srimi1/research------bot/releases/tag/v0.4.0) publishes Android assets only. The same verified APK is [committed in this folder](research-bot-0.4.0-android.apk). Supports Android 8 or later and targets Android 16.

**0.4.0 uses a new signing key and requires a fresh installation.** It cannot update 0.3.9 in place. Export every project and verify the saved files before removing the old app; uninstalling deletes local projects, notes and settings. Exports are JSON/Markdown archives and automatic project import is not available.

## Sign-in change in 0.4.0

A short foreground service keeps sign-in alive during browser consent. Token exchange waits for Research Bot to return to the foreground and get network access. A native service timeout aborts the pending sign-in and closes its loopback listener. If Android closes the process during consent, the next start shows `RB-AUTH-INTERRUPTED` and an **Open battery settings** action. Start a fresh **Continue with ChatGPT** attempt after installing.

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

Built from [cb069c9](https://github.com/Srimi1/research------bot/commit/cb069c9796e8ac98255e64899ed9d45b39430e4e). All six [source CI jobs](https://github.com/Srimi1/research------bot/actions/runs/37791557298) passed, including 106 unit tests, production Android/OAuth fixtures, native HTTPS, browser consent waits of 20 and 75 seconds, Data Saver and killed-attempt recovery. These native sign-in checks use the debug app with deliberately invalid credentials, never a real account.

The actual signed APK passed Android 16 fresh launch, project/notes creation and persistence across cold restart in the [Android-only release check](https://github.com/Srimi1/research------bot/actions/runs/37793673276). Local release build/lint also passed. All three public assets returned HTTP 200 and matched their checksums. The downloaded APK passed certificate, package/version, SDK, alignment and disabled-debugging verification. [BUILD_INFO.json](BUILD_INFO.json) is copied from the published metadata. The private signing key remains outside Git.

Live ChatGPT sign-in, eligibility and running an agent on the OnePlus 7T Pro / Android 16 / Legion OS phone still require a separate phone check. An in-place update from 0.3.9 is incompatible with the certificate change.

If sign-in still fails, run **Account & preferences → Check connection**, then **Copy connection results**. Report the fresh fixed `RB-AUTH-…` error and that report. Callback URLs, authorization codes, tokens and account details must stay private.

See the [Android guide](../../docs/android.md).
