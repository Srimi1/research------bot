# Security

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** option on this repository's Security tab if private reporting is available. Otherwise, open an issue requesting a private contact channel without including exploit details, credentials or private research data. Do not post tokens or signing keys in issues or pull requests.

Include the affected version/platform, reproduction steps, expected and actual behavior, impact and any suggested fix. Use synthetic project data. There is no guaranteed response-time commitment for this personal beta.

## Scope and supported versions

Security fixes target the current source on `main`. Older installers should be updated when a newer compatible signed release is available. A successful automated audit is not a guarantee that all vulnerabilities are absent.

- Desktop uses a sandboxed, isolated renderer, restricted IPC and OS-backed credential encryption. Linux plaintext keyring fallback is rejected.
- Android uses app-private files and AES-GCM credentials protected by an Android Keystore key. The shared auth/core runs in the app's WebView; decrypted credentials are present in app memory during authorized requests.
- OAuth validates PKCE, state, nonce and token issuer/audience/signature. Sign-in occurs in the system browser. Project exports exclude credentials.
- Crossref lookup uses a fixed HTTPS endpoint with time/size limits. Source links are opened externally; public-link validation checks URL syntax and literal local-address forms, without resolving DNS.
- Android updates require matching checksums, package identity, a higher version and the installed signing certificate. Treat the release signing key and GitHub publishing access as sensitive.

Research notes and metadata are not independently encrypted by the app. Android backups/device transfers are disabled because credential encryption is device-bound. Export projects before uninstalling. Selected assistant input is sent to the remote provider when requested. Live ChatGPT eligibility and output fidelity remain open validation items.

See the [dated audit](docs/audits/2026-10-06.md), [architecture](docs/architecture.md) and [Android guide](docs/android.md).
