# Withdrawn Android 0.4.2 separate-app distribution

The old 0.4.2 APK used `com.researchbot.android.fresh` and its own signing key and storage. It installed a second app and did not meet the requirement to update the existing Research Bot app. It has been withdrawn from public releases and active repository downloads.

Its successful startup and saved-note tests verified the separate app. They did not verify an in-place update of `com.researchbot.android`. The independent private key cannot sign an update accepted by the original app, even if the package name is changed.

Corrected source retains the original package and certificate and rejects the former production build flag. The independent key and withdrawn APK remain backed up privately for audit and for safeguarding any data created in that app; they are not used as a fallback for regular release signing.

Keep the original app and its projects. See the [update correction audit](audits/2026-10-10-android-update-correction.md). A compatible production update requires recovery of the original private signing key.
