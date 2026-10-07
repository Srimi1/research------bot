# Implementation and validation

## Implemented

- Electron desktop shell with an isolated, sandboxed renderer and narrow validated IPC.
- SQLite project storage with version checks, note history with undo and redo (the newest 50 revisions per project, within a 10 million character budget), independent projects, cascading deletion, source deduplication, run history, and a 24-hour source-search cache.
- Official system-browser OAuth sign-in with PKCE, state, nonce, JWT issuer/audience/signature validation, stable host identity, encrypted credentials, serialized refresh, revocation, and cancellation. No API-key fallback.
- Account-specific model discovery and Responses streaming with explicit inputs, `store: false`, and success only after a completion event.
- Four selectable roles sharing task progress, cancellation, structured outputs, and an AI request limit per application session.
- Methods explanations and proposed steps, brainstorming ideas, and grammar edits presented for human review.
- Crossref metadata searches with DOI links and retrieval provenance. Saved sources have editable literature-matrix fields; extracted findings are never invented from metadata.
- Markdown/JSON export and browser-only preview with separate browser storage.
- An Android app that runs the same backend (`core/`) in a WebView with native HTTPS streaming, a loopback sign-in callback, Android Keystore credentials, on-device SQLite and verified in-app updates. See [Android app](android.md).

## Evidence scope

Live Crossref metadata searches were verified for food-waste and embodied-carbon topics. The beta does not crawl arbitrary pages or independently search all forums and institutional websites. It provides report/forum search guidance and supports researcher-supplied source links. Search results show metadata access, not full-text verification. Local PDF extraction and automated full-text claim extraction remain future work.

## Validation boundaries

Automated tests cover OAuth protocol validation, refresh/revocation, stream completion/failures, source parsing, response bounds, cancellation, SQLite persistence and project isolation, concurrent saves, source deduplication, grammar-output validation, and task limits.

CI runs formatting, dependency auditing, build-tool compatibility checks, Android compilation/lint, ESLint, the backend tests (also inside Electron's bundled Node for the SQLite store), the production build, four browser workflow suites, an Electron smoke test that drives the real desktop app under a virtual display, and an unsigned package build on Linux, Windows, and macOS. Browser fixtures exercise source/grammar review and methods/brainstorm acceptance controls; they do not simulate AI generation in the product. A real Electron launch verified its preload bridge, absence of renderer Node access, SQLite save/read/delete, and account state. The packaged Linux desktop app also retrieved 12 live source records, saved a source, retained notes after a full restart, and opened preferences. The final AppImage launched successfully in extraction mode. The cloud machine has no OS keychain, and correctly refused live credential storage. Desktop smoke checks used a virtual display and disabled the Chromium OS sandbox for this container; the application's renderer isolation and Node-access restrictions remained enabled.

These tests do not establish live ChatGPT account eligibility or the linguistic accuracy of model output. A real account must complete sign-in and inference, then assess the planned 20-passage grammar fidelity evaluation and two end-to-end research sessions. Prompts and structural validation reduce unintended changes but do not guarantee semantic preservation. Review each grammar edit before accepting it.

## Operating notes

Desktop research data lives in the Electron user-data directory; Android research data lives in app-private storage. Android SQLite snapshots are batched and atomically written after one second without changes, or flushed when the app backgrounds. The interface save indicator reflects the in-memory update, not a synchronous disk write. Project notes support up to one million characters, research questions up to 20,000. Credentials are stored separately with OS-backed encryption and excluded from exports. Local research content itself is not encrypted by the app. Use operating-system disk encryption where appropriate.

The request budget resets when the application restarts. It counts AI requests made by this app; it is not an account-wide billing or allowance meter. Available model token counts are shown per completed request. Up to two tasks may run concurrently. Tasks time out after three minutes. Crossref searches have shorter network and response-size limits.

Only one desktop instance is permitted to protect rotating credentials. Linux requires an available secure keychain; headless/plaintext storage cannot be used for live sign-in. Build installers on the target OS for the most reliable packaging. Signing/notarization is not configured for this development beta.

## Before a public release

These need decisions or credentials from the maintainer, so they are not automated yet:

- **Code signing.** macOS needs an Apple Developer ID certificate and notarization; Windows needs a code-signing certificate. Unsigned builds trigger Gatekeeper and SmartScreen warnings. electron-builder reads `CSC_LINK`/`CSC_KEY_PASSWORD` (and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization) from CI secrets.
- **App icons.** The current artwork is `public/app-icon.png`; Windows/macOS use the configured ICO/ICNS files and Android uses generated launcher assets. The old SVG/PNG remains as legacy artwork. See [branding](branding.md) for exact locations and regeneration commands.
- **Auto-update.** Done for Windows and the Linux AppImage; see [Releases and updates](#releases-and-updates). macOS cannot update itself until the app is signed.
- **macOS releases.** `release.yml` publishes Linux and Windows. Add a macOS job once signing is set up, since an unsigned Mac app can neither pass Gatekeeper cleanly nor update itself.
- **Linux checks.** On Ubuntu 24.04 and later, AppArmor may block the Chromium sandbox for AppImages; test a downloaded AppImage on a clean machine. Live sign-in needs a desktop keyring (GNOME Keyring or KWallet).
- **Crossref etiquette.** Requests identify the app by its repository URL. Crossref's faster "polite" pool also wants a contact email (`mailto`) in the user agent; add one if a project contact address exists.

## Releases and updates

Installed copies check [GitHub Releases](https://github.com/Srimi1/research------bot/releases) about 15 seconds after launch and every six hours. A newer version downloads in the background; the app then asks whether to restart now. On desktop, choosing **Later** installs it the next time the app quits. Android always requires the Android installer confirmation; declining does not silently install an APK. Updates never interrupt work: if a check fails (offline, rate limited), it is only logged.

- **Where it works:** Windows (NSIS installer), Linux (AppImage) and Android (the release APK). Other Linux formats and unsigned macOS builds cannot replace themselves, so the updater stays off there.
- **Turning it off:** clear **Check for updates automatically** in Account & preferences, or, on desktop, set `RESEARCH_BOT_DISABLE_UPDATES=1`.
- **Privacy:** a check downloads the release manifest from GitHub. GitHub sees the request and its IP address, as with any download; nothing about projects, notes, or the ChatGPT account is sent.

To publish a new version:

1. Bump `version` in `package.json` (for example to `0.3.3`) and merge it to `main`. Auto-update only offers versions higher than the installed one.
2. Release it, either way:
   - **From GitHub Actions:** run **Publish release** on `main` with the tag `v0.3.3`. Choose **Android source: build** to build with the signing secrets, or **prebuilt** to verify and reuse the signed APK committed in `downloads/android` (see [the Android guide](android.md#release-an-existing-signed-apk)). It creates a draft on that commit and publishes it only after every build/upload succeeds, using `docs/releases/v0.3.3.md` as the notes when that file exists (GitHub's generated notes otherwise).
   - **From the Releases page:** publish a release whose tag is `v` plus that version (`v0.3.3`). Leave "Set as a pre-release" unchecked: the updater ignores pre-releases.

   Either way, the workflow refuses a tag that does not match `package.json`. Building Android requires all four signing secrets; the manual **prebuilt** option instead requires a verified APK with matching build information and unchanged app inputs. Prefer the manual workflow: publishing a release from the Releases page exposes it before its assets have been built.

3. The workflow builds the AppImage and Windows installer, and builds or verifies the signed Android APK. It attaches them with `latest-linux.yml`, `latest.yml`, block maps, per-platform `SHA256SUMS` files, and the source archive. Installed apps pick the release up on their next check. Android requires the same signing certificate as the installed copy.

Source and development history are maintained in [Srimi1/research------bot](https://github.com/Srimi1/research------bot). The repository's initial commit and MIT license are preserved. Download only assets actually attached to a completed release. At the October 6, 2026 audit, the latest public release was v0.3.1 and did not contain an APK. CI now uploads a debug APK as a workflow artifact; it is not interchangeable with a personally or release-signed installation. See the [audit report](audits/2026-10-06.md).
