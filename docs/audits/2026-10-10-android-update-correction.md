# Android update correction — 2026-10-10

The 0.4.2 APK installed a separate application and did not satisfy the requirement to update the existing Research Bot app. Its successful startup and coexistence checks were not in-place upgrade evidence. The release is now withdrawn to draft, 0.4.1 is restored as GitHub Latest, and the separate-app APK is removed from active repository downloads. The private draft retains historical artifacts.

## Cause and signing identity

The published original 0.4.0 APK uses package `com.researchbot.android`, version code `400`, certificate `e07d0f1bb2e400e248c1b2af756d314686d912718127aed1e65d4344ad555a35`, and APK SHA-256 `280356ec59459cf853408f70ec0316f24c979988a2fbbba1e82e7147835ea39c`.

The withdrawn 0.4.2 APK uses `com.researchbot.android.fresh`, version code `402`, certificate `897e7d7148089060b15c400829333580ca9a023d19195038747a1066ba843274`, and APK SHA-256 `fb4392f3ef8dfdb70bc42303ce1f6d188e69bc4d97e664bb15d1cb123383379b`. The different package causes a separate installation; its different private key also cannot sign an update accepted by the original app. Changing only its package name would result in a signing conflict.

Versions 0.3.1–0.3.9 used certificate `98580ca053712555a2b8a3a8fecfc15c85d83c5d192480e3b6b09ca13a633441`. The supplied launcher screenshot establishes duplicate icons but does not identify either installed version or certificate. A compatible update must use the certificate of the user's original installation. No phone is attached to this environment, so this correction cannot inspect or modify installed apps or their data remotely.

The [current original-key verification](https://github.com/Srimi1/research------bot/actions/runs/38051207293) failed during restoration: `ANDROID_KEYSTORE_BASE64 contains no recoverable base64 keystore. Restore the existing key backup.` The decoder now also accepts literal YAML, PowerShell, Python-byte and JSON-fence wrappers while preserving the exact decoded bytes. The earlier path/command classifier was too broad; this recheck does not establish that the secret is a path or command. A filename search including hidden/ignored files in the accessible workspace, temporary, home and optional-package directories found only the independent fresh-app keystore, not the original key. No private signing material was printed or committed.

**Blocker:** no compatible production APK has been built, signed or released. The original keystore and its passwords are required; a certificate fingerprint, signed APK or replacement key cannot recover that private key. No uninstall, data deletion or signature bypass is proposed.

## Source and release safeguards

Corrected source is version 0.4.3, higher than the already distributed 0.4.2. The production Capacitor/Gradle identity is always `com.researchbot.android`; the original certificate pin remains unchanged. The separate production build command is removed, its old environment flag is rejected, and prebuilt publication and build recording require the original production identity. The earlier one-off publication jobs that could re-publish the withdrawn APK are removed.

Android now exposes its actual installed package and public signing certificate through the native bridge. Update discovery searches the published release list independently of desktop Latest and only selects a newer stable Android release whose build metadata matches the installed package/certificate and supported SDK. Build information and published checksums must agree, and the existing native verifier still checks the actual APK hash, package, increasing version and installed certificate before installation.

**Account & preferences → Check for updates** works with automatic checks off. It presents an explicit **Install update** button after a verified download, reports errors visibly, shares concurrent downloads, and retains a ready update across installer-permission changes. Checks never open the installer themselves.

The Android publication workflow now always requires a previous published APK, defaulting to 0.4.0. On an isolated emulator it saves a project and notes in that APK, installs the new APK over it with `adb install -r`, and verifies the notes after the upgrade and another cold restart. This path contains no intervening uninstall. Assets are uploaded only after that test passes. No such production-key upgrade has been performed for 0.4.3.

The original 0.4.0 download, bytes, metadata and checksum are restored unchanged. The withdrawn APK and independent key remain backed up for historical audit; keeping those files does not make them a compatible update.

## Validation and limits

- All 118 unit/regression tests passed, including release selection, incompatible package/key rejection, checksum/version failures, concurrent downloads and installer-permission/cache retries.
- TypeScript checking and the production Android web/Capacitor build passed.
- The shipped Android bundle's manual update controls passed with synthetic native services: automatic checks off, no compatible release, a separate package, a different certificate, GitHub HTTP failure, mismatched checksums, native APK rejection, an explicit installation action and permission retry. Saved project notes remained intact. This test does not perform a real Android APK upgrade.
- Real temporary-keystore fixture tests passed: malformed backup, missing signing fields, wrong alias/password, a replacement certificate and the former separate production flag cannot package a release; the matching pinned private key can.
- Native debug APK and instrumentation-test compilation plus Android lint passed. The built debug APK was verified as `com.researchbot.android`, version `0.4.3` / code `403`, SDK 26–36 and 16 KiB aligned. Its development certificate differs from the original release certificate; it is not offered as an update.
- ESLint, formatting, build-toolchain compatibility, packaged SQLite/CSP persistence and the npm dependency audit passed. The dependency audit reported zero vulnerabilities. Workflow YAML parsed successfully.
- The complete UI regression suite passed: desktop/phone layouts, save/review/export flows, literature evidence, sign-in entry points, packaged SQLite, Android OAuth with current and legacy WebView capabilities, and the manual update flow. Network/native services in these browser tests are synthetic. No production-signature upgrade or physical-phone test has passed for 0.4.3.

The source correction and draft PR do not modify an already installed APK. The signing blocker remains, physical-device installation remains unverified, and duplicate apps on the user's phone remain outside this environment's control.
