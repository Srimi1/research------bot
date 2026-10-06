# Contributing to Research Bot

Use Node.js 24 and npm. Keep changes focused, preserve saved research data, and include reproduction steps for bug fixes. The [architecture guide](docs/architecture.md) explains the platform boundaries.

## Development

```sh
npm ci
npm run dev
# Browser preview, without desktop authentication:
npm run dev:web
```

Android additionally requires a full JDK 21 and Android SDK platform/build-tools 36. Configure `JAVA_HOME` and `ANDROID_HOME`, accept the SDK licenses, then run `npm run build:android` and `./gradlew --no-daemon assembleDebug lintDebug` from `android/`. See [android.md](docs/android.md).

## Checks

```sh
npm run format:check
npm run lint
npm audit --audit-level=high
npm run test:toolchain
npm test
npm run test:electron-node
npm run build
npx playwright install chromium
npm run test:ui
npm run test:electron
```

On headless Linux, use `xvfb-run -a npm run test:electron`. Playwright may require `npx playwright install --with-deps chromium` on a new machine. Set `CHROMIUM_PATH` when using an existing Chromium installation. Format changed source/documentation with Prettier; Android native sources are validated by Gradle and Android lint.

`npm run test:toolchain` exercises command parsing, Xcode UUID generation and actual local proxy routing for the dependency overrides in `package.json`. Keep these checks when updating the affected build packages. See the [audit report](docs/audits/2026-10-06.md) for why the overrides exist.

Use `npm run package` for an unpacked desktop build or `npm run dist` for the current OS's installer. Desktop package checks on other operating systems run in GitHub Actions.

## Pull requests

Explain the concrete problem, resulting behavior and relevant validation. Add a regression test for reproducible behavior or security bugs. For UI changes, check phone widths, larger text, focus, dialogs, the soft keyboard and reduced motion. Screenshots must use synthetic data and identify any mocked backend.

Do not commit signing keys, passwords, account credentials, personal research exports or local databases. Never replace the Android release key to work around an update failure. Report security issues through the process in [SECURITY.md](SECURITY.md).

The [audit skill](.agents/skills/research-bot-audit/SKILL.md) provides the maintainer's complete review checklist. A source commit or push does not itself publish a binary release or configure signing credentials.
