# Android authentication follow-up — 7 October 2026

Scope: Android APK only, following the maintainer's request. The maintainer confirmed that the error initially displayed after updating to 0.3.7 was already saved, then reported that a fresh attempt also failed. The fresh attempt also shows `RB-AUTH-EXCHANGE-NETWORK`; the installed WebView version remains unknown. No VPN, ad blocker, firewall or custom Private DNS is reported. Screenshots and personal account details are excluded.

## Confirmed bugs and fixes

1. **Optional timeout API prevented token transport.** Removing `AbortSignal.timeout` from the published 0.3.7 production-bundle fixture reproduced `RB-AUTH-EXCHANGE-NETWORK` with zero native token requests. A shared fallback now uses an abort controller and a bounded timer while preserving a timeout reason. All APK deadline callers use that helper.
2. **Optional platform query hid diagnostic versions.** Making the Android `appInfo` query reject removed the entire version label in 0.3.7. A hung query could also delay the account result indefinitely. The bundled version is now displayed independently; a bounded, curated device reader supplies numeric WebView/native versions where available. Optional installer/WebView Java queries cannot discard basic app information.
3. **Saved failures appeared to describe the current attempt.** Failure notices persisted across updates without a historical label. They now say **Previous sign-in attempt** and disappear while a new attempt is running. Fresh errors stay visible beside the sign-in action.
4. **Secure UUID convenience API had no fallback.** Authentication host IDs, projects, sources and native request IDs used `crypto.randomUUID` directly. The secure fallback uses `crypto.getRandomValues`, correct UUID version/variant bits and no weak random source.

These are reproduced app compatibility/feedback bugs. They do not establish the cause of the physical phone's latest failure.

## Android connection check

The opt-in check compares a direct native HTTPS request with the full JavaScript/native adapter. It requests public OpenID metadata and signing keys, then sends an intentionally invalid fixture token request with no account credentials. Every probe has a 20-second deadline, closes native connections and handles cancellation.

The report contains fixed service labels, numeric HTTP status or allowlisted `RB-NET-…` codes, curated versions and three support flags. Raw exceptions, response bodies, callback URLs, account names, codes and tokens are excluded. An HTTP rejection from the dummy request establishes a responding endpoint, not eligible ChatGPT access.

## Validation

- 93 unit tests pass, including deadline/secure-ID fallbacks, failed and unanswered device queries, diagnostic control requests, redaction, read failures and cancellation of an unresponsive bridge.
- The production-bundle OAuth fixture covers success and failures with signal composition, timeout and UUID APIs removed, and native information unavailable. It also exercises the connection-check UI and report redaction. All seven UI scripts passed locally, including the combined legacy/missing-info case and visible diagnostic results.
- Formatting, ESLint, type checks, workflow lint, dependency/toolchain checks, 24 Electron-Node tests and production builds pass locally. The dependency audit reports zero vulnerabilities.
- Instrumented Android checks require public metadata, a real HTTP rejection from dummy authorization while a browser is open, all three fallback paths and the actual native connection report. They never sign in a real account. All those checks passed on stock Android 16 in [source CI 37631157855](https://github.com/Srimi1/research------bot/actions/runs/37631157855) on `f741d2b24eb938f698b48fa925ecbdbfb5850d56`. All six source CI jobs passed.
- The APK-only release mode preserves the signed-runtime publication gate. The optional upgrade gate installs the previously published signed APK, creates a synthetic project/notes, installs the new APK in place and verifies recovery after a cold restart.

The signed 0.3.8 APK was built and linted from that source commit. SHA-256, the existing signing certificate, package/version, SDK levels, source-input provenance and 16 KiB alignment passed local verification. Its SHA-256 is `df6362dad0964b43b91476123bbc781c1e655ba4dcef9883c985df0de32c46de` (4,772,011 bytes). The first [signed-release check](https://github.com/Srimi1/research------bot/actions/runs/37632416974) passed fresh launch/create/save/cold-restart. It then installed the upgrade but its PNG capture exceeded Node’s default 1 MiB buffer (`ENOBUFS`), preventing completion/publication. The screenshot capture now has a bounded 16 MiB buffer. The corrected [APK-only release run 37633791255](https://github.com/Srimi1/research------bot/actions/runs/37633791255) passed both the fresh signed-APK test and the 0.3.7 → 0.3.8 in-place upgrade with retained notes and a further cold restart. The upgrade test explicitly relaunches the app after installation, since Android stops the previous activity. Publication passed; desktop build/release jobs were skipped.

The published APK, `BUILD_INFO-android.json` and `SHA256SUMS-android.txt` were independently downloaded with HTTP 200 and matching GitHub digests/checksums. The downloaded APK passed signature/certificate, package/version, SDK levels and 16 KiB alignment checks. Both signed runtime checks are recorded as passed in the published metadata, which is copied back into `downloads/android/BUILD_INFO.json`. Device limits in that build snapshot precede the later screenshot below.

## Latest physical-device evidence

A later 0.3.7 screenshot shows `RB-AUTH-EXCHANGE-DNS` and Android System WebView `153.0.8010.36`. The maintainer reports the failure on both Wi-Fi and mobile data. The Java transport emits that fixed reason for `UnknownHostException`, so this attempt identifies an Android hostname-resolution failure. WebView 153 supports the optional APIs addressed above; those compatibility fixes do not explain this device attempt. No phone-specific resolver exception details or account credentials have been collected.

Browser consent reaches the provider, but browser reachability does not establish the app's resolver/network access. The next check compares the opt-in native HTTPS results while Research Bot is foregrounded with a fresh consent exchange. Foreground/background policy, per-app network restrictions and browser DNS behavior are hypotheses, not confirmed findings.

## Remaining validation

Physical OnePlus 7T Pro / Android 16 / Legion OS behavior and live ChatGPT sign-in, eligibility and inference remain unverified. Install 0.3.8 over the existing app, start fresh consent and, if it fails, report the new fixed error and copied connection results. Do not erase existing app data or share private callback URLs.
