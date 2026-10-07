# Android sign-in investigation prompt

Copy this prompt when continuing the unresolved Android DNS investigation. The reported phone failure is from 0.3.7; the published 0.3.8 APK adds connection diagnostics and has passed signed startup and upgrade checks. Physical-phone sign-in remains unconfirmed.

```text
Fix the Android ChatGPT sign-in problem in this repository:
https://github.com/Srimi1/research------bot

Limit work to the Android APK.

Device: OnePlus 7T Pro, Android 16 with Legion OS, 12 GB RAM, 256 GB storage. The failing installed app is Research Bot 0.3.7; Android System WebView is 153.0.8010.36.

I want to connect my eligible ChatGPT subscription. Browser sign-in and consent open, but the app fails to connect. Earlier attempts showed RB-AUTH-EXCHANGE-NETWORK. The latest screenshot shows:
“Android could not resolve the ChatGPT token server. Check your connection and private DNS settings. [RB-AUTH-EXCHANGE-DNS]”

The failure happens on both Wi-Fi and mobile data. No VPN, ad blocker, firewall or custom Private DNS is enabled. A fresh sign-in fails, so this is not merely a saved error from an earlier attempt.

The repository now includes 0.3.8 compatibility fixes and an optional “Check connection” diagnostic. Stock Android tests can reach public identity endpoints and receive a rejected dummy token response; those tests do not establish successful sign-in on my phone. WebView 153 supports the newer APIs, so do not assume missing WebView APIs explain this DNS failure.

Trace the OAuth callback and native HTTPS/DNS path. Compare connection results while the app is foregrounded with token exchange during browser consent. Investigate resolver behavior, app permissions and foreground/background network restrictions; reproduce the cause before choosing a fix.

Preserve PKCE, state, nonce, verified TLS/identity and encrypted credential storage. Keep existing projects and notes. Do not collect or publish account tokens, authorization codes or private callback URLs.

Fix the confirmed cause, add focused regression coverage, and test the actual APK on Android 16, including startup, note persistence, cold restart and upgrading the previous signed APK. Clearly distinguish emulator results from physical-phone confirmation. Build with the existing signing key, commit and push the changes, publish the signed APK on GitHub Releases, and provide its direct download link with the diagnosis and validation results.
```
