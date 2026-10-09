# Download Research Bot for Android

[**Download the signed Research Bot 0.4.2 production APK**](research-bot-0.4.2-android.apk)

This production APK is attached to the 0.4.2 GitHub release draft and committed in this folder. It appears as **Research Bot 0.4.2**, uses package `com.researchbot.android.fresh`, supports Android 8 or later and targets Android 16.

It installs alongside the existing Research Bot app and uses separate local storage. Existing projects and credentials stay in the existing app; keep that app installed. The fresh app does not update the legacy package or import old projects automatically. See the [fresh-install guide](../../docs/android-fresh-install.md).

## Verify this APK

[SHA256SUMS.txt](SHA256SUMS.txt) contains its SHA-256:

```text
fb4392f3ef8dfdb70bc42303ce1f6d188e69bc4d97e664bb15d1cb123383379b
```

From this folder on a computer:

```sh
sha256sum -c SHA256SUMS.txt
```

Version: `0.4.2` / code `402`. Production certificate SHA-256: `897e7d7148089060b15c400829333580ca9a023d19195038747a1066ba843274`. Built from [46aa02e](https://github.com/Srimi1/research------bot/commit/46aa02e5aee895bdc7e331fd4a8cc5e634f7ebbb).

The release build and Android lint passed. The actual APK passed signature, package, version, SDK, alignment, disabled-debugging and source-provenance checks; every bundled JS, CSS and WASM asset matches the production web build. The exact signed APK passed Android 16 project/note creation and cold-restart recovery; the existing 0.4.0 app retained its saved project and notes after installing and testing it. [BUILD_INFO.json](BUILD_INFO.json) records the passed [installation and upload workflow](https://github.com/Srimi1/research------bot/actions/runs/37957568655). The uploaded production files were downloaded again and matched all release checksums. The private production signing key is backed up outside Git.

## Published legacy release

[**Download the published Research Bot 0.4.0 APK**](https://github.com/Srimi1/research------bot/releases/download/v0.4.0/research-bot-0.4.0-android.apk)

The original package `com.researchbot.android` and signing certificate `e07d0f1bb2e400e248c1b2af756d314686d912718127aed1e65d4344ad555a35` remain unchanged. Its APK SHA-256 is `280356ec59459cf853408f70ec0316f24c979988a2fbbba1e82e7147835ea39c`. [Release 0.4.0](https://github.com/Srimi1/research------bot/releases/tag/v0.4.0) retains the APK, metadata and checksums.

The legacy signing backup is unavailable, so the 0.4.2 production APK has an independent app identity and certificate. It cannot serve as an in-place update of 0.4.0. Desktop 0.4.1 is published separately as a stable release.

Live ChatGPT sign-in and inference, account eligibility and behavior on the physical OnePlus 7T Pro / Legion OS remain unverified. See the [release audit](../../docs/audits/2026-10-09-releases-and-apks.md) and [Android guide](../../docs/android.md).
