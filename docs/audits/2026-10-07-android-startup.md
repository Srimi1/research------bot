# Android startup investigation — October 7, 2026

The maintainer reported that the signed 0.3.3 APK closed immediately before displaying a screen on a OnePlus 7T Pro running Android 16 / Legion OS. Previous validation covered compilation, lint, package/signature/alignment and browser previews; it did not launch the signed APK on Android.

## Confirmed failure and correction

The shipped `index.html` used `script-src 'self'`, which blocked WebAssembly compilation. Android runs SQLite through `sql.js`/WebAssembly, so initialization of every Android backend method failed. A production bundle test using the actual Android backend, real SQLite and mocked device file/lifecycle services reproduced `WebAssembly.instantiate(): ... violates ... Content Security policy ... script-src 'self'` when opening the workspace.

The policy now permits `'wasm-unsafe-eval'` while continuing to forbid JavaScript eval. The same test opens SQLite, writes a real `research.sqlite` file, reloads the app and verifies restored project notes. An ordinary same-origin script confirms that JavaScript eval is still blocked; DevTools eval is unsuitable for this policy check because it can bypass that restriction.

`MainActivity` also now calls `SplashScreen.installSplashScreen(this)` before Capacitor/AppCompat startup, as required for the declared `Theme.SplashScreen` / `postSplashScreenTheme` handoff. This corrects initialization ordering; it has not independently been established as the cause of the maintainer's native close.

## Runtime verification

The exact published 0.3.3 APK was installed and cold-launched twice on stock Android 16 in [this diagnostic run](https://github.com/Srimi1/research------bot/actions/runs/37567410054). The app remained running and exposed its welcome screen. This does not reproduce the physical phone's reported immediate close or prove its database worked.

The first diagnostic attempts exposed test-harness issues: an accessibility dump was requested before Android exposed its root, and a noisy emulator log exceeded Node's default output buffer. The harness now waits/retries, wakes/unlocks the display and captures full diagnostics. Those test failures were not classified as app crashes.

A later signed-APK check opened the project form visually while repeated accessibility dumps still described the welcome screen. The [complete screenshot and logs](https://github.com/Srimi1/research------bot/actions/runs/37569885519) distinguish this stale snapshot from a missing form or native crash. A persistent UiAutomator2 connection also [observed the stale WebView 133 subtree](https://github.com/Srimi1/research------bot/actions/runs/37570376298). The driver uses the form's Tab/Enter navigation and verifies creation after a cold reopen, then adds notes and verifies them after another cold reopen. Taps still use UI-tree-derived bounds. Failure screenshots are flushed before exit so workflow logs preserve the complete image.

The strengthened APK test installs the packaged app, checks the crash buffer, requires its interface to render, creates a project through accessibility-tree-derived taps, adds a note outline, then force-stops/reopens the app and verifies both the project and notes. CI runs it against the debug APK; release automation runs it against the exact signed APK before uploading/publishing. Screenshots, UI trees and logcat are retained as workflow artifacts.

The exact signed 0.3.4 APK passed project creation, note saving and restoration after cold restarts in the [successful release run](https://github.com/Srimi1/research------bot/actions/runs/37570995543). The public download's checksum, certificate and 16 KiB alignment were verified, along with all 11 release assets' checksum entries and update-manifest filenames/sizes.

A [parallel test](https://github.com/Srimi1/research------bot/actions/runs/37570997910) created a project with the truncated title `Andr` during automated input. The driver now waits for keyboard/focus to settle and enters characters at a human pace, while still requiring the complete title and saved notes after cold restarts. That run did not show a native crash; the physical phone's immediate close remains a separate validation item.

The [published APK repeat test](https://github.com/Srimi1/research------bot/actions/runs/37571441035) passed the complete flow with paced typing. A separate debug run reached Chrome while seeking an offscreen control; the driver now restricts gestures to the app, avoids fixed header/bottom controls and re-dumps after its final swipe before declaring a target missing.

## Remaining limits

- Stock emulator success cannot establish Legion OS-specific behavior on the maintainer's physical OnePlus.
- The immediate close needs physical-device confirmation with 0.3.4; if it persists, the phone's Android crash log is needed to distinguish a native framework/WebView failure from other causes.
- Live ChatGPT account eligibility, sign-in and inference remain unverified. Emulator project tests use local data and do not authenticate.
