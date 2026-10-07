---
name: research-bot-audit
description: Audit Research Bot from top to bottom, verify and fix bugs, improve repository presentation, and publish tested changes when the user requests it.
---

# Research Bot audit

Use this skill when the maintainer asks for a complete audit of this repository. The workflow reflects their stated preference: review everything from top to bottom, reproduce problems, fix confirmed bugs, make the repository professional, and commit and push the completed work when requested.

## Start with the current state

1. Read applicable `AGENTS.md`, `SECURITY.md`, the README and package scripts.
2. Record the source commit, working branch, existing changes and repository permissions. Preserve the maintainer's work, including earlier changes in the session.
3. Establish the supported platforms, data flows and validation limits. Separate observed behavior from documentation claims.
4. Check whether the user authorized fixes, commits, pushes or releases. Follow that authorization without repeatedly asking. An audit alone does not authorize publishing or sending messages.

## Review everything from top to bottom

Cover each surface and record evidence or an explicit limit:

- Product workflows: project creation, switching and deletion; notes and undo/redo; source discovery and reading notes; plans; assistant review; cancellation; import/export where implemented.
- Android UX: phone layouts, safe areas, touch targets, contrast, dialogs, navigation, keyboard behavior, screen-reader labels and reduced motion.
- Persistence: schema migration, project isolation, concurrent edits, atomic writes, interruption recovery, failed saves and bounded history.
- Authentication: system-browser OAuth, PKCE, state and nonce, verified tokens, refresh, cancellation, sign-out, protected credential storage and redaction.
- Network boundaries: allowed protocols and destinations, response limits, redirects, timeouts, external links and untrusted source/model content.
- Desktop/native adapters: preload and IPC restrictions, renderer isolation, native permissions, files, callbacks and exported components.
- Updates and releases: versioning, package identity, checksums, signing certificates, installer permissions, CI workflows and build artifacts.
- Dependencies: inspect the entire dependency audit, including development/build tooling. Trace real use before describing exploitability. Avoid forced major changes or blanket overrides without compatibility evidence.
- Repository quality: installation instructions, architecture, known limitations, branding provenance, screenshots, contribution guide, security reporting, license and ignored secrets/build files.

Read the implementations and their callers, not only search results. Inventory files so omitted surfaces are visible. Tests and a dependency scanner are evidence, not proof that the whole app is secure.

## Verify before fixing

For each candidate, document the trigger, affected file/function, expected and actual behavior, impact and confidence. Reproduce it with a focused test or UI workflow when feasible. Check a legitimate control and relevant boundary cases. Keep unverified hypotheses out of confirmed findings.

Fix the narrowest shared boundary that addresses the root cause. Preserve data and authentication/security controls. Add regression coverage for meaningful bugs; do not add tests that merely repeat the implementation. Recheck direct callers, the Android and desktop variants, and any equivalent input forms.

## Validate the completed change

Use the relevant repository checks:

```sh
npm ci
npm run format:check
npm run lint
npm audit --audit-level=high
npm run test:toolchain
npm test
npm run test:electron-node
npm run build
npm run test:ui
xvfb-run -a npm run test:electron  # headless Linux
npm run build:android
cd android && ./gradlew --no-daemon assembleDebug lintDebug
```

Install Playwright Chromium if needed. Android builds require Node.js 24, a full JDK 21 and Android SDK 36. Release APKs must use the existing signing key; never commit keys, passwords, account tokens or personal research data. A browser fixture does not establish real-device behavior or live ChatGPT eligibility.

Before accepting Android readiness, test the production Android backend under the shipped CSP and install the actual APK on an Android runtime. Verify native launch, project creation, note saving and a cold restart; keep emulator evidence separate from physical-device results. Signed releases must pass the actual APK runtime test before publication.

Inspect the final diff, scan staged files for secrets, and record each command's result. Fix failed relevant checks before publishing. Explain blocked checks and remaining validation limits honestly.

## Make the result professional and reviewable

Write a dated audit report with scope, confirmed findings, fixes, validation, unresolved items and coverage. Update documentation to describe the current implementation, using diagrams and verified setup commands where useful. Reuse the project's approved logos and icons; document their locations and provenance. Screenshots must contain synthetic content and identify any mocked account or backend.

When the user has requested publication, create clear commits, check the current remote head, and push without overwriting remote work. Follow branch protections; use a pull request if required. Never force-push to bypass a rejected update. Report the commit, branch and GitHub link. Publishing a binary release or changing repository secrets requires authorization for that separate action.
