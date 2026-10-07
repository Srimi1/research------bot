# Research Bot 0.4.0 signed test APK

[Download the verified signed test APK](https://github.com/Srimi1/research------bot/raw/refs/heads/codex/signed-qa-040/downloads/android/research-bot-0.4.0-android.apk).

This is the locally signed test build; official publication from main is pending correction of the GitHub Actions signing-secret value. Its app inputs match main. [BUILD_INFO.json](BUILD_INFO.json) identifies the actual local build source and the [SHA256SUMS.txt](SHA256SUMS.txt) checksum. The private key is outside Git.

Before changing from 0.3.x, export every project and verify your saved JSON/Markdown archives. Uninstalling deletes local projects and credentials; automatic project import is not available. Uninstall the old copy once, then install this new-key APK. Later APKs signed with the same new key update in place.

The APK passed [Android 16 fresh install, project and note persistence, and cold restart](https://github.com/Srimi1/research------bot/actions/runs/37661302546), with the accessibility connection first observing the launcher to exclude a stale app screen. All six [current main CI jobs](https://github.com/Srimi1/research------bot/actions/runs/37661146846) passed, including 103 unit tests, 75-second consent while the process remained a foreground service, Data Saver and interrupted-attempt recovery. These native checks use dummy credentials, not a live account.

On the OnePlus 7T Pro / Android 16 / Legion OS, sign in with ChatGPT and run one agent. Report only a fixed RB error if it fails. If Android repeatedly closes sign-in, set App info → Battery usage → Unrestricted. This phone result is the gate for Phase 2 multiple accounts and providers.
