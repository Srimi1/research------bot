# Android downloads

The published Android build for the original app is [Research Bot 0.4.0](research-bot-0.4.0-android.apk). Its [GitHub release](https://github.com/Srimi1/research------bot/releases/tag/v0.4.0) retains the APK, build information and checksums. It uses package `com.researchbot.android`, version code `400`, Android 8 or later, and certificate `e07d0f1bb2e400e248c1b2af756d314686d912718127aed1e65d4344ad555a35`.

**The 0.4.2 APK was withdrawn.** It used `com.researchbot.android.fresh`, installed a second app, and cannot update the original app. It is no longer a public or Latest release and has been removed from this download folder. Keep the original app and its data. This correction cannot remove an app already installed on a disconnected phone.

The corrected 0.4.3 source restores the original app identity and adds **Account & preferences → Check for updates**, followed by **Install update** for a compatible verified APK. No compatible 0.4.3 production APK has been built or released: the original signing key is unavailable. The [signing check](https://github.com/Srimi1/research------bot/actions/runs/38051207293) found no recoverable keystore in the configured secret. A backup of the original keystore and its passwords is required to finish an in-place update.

The retained 0.4.0 APK SHA-256 is `280356ec59459cf853408f70ec0316f24c979988a2fbbba1e82e7147835ea39c`. Compare it with [SHA256SUMS.txt](SHA256SUMS.txt); [BUILD_INFO.json](BUILD_INFO.json) describes the actual original bytes. This older APK cannot update 0.3.x because those versions used a different signing key. Do not uninstall an existing app or clear its storage to bypass an update failure.

See the [correction audit](../../docs/audits/2026-10-10-android-update-correction.md) and [Android signing guide](../../docs/android.md).
