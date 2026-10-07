# Android startup investigation — October 7, 2026

The maintainer reported that the signed 0.3.3 APK closed immediately before displaying a screen on a OnePlus 7T Pro running Android 16 / Legion OS. Previous validation covered compilation, lint, package/signature/alignment and browser previews; it did not launch the signed APK on Android.

## Confirmed failure and correction

The shipped `index.html` used `script-src 'self'`, which blocked WebAssembly compilation. Android runs SQLite through `sql.js`/WebAssembly, so initialization of every Android backend method failed. A production bundle test using the actual Android backend, real SQLite and mocked device file/lifecycle services reproduced `WebAssembly.instantiate(): ... violates ... Content Security policy ... script-src 'self'` when opening the workspace.

The policy now permits `'wasm-unsafe-eval'` while continuing to forbid JavaScript eval. The same test opens SQLite, writes a real `research.sqlite` file, reloads the app and verifies restored project notes. An ordinary same-origin script confirms that JavaScript eval is still blocked; DevTools eval is unsuitable for this policy check because it can bypass that restriction.

`MainActivity` also now calls `SplashScreen.installSplashScreen(this)` before Capacitor/AppCompat startup, as required for the declared `Theme.SplashScreen` / `postSplashScreenTheme` handoff. This corrects initialization ordering; it has not independently been established as the cause of the maintainer's native close.

## Runtime verification

The exact published 0.3.3 APK was installed and cold-launched twice on stock Android 16 in [this diagnostic run](https://github.com/Srimi1/research------bot/actions/runs/37567410054). The app remained running and exposed its welcome screen. This does not reproduce the physical phone's reported immediate close or prove its database worked.

The first diagnostic attempts exposed test-harness issues: an accessibility dump was requested before Android exposed its root, and a noisy emulator log exceeded Node's default output buffer. The harness now waits/retries, wakes/unlocks the display and captures full diagnostics. Those test failures were not classified as app crashes.

The strengthened APK test installs the packaged app, checks the crash buffer, requires its interface to render, creates a project through accessibility-tree-derived taps, adds a note outline, then force-stops/reopens the app and verifies both the project and notes. CI runs it against the debug APK; release automation runs it against the exact signed APK before uploading/publishing. Screenshots, UI trees and logcat are retained as workflow artifacts.

## Remaining limits

- Stock emulator success cannot establish Legion OS-specific behavior on the maintainer's physical OnePlus.
- The immediate close needs physical-device confirmation with 0.3.4; if it persists, the phone's Android crash log is needed to distinguish a native framework/WebView failure from other causes.
- Live ChatGPT account eligibility, sign-in and inference remain unverified. Emulator project tests use local data and do not authenticate.
