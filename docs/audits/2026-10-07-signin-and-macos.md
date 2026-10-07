# Sign-in callback and Mac distribution review — 2026-10-07

## Trigger and scope

The researcher supplied an Android browser screenshot of `127.0.0.1:<port>/auth/c…` displaying **“This sign-in is no longer active.”** They also requested a Mac DMG with research features. Reviewed the shared OAuth service, Android callback adapter/Java plugin, desktop preload/main lifecycle, installer configuration and CI/release flow. This focused follow-up supplements the [complete audit](2026-10-06.md).

## Confirmed callback ordering bug

`AuthService.performSignIn` answered the callback and settled the sign-in promise immediately. The Android adapter discarded the `loopbackRespond` promise; the Java plugin resolved it before its worker wrote the response. The auth cleanup could therefore call `loopbackClose` first. Java `closeServer` answered any remaining socket with the exact message shown in the screenshot, replacing the queued success or failure page.

A transport regression using the real shared auth service, verified test JWTs and a delayed socket response failed before the fix: server close occurred without a completed reply. The fix propagates response completion through Java, the Android adapter and the shared callback contract; both successful and rejected callbacks now complete before cleanup. The test retains PKCE/state/nonce checks and encrypted persistence. Cancellation and the five-minute timeout still intentionally close inactive sessions. The screenshot alone cannot distinguish this race from an intentionally cancelled/timed-out attempt.

## Mac delivery

The repository had a Mac icon and DMG target, but release CI built only Linux and Windows; Mac CI only produced an unpacked app. Added Apple Silicon and Intel DMG builds, installation/runtime checks on matching Mac runners and per-architecture checksum assets. Releases remain draft until these checks and the signed Android runtime check pass.

The existing desktop backend supplies full local research storage, source discovery, plans, reviewed assistant outputs and exports. Added native Mac menus, research/save/export/preferences shortcuts, interface zoom, and reopening the retained window from the Dock. A fixed command set passes through the preload; project/auth operations retain their existing validated IPC. Menu navigation does not replace open dialogs.

Mac apps use ad hoc signing for local executable integrity. There is no Apple Developer ID certificate or notarization configured; automatic Mac updates remain disabled. Documentation explains installation, data locations, manual updates and the live-account validation limit.

## Validation

- Reproduced the callback ordering failure before applying the fix; the regression passes for both success and identity rejection afterward.
- Repository checks cover formatting, lint, dependency audit, build-tool compatibility, backend tests, Electron's bundled SQLite runtime, browser workflows and the production Android SQLite/CSP bundle.
- CI installs each actual Mac DMG and exercises the packaged Electron runtime, menus, notes/revisions, plan controls, export chooser, single instance, Dock reopening and persistence after restart.
- Signed Android release compilation/lint, certificate/alignment/provenance checks and Android 16 APK runtime checks are required before publishing.

The first CI attempt exposed two driver mistakes: the Mac `lipo -verify_arch` argument order, and an Android tap on an accessibility node obscured by fixed bottom navigation. Corrected the command and bounded Android touches/scrolls using the current XML header/footer geometry. That Android run launched and created its project but did not add notes; it is not counted as a passing persistence check.

See linked GitHub workflow results for the completed runs; builds still in progress are not evidence of success. No real account credentials or private signing keys are included. Live consent/inference, the physical OnePlus/Legion OS and the researcher's physical MacBook remain outside automated validation.
