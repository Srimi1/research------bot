# Android 0.4.2 fresh production installation

The 0.4.2 fresh production APK uses package `com.researchbot.android.fresh` and appears as **Research Bot 0.4.2**. It is a signed release build with debugging disabled, rather than the development-signed APK Test application.

It can be installed alongside the existing `com.researchbot.android` app. Existing projects and credentials remain in that app; the fresh app starts with separate local storage. It does not perform an in-place upgrade or automatically import old projects. Keep the existing app installed to retain access to its data.

This distribution has an independent release certificate pinned in `android/fresh-release-signing-certificate.sha256`. The original 0.4.0 certificate remains pinned in `android/release-signing-certificate.sha256`. The private production keystore and credentials are backed up outside Git in the managed workspace; no private signing material is committed or attached to a release.

To reproduce a compatible build, select that saved signing profile and run `npm run android:apk:fresh`. The command generates the Capacitor plugin files, verifies the actual private key against the fresh certificate, and packages the production app. Its default legacy release command retains the original application identity and certificate requirements.

The prebuilt release workflow verifies APK bytes, source provenance, signature, package, version, SDK levels, disabled debugging and alignment. On Android 16 it creates a project and notes in the existing 0.4.0 app, installs and tests the fresh production app, and then checks the original project's notes again. Publication can remain disabled while the verified assets are uploaded to a draft.

Live ChatGPT authorization/inference and the physical OnePlus 7T Pro / Legion OS remain separate validation limits.
