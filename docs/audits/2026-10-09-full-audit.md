# Full repository audit, 2026-10-09

Scope: everything tracked on `main` at `4b7b48d` (version 0.4.2). That covers the shared backend (`core/`), the Electron desktop shell (`electron/`), the React interface (`src/`), the Android native layer (`android/`), build and release scripts (`scripts/`), GitHub Actions workflows, documentation and committed release artifacts.

Method: I read every source file by hand. I also ran the project's own checks and an automated accessibility scan (axe-core 4.10 through Playwright and Chromium) on the browser build at desktop (1440 x 1000) and phone (390 x 844) sizes. Live ChatGPT sign-in and on-device Android behavior were not tested. This audit had no real account, phone or emulator.

## Summary

The codebase is in good shape. Security fundamentals are stronger than in most apps this size: OAuth with PKCE, state and nonce, a sandboxed Electron renderer with a validated IPC sender, Keystore-backed credentials, update APKs checked against the installed signing certificate, and a strict CSP. All automated checks pass.

No critical vulnerabilities were found. The most important items are:

1. **Release pipeline:** the Android signing keystore is written to disk before `npm ci` runs third-party install scripts in the same job (R1).
2. **UI bug:** the "Close" button in Account & preferences leaves a ChatGPT sign-in running in the background (U1).
3. **UX data-loss risks:** deleting a source (and its reading notes) or a plan step has no confirmation or undo (U3).
4. **Android performance:** every save exports the whole SQLite file and sends it across the WebView bridge as base64 (A1).
5. **Release channel coupling:** desktop and Android updaters both read GitHub's single "latest release", so an Android-only release stops desktop updates and the reverse (O1).

| Severity | Count |
| -------- | ----- |
| High     | 1     |
| Medium   | 10    |
| Low      | 26    |
| Info     | 8     |

## Baseline checks

All run locally on this commit.

| Check                              | Result                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `tsc` (no emit)                    | Pass                                                                                                           |
| `npm run lint` (ESLint)            | Pass, 0 problems                                                                                               |
| `npm run format:check` (Prettier)  | Pass                                                                                                           |
| `npm test` (node:test)             | 113 of 113 pass                                                                                                |
| `npm audit`                        | 0 vulnerabilities                                                                                              |
| `vite build`                       | Pass. Main bundle 321 kB (101 kB gzip), Android chunk 209 kB, sql.js wasm 658 kB                               |
| axe-core scan, 6 screens x 2 sizes | 1 real rule failure (heading order). Contrast failures only appeared mid fade-in animation, so false positives |
| Horizontal overflow at 390 px      | None                                                                                                           |
| Console or page errors during scan | None                                                                                                           |
| Git history secret scan            | No private keys, tokens or keystores found in any commit                                                       |

UI smoke tests, Electron tests and Android emulator tests were not run here. They need a display server, Electron binaries and KVM.

## High

### R1. Signing keystore is on disk while untrusted install scripts run

`.github/workflows/release.yml`, job `android`. The step "Restore the signing key" decodes `ANDROID_KEYSTORE_BASE64` to `$RUNNER_TEMP/release.jks`. The next steps are `npm ci` and `npm test`, which run lifecycle scripts from roughly 700 transitive packages. A compromised dependency could read the keystore file during install. The passwords are only passed into the later Gradle step, but the keystore itself is the asset that matters most. This project has already lost a signing key once, which forced every user to reinstall for 0.4.0.

Fix: move "Restore the signing key" to just before "Build the signed APK", after `npm ci`, `npm test` and `npm run build:android`. Or run `npm ci` with its ignore-scripts option in this job. Also delete the keystore right after Gradle finishes, not only in the final `always()` step.

## Medium

### R2. Release workflow grants `contents: write` to every job

`.github/workflows/release.yml` sets `permissions: contents: write` at the top level. Every job, including the ones that run `npm ci` and tests, gets a token that can push tags and edit releases. Set `contents: read` at the top and grant `contents: write` only to the steps that run `gh release upload` or `gh release create`. Splitting the build from the upload job would be cleaner still.

### O1. Desktop and Android share one "latest release" channel

`electron-updater` (GitHub provider) and `src/android/releases.ts:695` both read `/releases/latest`. Release 0.4.0 is Android-only, so desktop installs find no `latest.yml` there and stop receiving updates (errors are logged silently). The reverse also holds: a desktop-only release hides any Android update. Fix: always publish both platforms together, or give Android its own channel. For example, Android could list releases and pick the newest that has the APK asset, or read a dedicated `android-latest.json`.

### U1. "Close" in Account & preferences does not cancel an active sign-in

`src/App.tsx:586`. The footer Close button calls `onClose`, but the X button, Escape and backdrop call `close`, which cancels sign-in first (`src/App.tsx:346`). If a user taps Close while the browser consent is open, the loopback listener and Android foreground service keep running with no visible UI. Reopening the dialog and pressing Continue then fails with "A ChatGPT sign-in is already in progress." Fix: use `onClick={close}` on that button.

### U2. Choosing a model is lost unless "Save preferences" is clicked

`src/App.tsx:539` to `607`. After first sign-in the model is empty. The user picks one from the dropdown and closes the dialog, and the choice is discarded. Their first assistant run then fails with "Choose an available ChatGPT model in settings." Fix: save the model as soon as it changes, or preselect the first listed model after sign-in. At minimum, warn about unsaved preferences on close.

### U3. Deleting a source or plan step is immediate and permanent

`src/App.tsx:2414` (source) and `src/App.tsx:964` (step). One tap on the trash icon removes the source together with its method, findings, limitations and reading notes. There is no confirmation and no undo. Project deletion has a confirmation; these need one too, or an "Undo" toast.

### U4. Delete project can be submitted twice

`src/App.tsx:2715`. The "Delete project" button has no busy state. A double click sends two deletes. The second fails with "Project not found" and shows an error toast after a successful delete. Add a busy flag and disable the button while it runs.

### A1. Android saves the whole database through the bridge on every change

`src/android/database.ts:450`. Any write schedules `db.export()` one second later. The full file is base64 encoded in JS (`src/android/native.ts:678` builds one large string), sent over the Capacitor bridge, decoded in Java and written out. Note history alone may hold up to 10 million characters per project (`core/store.ts:11`), so a heavy user can reach tens of MB per save while typing. Expect UI jank, high memory use and possible out-of-memory crashes on older phones. `fileRead` (`ResearchNativePlugin.java:539`) also loads the whole file into one array at startup. Options: lower the history budget on Android, raise the save delay while the user is typing, or move to a native SQLite plugin with incremental writes.

### S1. Electron security fuses are not configured

`package.json` build config. The packaged app keeps Electron's defaults: `RunAsNode` on, `NODE_OPTIONS` honored, and no asar integrity check. Anyone who can launch the binary with `ELECTRON_RUN_AS_NODE=1` gets a plain Node runtime under the app's identity and keychain access. Use `@electron/fuses` (or electron-builder's `electronFuses`) to turn off `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments`, and enable `EnableEmbeddedAsarIntegrityValidation` plus `OnlyLoadAppFromAsar`.

### S2. Initial sign-in treats a missing `scope` as "no scopes"

`core/auth.ts:520`. Per RFC 6749 section 5.1, a token response may omit `scope` when it equals the requested scope. Sign-in stores `[]` in that case, so the account shows "plan usage is not authorized" and every assistant call is refused. Token refresh already falls back to the previous scopes (`core/auth.ts:725`). Initial sign-in should fall back to the requested `SCOPES` the same way. If the omission is deliberate as a conservative choice, add a comment and a test.

### R3. Third-party actions are pinned by tag, not commit SHA

`actions/checkout@v4`, `setup-node@v4`, `setup-java@v4`, `upload-artifact@v4`, `download-artifact@v4` and `android-actions/setup-android@v3` are pinned by mutable tags. The release job runs these with signing secrets and a write token. `android-emulator-runner` is already SHA-pinned. Pin the rest the same way and add Dependabot for `github-actions` so the pins stay current.

## Low

### UI, UX and accessibility

- **U5. Dialogs focus the Close button first.** `src/App.tsx:131` focuses the first `input,button,textarea,select`, and in DOM order that is the header's X button. In "Start a research project" the keyboard user lands on Close, not on the title field. The axe scan confirmed this at both sizes. Prefer the first form field, or an `autoFocus` on it.
- **U6. Heading order on the welcome screen.** `src/App.tsx:1810` puts `<h3>` inside each agent button with no `<h2>` before it (axe `heading-order`). Headings inside buttons are also flattened by screen readers. Use a `<span>` or `<strong>` and make "Meet your research team" a real `<h2>`.
- **U7. Undo and Redo are always enabled.** `src/App.tsx:2010`. With no history they produce an error toast ("There is no earlier saved version"). Disable them when nothing is available, or show a neutral notice instead of an error.
- **U8. Toasts never auto-dismiss.** `src/App.tsx:2654`. Notices such as "Project deleted." stay until closed. A newer message also silently replaces an older error. Auto-hide notices after a few seconds and keep errors until dismissed.
- **U9. Export menu ignores Escape and outside clicks.** `src/App.tsx:1842`. It only closes from its own button or a menu item. Add both close paths and `aria-haspopup`.
- **U10. No way to refresh a cached Crossref search.** The backend supports `refresh` (`core/runner.ts:146`) but the UI never sends it. The same query returns 24-hour-old results tagged "cached search" with no button to rerun. Add a "Search again" action.
- **U11. Small text on phones.** `src/mobile.css` uses 10 px and 11 px in about 15 places (badges, captions, labels). This is hard to read and below common guidance of 12 px minimum for secondary text.
- **U12. Weak focus ring on text fields.** `src/styles.css:52` removes the outline and uses a 3 px `#e8eee7` glow on a near-white background, plus a border color change. The glow is nearly invisible. Check it against WCAG 2.4.11 / 1.4.11 (3:1) and consider a darker ring.
- **U13. Android update prompt repeats every six hours.** `src/android/updater.ts:812`. A declined update reopens a blocking `window.confirm` on every check. Remember the declined version for the session, or show a non-blocking banner.
- **U14. A save-state `role="status"` region contains a button.** `src/App.tsx:1947`. Live regions with controls are announced oddly. Move "Save now" outside the status span.
- **U15. Matrix and step drafts reset when their source object is replaced.** `src/App.tsx:815` and `903` copy props into state in an effect. Saving a search result that matches an existing source by DOI replaces that object, which wipes any unsaved typing in its matrix row. Edge case, but it loses text without warning.
- **U16. Many near-identical colors.** `src/styles.css` has dozens of slightly different grays and greens (for example `#60655a`, `#5d6853`, `#5e6754`, `#61655b`). Moving them into CSS custom properties would make theming, dark mode and contrast fixes much easier.

### Code and correctness

- **C1. `cancelProject` reloads the project once per active run.** `core/runner.ts:139` calls `store.getProject(id)` (sources, plan and all runs) inside the loop. Load once before the loop.
- **C2. Redo adds history without pruning.** `core/store.ts:315` calls `pushHistory` but not `pruneHistory`. The count stays bounded by the undo/redo pairing, but the size budget is not re-checked. Call `pruneHistory` there too.
- **C3. Android file writes share one temp name.** `ResearchNativePlugin.java:563` always uses `<name>.tmp` on a cached thread pool. Two concurrent writes of the same file (for example `signin.json` from two code paths) can interleave. Use a unique temp name, as the desktop `directoryFiles` already does, and fsync the directory after the rename.
- **C4. `getActivity()` may be null.** `ResearchNativePlugin.java:597` (`openUrl`) and `:752` (`installUpdate`) dereference it without a check. This is rare, but it crashes the call if the activity was destroyed.
- **C5. versionCode overflows past 99.** `android/app/build.gradle:9` computes `major*10000 + minor*100 + patch`. A patch or minor of 100 or more collides with the next version and breaks the "newer than installed" check. Document the limit or widen the multipliers.

### Security hardening

- **S3. Native HTTP has no host allowlist.** `ResearchNativePlugin.java:125` fetches any HTTPS URL without CORS. The calling JS is bundled and trusted, but if script injection ever reached the WebView this would give it unrestricted network access. Allowlist the hosts the app actually uses (`auth.openai.com`, `api.openai.com`, `api.crossref.org`, `api.github.com`, `github.com`).
- **S4. Production CSP still allows the dev server.** `index.html:10` includes `ws://127.0.0.1:5173` in `connect-src` for every build. Inject it only in dev (Vite `transformIndexHtml`).
- **S5. Desktop installers are unsigned.** Windows NSIS has no Authenticode signature and macOS is ad hoc signed. Users get SmartScreen and Gatekeeper warnings. On Windows, `electron-updater` cannot verify the publisher, so update integrity rests only on GitHub and the `latest.yml` hash. This is already documented, so it is listed for completeness.
- **S6. The key-generation script prints the secrets.** `scripts/create-android-signing-key.sh` prints the whole secrets file with `cat`, which leaves passwords and the base64 keystore in terminal scrollback and any session recording. Print only the file path.
- **S7. Gradle wrapper download is not checksum-pinned.** `android/gradle/wrapper/gradle-wrapper.properties` has no `distributionSha256Sum`. Add it.

### Operations and repository

- **O2. Signed APKs are committed to Git.** `downloads/android/` holds 0.3.9 and 0.4.0 (about 4.7 MB each), and history has every APK since 0.3.4. `.git` is already 40 MB and grows with each release. Prefer GitHub Release assets only, or Git LFS.
- **O3. CI runs twice per PR push.** `check.yml` triggers on both `push` and `pull_request` with no `concurrency` group. Each PR commit runs the full matrix, including two emulator jobs and four packaging jobs, twice. Limit `push` to `main` and add `concurrency: { group: ..., cancel-in-progress: true }`.
- **O4. No Dependabot configuration.** There is no `.github/dependabot.yml` for npm, Gradle or Actions. Several dependencies are already a patch behind (Electron 42.11.10 vs 42.11.12, Capacitor 8.5.2 vs 8.5.3, Vite 7.3.6 vs 7.3.7, Playwright 1.63 vs 1.64).
- **O5. No `engines` field.** The project needs Node 24 (CONTRIBUTING, CI), but `package.json` does not declare it, so `npm ci` on an older Node gives no warning.

## Info

- **I1. README says "four assistants".** `README.md:7`. The app and the table directly below list five: methods, evidence, literature review, grammar and brainstorming.
- **I2. `safeExternal` misses a few reserved IPv4 ranges.** `src/shared/external-url.ts` blocks the main private ranges but not `192.0.0.0/24`, `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` or `240.0.0.0/4`. This only affects opening links in the system browser, so the impact is negligible.
- **I3. Unused Google Services classpath.** `android/build.gradle` adds `com.google.gms:google-services` but no module applies it. It can be removed.
- **I4. Major versions available.** Electron 44, Vite 8, TypeScript 7, ESLint 10, undici 8, lucide-react 1.x. Electron 42 is still inside its support window, but plan the upgrade before it drops out.
- **I5. Mutable docs history.** `downloads/android/README.md` cites "106 unit tests". The suite now has 113. This is fine as a point-in-time record, but label it as such.
- **I6. Linux plaintext keyring is refused (good).** `electron/main.ts` rejects `basic_text`, as documented. Users without a keyring see a clear message instead of insecure storage.
- **I7. Local runs used Node 22.** All tests passed under Node 22.22, but CI and the docs target Node 24. Results should match, but this audit did not run on 24.
- **I8. `docs/android-login-problem-prompt.md`** is an AI prompt kept in user-facing docs. Consider moving it out of `docs/` or labeling it as internal.

## What is done well

These are worth keeping as the project grows:

- **OAuth:** PKCE S256, constant-time state and nonce comparison, one-use callback, client ID pinning, `redirect: 'error'` on every credentialed request, JWKS refetch on key rotation, and safe allowlisted error codes that never echo tokens or URLs.
- **Credential handling:** OS keychain or Android Keystore AES-GCM only, write rollback if sign-out races a persist (`core/auth.ts:229`), and no backup or device transfer of device-bound data.
- **Electron:** `contextIsolation`, `sandbox`, no `nodeIntegration`, sender and frame URL checked on every IPC call, navigation and new windows blocked, permissions denied by default.
- **Update integrity on Android:** checksum, package name, higher versionCode and identical signing certificate are all required before install.
- **Input validation:** Zod at the API boundary and a second validation layer in the store, size limits throughout, and streamed reads with byte caps.
- **AI output safety:** grammar edits are re-anchored and diffed against the claimed result, numbers, links and citations cannot be changed, and literature citations must quote supplied text verbatim.
- **Testing culture:** 113 unit tests, Playwright UI smoke tests, real emulator runs on API 36, and signed APK verification in CI.

## Suggested order of work

1. R1 and R2 (release pipeline secrets and permissions). Small workflow edits with the largest risk reduction.
2. U1 and U4 (one-line UI bug fixes).
3. U2 and U3 (model persistence and delete confirmations).
4. O1 (separate update channels) before the next platform-specific release.
5. S1 (Electron fuses) with the next desktop release.
6. A1 (Android save performance), measured on a low-end phone with a large project.
7. The Low items as routine cleanup, starting with R3 and O4 so dependency and action updates are automatic.
