# Android app

The Android app is the same Research Bot as the desktop app: the same interface, the same four agents, the same SQLite project store, the same ChatGPT sign-in, the same Crossref search and export. It needs Android 8.0 or later and was built for Android 16 (target SDK 36).

## Install

1. Download the [signed Research Bot 0.3.8 APK](https://github.com/Srimi1/research------bot/raw/refs/heads/main/downloads/android/research-bot-0.3.8-android.apk). It is stored in the repository's [downloads/android folder](../downloads/android/README.md).
2. Open the downloaded file. Android asks to allow installs from your browser or file manager the first time; allow it, then choose **Install**.
3. Open **Research Bot**. Your projects are stored only on this phone.

To check this download, compare its SHA-256 with [downloads/android/SHA256SUMS.txt](../downloads/android/SHA256SUMS.txt). This APK uses the same personal certificate as the previously supplied 0.3.1, 0.3.2 and released 0.3.3 APKs, so it can update those installations. Install this version manually; automatic updates require an APK and checksums attached to a newer published GitHub release.

## Sign in with ChatGPT

In **Account & preferences**, choose **Continue with ChatGPT**. The sign-in page opens in your browser (a Custom Tab). After you approve, the browser returns to a page on `127.0.0.1` that the app is listening on, then you switch back to Research Bot. This is the same loopback sign-in the desktop app uses (RFC 8252). Stay on the sign-in page until it says ChatGPT is connected; it times out after five minutes.

Credentials are encrypted with a key held in the Android Keystore. The key cannot be exported, so app data is excluded from Android backups and device transfers. Use **Export** to keep a copy of your projects.

## Updates

With **Check for updates automatically** on, the app checks GitHub Releases about 15 seconds after it opens and every six hours. A newer APK downloads in the background and is only offered when all of these hold:

- its SHA-256 matches `SHA256SUMS-android.txt` in the same release,
- it is the Research Bot package and a higher version than the installed one,
- it is signed with the same certificate as the installed app.

The app then asks before opening Android's installer. The first time, Android asks you to allow Research Bot to install apps; allow it, then choose **Install** again.

## How it works

```mermaid
flowchart LR
  UI[Interface: src/App.tsx] --> API[src/android/api.ts]
  API --> Core[core/: store, auth, runner, evidence, validation]
  Core --> SQL[SQLite in WebAssembly, saved to app-private storage]
  Core --> Native[ResearchNativePlugin.java]
  Native --> Net[HTTPS with streamed bodies]
  Native --> Loop[127.0.0.1 sign-in callback]
  Native --> Keys[Android Keystore]
  Native --> Files[Export, APK install]
```

The backend in `core/` is shared with the desktop app, which supplies Node adapters from `electron/`. On Android it runs in the WebView with these adapters:

- **Network:** the WebView's own `fetch` cannot reach the ChatGPT endpoints (CORS), so requests go through the native plugin, which streams response bodies back chunk by chunk. Only HTTPS is allowed, and redirects are refused wherever the desktop refuses them.
- **Storage:** projects live in SQLite (sql.js). The file is written atomically to app-private storage one second after the last change and immediately when the app goes to the background. Writes are batched because each one saves the whole file; a failed write is kept and retried.
- **Back gesture:** closes the open dialog or project drawer first, then leaves the app.

## Build it yourself

You need Node.js 24, JDK 21 and the Android SDK (platform 36). Then:

```sh
npm ci
npm run build:android                       # web bundle + Capacitor sync
cd android && ./gradlew assembleDebug       # android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is available at `android/app/build/outputs/apk/debug/app-debug.apk` and as `research-bot-android-debug` in successful CI runs. Debug, personal and official release signing certificates may differ. Android cannot install an APK over an existing app with a different certificate. Export projects before uninstalling; prefer an APK signed with the same key.

`npm run icon:android` regenerates the launcher icons from `public/app-icon.png`.

### Verify the packaged app

Start an Android emulator and run from the repository root:

```sh
python3 -m venv .venv-android-qa
.venv-android-qa/bin/pip install uiautomator2==3.7.0
RESEARCH_UIAUTOMATOR_PYTHON=.venv-android-qa/bin/python \
  node scripts/android-startup-smoke.mjs android/app/build/outputs/apk/debug/app-debug.apk
```

Use a fresh emulator without Research Bot data; the test creates synthetic projects. Set `ANDROID_SERIAL` when multiple devices are connected. The driver uses an active Android accessibility connection and UI-tree-derived taps. It creates a project through the form's keyboard navigation and verifies it after a cold reopen, adds notes, then cold-restarts again and verifies persistence. This avoids relying on stale within-page snapshots from the emulator's WebView 133. Evidence is written to `android-startup-results/`.

CI runs the same flow on Android 16. The release workflow additionally tests the exact signed APK before publication, while the **Android APK startup** workflow can test a published APK or the signed APK committed on the selected ref.

## Release signing (one-time setup)

Every Android release must be signed with the same key, or installed copies cannot update. The release workflow reads the key from four repository secrets and refuses a key whose certificate differs from `android/release-signing-certificate.sha256`. Keys and passwords stay out of Git.

Version 0.4.0 uses a new release key because the key behind 0.3.x was not kept. Installations of 0.3.x must export their projects, uninstall and install 0.4.0 once; later versions update in place.

To create the key once, on a Mac (it needs `keytool`, which comes with Java or Android Studio):

```sh
cd ~/Documents
KEYTOOL="/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool"
[ -x "$KEYTOOL" ] || KEYTOOL=keytool
PASS="$(openssl rand -base64 24 | tr -d '/+=')"
"$KEYTOOL" -genkeypair -keystore research-bot-release.jks -storetype PKCS12 -alias research-bot \
  -keyalg RSA -keysize 4096 -validity 10000 -storepass "$PASS" -keypass "$PASS" -dname "CN=Research Bot"
echo "ANDROID_KEY_ALIAS:         research-bot"
echo "ANDROID_KEYSTORE_PASSWORD: $PASS"
echo "ANDROID_KEY_PASSWORD:      $PASS"
echo "Certificate SHA-256:       $("$KEYTOOL" -list -v -keystore research-bot-release.jks -storepass "$PASS" | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' | tr -d ':' | tr 'A-F' 'a-f')"
base64 -i research-bot-release.jks | tr -d '\n' | pbcopy && echo "ANDROID_KEYSTORE_BASE64 is on the clipboard."
```

1. Keep `~/Documents/research-bot-release.jks` and the printed password in a password manager or another safe place. Losing them means every user must uninstall and reinstall again.
2. In **Settings → Secrets and variables → Actions → Repository secrets**, add `ANDROID_KEYSTORE_BASE64` (paste the clipboard), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` from the output.
3. Commit the printed certificate SHA-256 (lowercase, no colons) to `android/release-signing-certificate.sha256`. It is public and lets the release reject any other key.
4. Run **Publish release** with **Android source: build**. The **android** job checks the key, builds, lints, verifies the signature, tests the signed APK on Android 16 and attaches the APK and `SHA256SUMS-android.txt`. Leave **Android upgrade from** empty for 0.4.0, since 0.3.x was signed by the old key.

### Release an existing signed APK

For a locally built and validated APK, run **Publish release** with **Android source: prebuilt**. Commit `downloads/android/research-bot-VERSION-android.apk`, `SHA256SUMS.txt` and `BUILD_INFO.json` first. The build information records the version, package, SDK levels, byte count, SHA-256, public certificate fingerprint and full build commit.

The workflow verifies the hash, certificate, package/version, SDK levels and 16 KiB alignment. It also requires the recorded build commit to be an ancestor of the release and all Android app/build inputs to be unchanged. If app inputs changed, rebuild and validate the APK before updating its build information. This path uses the existing signature without uploading the private key; it attaches `BUILD_INFO-android.json` as well as the APK and checksums. Choose **Platforms: android** to publish only the APK, or **all** to include desktop installers. The draft is published only after every selected upload and the signed APK runtime check succeeds. Optionally set **Android upgrade from** to a previous published tag, such as `v0.3.7`, to test an in-place signed upgrade with project and note recovery.

## Android 16 and the OnePlus 7T Pro

The app targets SDK 36 and supports this Android version. It bundles the interface, native adapters and SQLite, not a local AI model. The maintainer's OnePlus 7T Pro with 12 GB RAM and 256 GB storage has ample capacity for the workspace. Legion OS-specific keyboard, browser callback, background saving and installer behavior still require physical-device validation; browser phone previews do not establish custom-ROM compatibility.

## Known limits

- Live ChatGPT sign-in and inference have the same open validation item as on desktop: they have been tested against mocked OpenAI responses, not yet with a real account.
- The app is distributed outside Google Play, so Play Protect may show a warning the first time.
- Only one copy of the app runs at a time on a phone, so credentials cannot be refreshed twice at once.

## If the app closes at launch

Install the current APK over your existing copy first; do not clear app data or uninstall it while diagnosing startup. Version 0.3.4 fixes SQLite's blocked WebAssembly initialization and corrects the splash-screen handoff. Its actual signed APK is tested on stock Android 16 before release; this does not establish behavior on every custom ROM.

Check that your ROM has an enabled, current Android System WebView provider. If the app still closes, connect the phone to a computer with Android Platform Tools and USB debugging enabled, then capture the Android crash buffer:

```sh
adb logcat -c
# Open Research Bot on the phone and let it close.
adb logcat -b crash -d > research-bot-crash.txt
```

Share the Research Bot exception and `Caused by` lines with the maintainer. Those identify the native failure; a build or browser preview cannot supply the physical phone's crash log. See the [startup investigation](audits/2026-10-07-android-startup.md).

## Sign-in says it is no longer active

Install version 0.3.6 or later over your existing app, then start a fresh sign-in from Research Bot. Versions 0.3.5 and later wait for the native callback response before closing the server, fixing a race that could replace a completed reply with “This sign-in is no longer active.” Do not reuse the old localhost callback URL; authorization codes are one-use. Stay in the browser until consent finishes, and switch back to Research Bot if Android does not return automatically. Cancelling, closing the account dialog or taking longer than five minutes still ends an attempt. Live account eligibility and inference remain unverified. See the [callback investigation](audits/2026-10-07-signin-and-macos.md).

For the later message “ChatGPT sign-in did not complete,” use version 0.3.6 or later. It displays a safe reason and `RB-AUTH-…` code near the sign-in button and on the callback page, keeps the notice after restarting, and reuses an issued registration on retry. Share only that error text if sign-in still fails. Do not share the localhost address, authorization codes or tokens. A browser page alone from an older build does not distinguish a rejected exchange, network failure, invalid identity or credential-storage problem. See the [failure investigation](audits/2026-10-07-signin-diagnostics.md).

## Token request reports a network error

Version 0.3.7 fixes a reproduced compatibility bug: older WebView providers without `AbortSignal.any` could fail before sending any token request and display `RB-AUTH-EXCHANGE-NETWORK`. The new build supports that missing API, preserves safe Android DNS/TLS/timeout/connection reasons, and shows the app and WebView versions beside a sign-in failure. This does not establish the cause of a particular phone's failure. Keep Android System WebView current, install over the existing app and begin a fresh sign-in. Report only the error text and displayed versions if it fails. See the [transport investigation](audits/2026-10-07-android-auth-transport.md).

### DNS error during sign-in, but Check connection works (fixed in 0.3.9)

If sign-in shows `RB-AUTH-EXCHANGE-DNS` while **Check connection** reports HTTP results, install 0.3.9 or later over the existing app. Older versions exchanged the authorization code while the browser was still in front. Android blocks networking for background apps, so that lookup failed on every network. In 0.3.9 the browser shows "Authorization received". Research Bot then returns to the front and finishes connecting there. If Android leaves you in the browser, switch back to Research Bot yourself within five minutes. See the [investigation](audits/2026-10-07-android-background-exchange.md).

### Connection check in Android 0.3.8

In **Account & preferences**, tap **Check connection** after a failed attempt. The optional check makes four bounded HTTPS requests: a direct native metadata request, metadata and signing-key requests through the app adapter, and a token POST containing a deliberately invalid fixture code/client. It does not use your account credentials. An HTTP 400 or 403 result on the dummy token request proves that request reached a responding server; it does not establish live sign-in or eligibility.

**Copy connection results** copies only fixed service labels, HTTP statuses/allowlisted failure codes, app/WebView versions and support flags. Share that report and the new `RB-AUTH-…` error to help distinguish a bridge failure from an HTTPS failure. Raw provider replies, callback URLs, account details and tokens are excluded.

Saved failures are labeled **Previous sign-in attempt** and hidden while a new attempt runs. Version information remains visible even if an optional native information query fails or times out. WebView compatibility fallbacks cover signal composition, timeouts and secure UUID creation. See the [follow-up audit](audits/2026-10-07-android-auth-follow-up.md).
