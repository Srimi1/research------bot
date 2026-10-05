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

## Evidence scope

Live Crossref metadata searches were verified for food-waste and embodied-carbon topics. The beta does not crawl arbitrary pages or independently search all forums and institutional websites. It provides report/forum search guidance and supports researcher-supplied source links. Search results show metadata access, not full-text verification. Local PDF extraction and automated full-text claim extraction remain future work.

## Validation boundaries

Automated tests cover OAuth protocol validation, refresh/revocation, stream completion/failures, source parsing, response bounds, cancellation, SQLite persistence and project isolation, concurrent saves, source deduplication, grammar-output validation, and task limits.

CI runs ESLint, the backend tests (also inside Electron's bundled Node for the SQLite store), the production build, two browser workflow suites, an Electron smoke test that drives the real desktop app under a virtual display, and an unsigned package build on Linux, Windows, and macOS. Browser fixtures exercise source/grammar review and methods/brainstorm acceptance controls; they do not simulate AI generation in the product. A real Electron launch verified its preload bridge, absence of renderer Node access, SQLite save/read/delete, and account state. The packaged Linux desktop app also retrieved 12 live source records, saved a source, retained notes after a full restart, and opened preferences. The final AppImage launched successfully in extraction mode. The cloud machine has no OS keychain, and correctly refused live credential storage. Desktop smoke checks used a virtual display and disabled the Chromium OS sandbox for this container; the application's renderer isolation and Node-access restrictions remained enabled.

These tests do not establish live ChatGPT account eligibility or the linguistic accuracy of model output. A real account must complete sign-in and inference, then assess the planned 20-passage grammar fidelity evaluation and two end-to-end research sessions. Prompts and structural validation reduce unintended changes but do not guarantee semantic preservation. Review each grammar edit before accepting it.

## Operating notes

Research data lives in the Electron user-data directory. Credentials are stored separately with OS-backed encryption and excluded from exports. Local research content itself is not encrypted by the app. Use operating-system disk encryption where appropriate.

The request budget resets when the application restarts. It counts AI requests made by this app; it is not an account-wide billing or allowance meter. Available model token counts are shown per completed request. Up to two tasks may run concurrently. Tasks time out after three minutes. Crossref searches have shorter network and response-size limits.

Only one desktop instance is permitted to protect rotating credentials. Linux requires an available secure keychain; headless/plaintext storage cannot be used for live sign-in. Build installers on the target OS for the most reliable packaging. Signing/notarization is not configured for this development beta.

## Before a public release

These need decisions or credentials from the maintainer, so they are not automated yet:

- **Code signing.** macOS needs an Apple Developer ID certificate and notarization; Windows needs a code-signing certificate. Unsigned builds trigger Gatekeeper and SmartScreen warnings. electron-builder reads `CSC_LINK`/`CSC_KEY_PASSWORD` (and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization) from CI secrets.
- **App icons.** Done: `build/icon.svg` is the source and `build/icon.png` (1024 x 1024) is what electron-builder uses for every platform. After editing the SVG, run `npm run icon` to regenerate the PNG. The browser preview uses the same artwork as `public/favicon.svg`.
- **Auto-update.** Done for Windows and the Linux AppImage; see [Releases and updates](#releases-and-updates). macOS cannot update itself until the app is signed.
- **macOS releases.** `release.yml` publishes Linux and Windows. Add a macOS job once signing is set up, since an unsigned Mac app can neither pass Gatekeeper cleanly nor update itself.
- **Linux checks.** On Ubuntu 24.04 and later, AppArmor may block the Chromium sandbox for AppImages; test a downloaded AppImage on a clean machine. Live sign-in needs a desktop keyring (GNOME Keyring or KWallet).
- **Crossref etiquette.** Requests identify the app by its repository URL. Crossref's faster "polite" pool also wants a contact email (`mailto`) in the user agent; add one if a project contact address exists.

## Releases and updates

Installed copies check [GitHub Releases](https://github.com/Srimi1/research------bot/releases) about 15 seconds after launch and every six hours. A newer version downloads in the background; the app then asks whether to restart now. Choosing **Later** installs it the next time the app quits. Updates never interrupt work: if a check fails (offline, rate limited), it is only logged.

- **Where it works:** Windows (NSIS installer) and Linux (AppImage). Other Linux formats and unsigned macOS builds cannot replace themselves, so the updater stays off there.
- **Turning it off:** clear **Check for updates automatically** in Account & preferences, or set `RESEARCH_BOT_DISABLE_UPDATES=1`.
- **Privacy:** a check downloads the release manifest from GitHub. GitHub sees the request and its IP address, as with any download; nothing about projects, notes, or the ChatGPT account is sent.

To publish a new version:

1. Bump `version` in `package.json` (for example to `0.2.0`) and merge it to `main`. Auto-update only offers versions higher than the installed one.
2. Create a GitHub release whose tag is `v` plus that version (`v0.2.0`). The release workflow refuses a tag that does not match.
3. The workflow builds the AppImage and Windows installer and attaches them with `latest-linux.yml`, `latest.yml`, block maps, per-platform `SHA256SUMS` files, and the source archive. Installed apps pick the release up on their next check.

Source and development history are maintained in [Srimi1/research------bot](https://github.com/Srimi1/research------bot). The repository's initial commit and MIT license are preserved. Desktop binaries and the source archive are attached to GitHub releases.
