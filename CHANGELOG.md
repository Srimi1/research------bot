# Changelog

## 0.3.9 (2026-10-07)

- Fixed Android ChatGPT sign-in failing with `RB-AUTH-EXCHANGE-DNS` while Check connection succeeded. The code was exchanged while the browser was in front, and Android blocks networking for background apps. Android now returns to the app and waits for its network before the exchange.
- Added an Android 16 emulator reproduction that drives the real app without instrumentation behind a real browser (stock, frozen-app and Data Saver cases).

## 0.3.5 — 2026-10-07

- Fixed Android sign-in replies racing callback-server cleanup, which could show “This sign-in is no longer active” instead of the completed response.
- Added an asynchronous callback regression for successful and rejected sign-ins.
- Added Apple Silicon and Intel Mac DMG releases with installed-app runtime checks and checksums.
- Added native Mac research menus, Command-key shortcuts, interface zoom and Dock reopening.
- Documented Mac installation, research workflows, local data, manual updates and signing limitations.

## 0.3.4 — 2026-10-07

- Fixed Android SQLite initialization being blocked by the shipped content security policy. WebAssembly is allowed; JavaScript eval stays blocked.
- Initialized the AndroidX splash screen before Capacitor/AppCompat so the declared post-splash theme is applied at startup.
- Added a production Android backend test that opens real SQLite, saves a project and restores notes under the shipped CSP.
- Added Android 16 emulator checks for native launch, project creation, note saving and cold restart to CI and signed APK releases. A release cannot publish until its actual signed APK passes.

## 0.3.3 — 2026-10-06

- Fixed Android cancellation races involving late response headers and body chunks.
- Allowed the API to save the database's supported one-million-character notes; shared draft limits with the interface.
- Unified public-link validation across Android, desktop and browser preview, including local IPv4/IPv6 forms and trailing-dot localhost.
- Strengthened desktop text colors after automated accessibility checks found low contrast.
- Resolved build dependency advisories with targeted, compatibility-tested overrides.
- Added a reusable complete audit skill, regression coverage and a dated audit report.
- Added README phone previews, accurate platform/download guidance, branding documentation, contribution/security guides and issue/PR templates.
- Made manually created releases stay draft until every build/upload succeeds; checked signing configuration before release creation.
- Added downloadable Android debug APK artifacts and dependency checks to CI.

## 0.3.2 — 2026-10-06

- Improved Android welcome, empty states, project progress, assistant shortcuts, contrast and touch controls.
- Added gentle welcome/screen motion and animated bottom navigation with reduced-motion support.
- Prevented notifications from covering dialog actions.
- Expanded phone workflow checks, including narrow screens and larger text.

## 0.3.1

Shared desktop/Android core, native Android networking and storage, ChatGPT authentication, Crossref evidence search and verified in-app updates. See [release notes](docs/releases/v0.3.1.md) and the actual attached release assets for distribution availability.
