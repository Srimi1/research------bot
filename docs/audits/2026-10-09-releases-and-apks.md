# Release and APK audit — 2026-10-09

## Release decisions

- **0.4.0:** retain the published, verified Android release and its original assets.
- **0.4.1:** publish the verified Windows, Linux and both Mac installers as a stable desktop release. A regular Android 0.4.1 APK is unavailable.
- **0.4.2:** upload a signed fresh-install production APK, its build information, checksums and this audit to the existing draft. Its independent package preserves the regular app and its data. An in-place upgrade of the regular Android app remains unavailable.

The repository versions are **0.4.0** and **0.4.1**, rather than 4.0 and 4.1. GitHub can designate only one release as Latest; the published 0.4.1 desktop release takes that designation.

## Confirmed release blockers and workflow issues

### The existing Android release key cannot be restored

The [original Android release job](https://github.com/Srimi1/research------bot/actions/runs/37906653263) failed before building because `ANDROID_KEYSTORE_BASE64` was not base64 text. The environment has no release keystore binding, and its GitHub integration returns HTTP 403 for the repository Actions secrets endpoint.

Added a bounded restoration helper that accepts surrounding quotes, a byte-order mark, whitespace, escaped line breaks, a base64 data URI, URL-safe base64, assignment/code-fence wrappers and JSON values. It preserves the exact decoded bytes, rejects invalid and non-keystore content, writes temporary files with mode 0600, and retains the existing private-key/password/alias and pinned-certificate checks. Synthetic real-keystore tests passed for wrapper recovery, invalid input, absent configuration, incorrect private-key password, incorrect alias, a different certificate and a valid pinned private key. The fresh production profile also rejects a key that does not match its independent certificate, without altering the legacy pin.

The [independent verification using that helper](https://github.com/Srimi1/research------bot/actions/runs/37952072104) also failed during restore. The [expanded wrapper check](https://github.com/Srimi1/research------bot/actions/runs/37954927011) classified the configured secret as a path or command, rather than keystore bytes. No matching backup exists in the accessible workspace. No 0.4.1 or 0.4.2 APK was built with the original key. A certificate fingerprint and a previously signed APK cannot replace its private key. The pinned 0.4.0 certificate remains `e07d0f1bb2e400e248c1b2af756d314686d912718127aed1e65d4344ad555a35`.

The fresh 0.4.2 production distribution uses a separate application identity and independent production key. This avoids uninstalling or overwriting the existing regular app. It starts with its own storage and does not import old projects. The production keystore and credentials are backed up outside Git in the managed workspace; only its public certificate fingerprint is committed.

### A release draft needs an explicit publication control

The main release workflow previously published successful manual runs automatically, so it could not retain a completed draft. The proposed workflow adds a `publish` boolean and a `desktop` platform choice. With `publish=false`, uploads finish while the release stays draft. Desktop-only publication checks the selected desktop jobs and does not require Android signing. Android publication still requires its signed APK checks.

### Desktop and Android availability differ

`src/android/releases.ts` reads GitHub's single Latest release and requires both a regular versioned APK and `SHA256SUMS-android.txt`. A desktop-only Latest release offers no Android update. The 0.4.1 release notes therefore link Android users directly to the verified 0.4.0 APK. The fresh production APK remains draft and is a separate package; native package and certificate checks reject it as a legacy update. The older diagnostic APK is explicitly labeled and uses a different filename/checksum file.

Future improvement: select the newest published release containing compatible Android assets independently of the desktop Latest designation, retaining the native package, version, checksum and certificate checks.

## Artifact verification

### Published Android 0.4.0

Downloaded all three public assets and verified every entry in `SHA256SUMS-android.txt`. Verified APK v2/v3 signatures, the pinned certificate, package `com.researchbot.android`, version `0.4.0` / code `400`, minimum SDK 26, target SDK 36 and 16 KiB ZIP alignment.

APK SHA-256: `280356ec59459cf853408f70ec0316f24c979988a2fbbba1e82e7147835ea39c`.

The published build information records the prior Android 16 signed-APK startup/persistence check. This audit did not repeat that emulator run. The signing-key change from 0.3.9 remains documented in the release notes.

### Desktop 0.4.1

Downloaded every attached asset and verified all entries in the four platform checksum files. Verified `latest.yml` and `latest-linux.yml` version 0.4.1, filenames, sizes and SHA-512 hashes against the actual installers.

The [desktop release workflow](https://github.com/Srimi1/research------bot/actions/runs/37808279220) completed all four platform builds, including installed-DMG checks on both Mac architectures. This audit checked that evidence and the uploaded bytes; it did not rerun Windows or Mac installations. Mac installers retain their existing ad hoc signing and manual-update behavior.

Source: `3fd315152dab9f09d3849e51ac043e0df3b9a235`.

### Draft Android 0.4.2 fresh production APK

Built and signed `research-bot-0.4.2-android.apk` as a production release, with Android lint passing. Verified the pinned independent production certificate, package `com.researchbot.android.fresh`, label **Research Bot 0.4.2**, version `0.4.2` / code `402`, minimum SDK 26, target SDK 36, disabled debugging, absence of the test-only installation flag and 16 KiB ZIP alignment. All packaged JS, CSS and WASM assets match the local production build; the packaged Capacitor configuration disables WebView debugging and mixed content.

APK SHA-256: `fb4392f3ef8dfdb70bc42303ce1f6d188e69bc4d97e664bb15d1cb123383379b`. Size: 4,779,423 bytes. Production certificate: `897e7d7148089060b15c400829333580ca9a023d19195038747a1066ba843274`. Source: `46aa02e5aee895bdc7e331fd4a8cc5e634f7ebbb`.

The committed APK verification checks its bytes against build information and checksums, confirms that the build commit is an ancestor of the release checkout, and rejects changed application inputs. The Android 16 release workflow installs and tests this exact signed artifact, creates and recovers projects/notes, and checks that a previously installed 0.4.0 project's notes survive. Successful runtime evidence is appended to the uploaded audit and recorded in the uploaded build information before assets are attached to the draft.

### Draft Android 0.4.2 test APK

Downloaded the exact `research-bot-install-check` artifact from the [passed installation run](https://github.com/Srimi1/research------bot/actions/runs/37905089245). Verified its signature, package `com.researchbot.android.installcheck`, version `0.4.2` / code `402`, minimum SDK 26, target SDK 36, disabled debugging, absence of the test-only installation flag and 16 KiB ZIP alignment.

APK SHA-256: `96bd20425524b7a800fa222853e72733d03330d4fdb63a396fb1561911be8ee1`. Size: 4,775,331 bytes. Test certificate: `ff52b820330c21e350506deb64016b8d9b697f29065542bbfa4e714e7e960576`.

Both original Package Manager reports identify this exact APK hash and certificate and confirm fresh installation and coexistence with the regular package on Android 8 and 16. The same run passed project/note persistence after a cold restart on Android 16. The application inputs at its source head `b73651c1ccf09a5e0c6cb35835bcded10bb3f781` match merged main `4b7b48dcf6d0d21e2847e839b5a21ac4bfb5a7c5`; every packaged JS, CSS and WASM asset matches this audit's local production bundle byte for byte. The packaged Capacitor configuration disables WebView debugging and mixed content.

This APK appears as **Research Bot APK Test** and uses separate local storage. It cannot replace or update the regular Research Bot app. No release-key change or regular-app uninstall is required to install it.

## Source and dependency review

Reviewed selected trust boundaries at main `4b7b48d`: Electron window/IPC isolation; validated core API inputs; OAuth metadata, PKCE, state, nonce, issuer/audience/signature verification; Android HTTPS, credential encryption, private files and package installation; bounded Crossref requests; and literature-review output validation/rendering. The Android installer checks download hosts, checksum, package, increasing version and the installed certificate. Literature output is schema checked and rendered as React text; cited quotes must match selected evidence. Project exports do not include credentials.

Validation performed locally:

- 113 unit/regression tests passed, with no failures or skips.
- ESLint, Prettier and the TypeScript/Vite/Electron production build passed.
- `npm audit --json` reported zero known vulnerabilities across the locked dependency tree, including development dependencies.
- The signing restoration and real-keystore packaging safeguards passed their fixture tests.

This is a direct, scoped source/dependency/artifact audit. The installed security skill's shared scan references and report-generation scripts were unavailable, so no host-backed Codex Security scan or exhaustive vulnerability report is claimed. Live ChatGPT authorization/inference and installation on the physical OnePlus 7T Pro / Legion OS remain unverified. The test APK's stock-emulator results do not establish those behaviors.

## Fresh production APK runtime verification

The exact signed 0.4.2 APK passed Android 16 installation, SQLite startup, project/note creation and cold-restart recovery. The regular 0.4.0 app and its saved project/notes remained available after installing and testing the fresh production app. Workflow: https://github.com/Srimi1/research------bot/actions/runs/37957568655.
