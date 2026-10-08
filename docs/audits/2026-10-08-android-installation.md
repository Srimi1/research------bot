# Android 0.4.0 installation investigation — 2026-10-08

The reported phone screenshot shows Android's **App not installed** dialog for `research-bot-0.4.0-android.apk`. The earlier version was removed before this attempt. ADB also reaches the phone but installation fails; its detailed installer result is still needed to identify the cause.

## Verified release package

Downloaded the APK from the public [v0.4.0 release](https://github.com/Srimi1/research------bot/releases/tag/v0.4.0) and compared it byte-for-byte with `downloads/android/research-bot-0.4.0-android.apk`.

| Check                                    | Result                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| APK bytes                                | 4,774,667                                                               |
| SHA-256                                  | `280356ec59459cf853408f70ec0316f24c979988a2fbbba1e82e7147835ea39c`      |
| ZIP integrity                            | Passed                                                                  |
| Package                                  | `com.researchbot.android`                                               |
| Version / code                           | `0.4.0` / `400`                                                         |
| Minimum / target SDK                     | `26` / `36`                                                             |
| Signature                                | APK Signature Scheme v2 and v3 verify for SDK 26–36                     |
| Signing certificate SHA-256              | `e07d0f1bb2e400e248c1b2af756d314686d912718127aed1e65d4344ad555a35`      |
| Alignment and recorded source provenance | `scripts/verify-release-apk.mjs` passed with Android build-tools 36.0.0 |

The committed 0.3.9 APK also verifies, but uses certificate `98580ca053712555a2b8a3a8fecfc15c85d83c5d192480e3b6b09ca13a633441`. Both APKs use v2/v3 signing without v1 signing; that is supported at the minimum Android version. Adding v1 signing is not an evidence-backed fix for this report.

## Confirmed documentation defect

The Android installation guide said that the 0.4.0 download retained the old certificate and could update earlier versions, contradicting the actual signatures and the same guide's fresh-install requirement. Corrected this paragraph and added phone-only checks, Windows ADB setup and a table of installer results.

## Remaining uncertainty

These checks validate the official download, not the copy on the reporting phone or its Package Manager state. No phone or emulator is connected to the investigation workspace. The previously recorded Android 16 fresh-install and persistence results are available in the [0.4.0 release run](https://github.com/Srimi1/research------bot/actions/runs/37793673276); they do not resolve this phone's failure.

An earlier APK can remain installed in another user/profile after removal from the personal profile. A damaged local download or an installation restriction is also possible. None is confirmed without device-side information. The next diagnostic is the exact installer status, together with the phone's Android version and profile state. Do not label the phone issue fixed or publish a replacement APK based solely on these offline package checks.

## APK build follow-up

Rebuilt the production web bundle and the native 0.4.0 release with JDK 21 and Android SDK 36. The original `assembleRelease lintRelease` command succeeded without signing configuration and produced `app-release-unsigned.apk`; signature verification failed with `Missing META-INF/MANIFEST.MF`. This confirms a local build defect, rather than a defect in the correctly signed public download.

Added a Gradle preflight that requires the existing private key, verifies both passwords and the alias, and compares the certificate with the committed pin before release packaging. The release build command runs it before rebuilding web assets and verifies the finished APK. Five real-keystore cases passed: missing configuration, an incorrect private-key password, an incorrect alias and a different certificate all block packaging; a valid pinned private key permits it. The main project's release command also stops before rebuilding assets when the key is absent.

Built and linted a signed `installCheck` variant with the same application code and production bundle. It disables debugging and uses a separate package and launcher label, so it can test installation without replacing the regular app. Package/version, SDK, signature, alignment and the absence of a test-only flag passed. All 106 existing unit tests passed. Added CI checks for the exact test artifact on API 26 and 36, with startup and saved-note recovery on API 36; their results must be recorded before declaring runtime validation complete.

The current workspace has no release keystore binding. A regular update still requires the existing 0.4.0 key. The test build uses the standard development signing configuration and cannot update the regular application.
