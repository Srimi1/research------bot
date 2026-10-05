# Research Bot

A personal research workspace for sustainability and any other subject. You lead the research; specialist AI agents help you improve grammar, find evidence, explore ideas, learn methods, and turn rough thoughts into a practical plan.

## Project status

The local desktop beta is implemented: persistent research projects, four role workflows, source discovery, literature notes, editable plans, grammar suggestion review, task cancellation, and export. The official ChatGPT sign-in flow is implemented and tested with mocked protocol responses. **Live account sign-in and AI-output fidelity still require validation with your eligible ChatGPT account.**

## Run locally

Install Node.js 24 and npm, then run:

```sh
npm ci
npm run dev
```

In Settings, choose **Continue with ChatGPT**, authorize eligible plan usage in the system browser, and select a model from your account's catalog. An OS keychain is required for credential storage; Linux plaintext keyring fallback is rejected. Scholarly source discovery works without AI sign-in.

```sh
npm run format    # Prettier (CI runs format:check)
npm run lint      # ESLint (TypeScript and React Hooks rules)
npm test          # Backend and protocol regression tests
npm run test:ui   # Browser workflows; install Playwright Chromium first if needed
npm run test:electron       # Drives the real desktop app (use xvfb-run on headless Linux)
npm run test:electron-node  # SQLite tests inside Electron's bundled Node
npm run build    # Type check and production bundles
npm run package  # Unpacked desktop application for the current OS
npm run dist     # Installer for the current OS
```

For a browser preview, run `npm run dev:web`. This preview stores projects in the browser and supports scholarly search, editing, and export. ChatGPT sign-in is available in the desktop app. Browser and desktop data are separate. See [implementation and validation notes](docs/implementation.md) for current limitations.

## Your research team

| Agent | What it helps with | Boundary |
| --- | --- | --- |
| Grammar editor | Correct grammar, spelling, and punctuation in your writing | Preserve vocabulary, meaning, voice, and claims; never add ideas |
| Evidence finder | Search scholarly metadata (Crossref) for articles and reports; you add documents and forum discussions yourself; organize a literature-review matrix | Provide traceable sources; never invent citations or imply it read inaccessible full text |
| Brainstorming partner | Explore questions, alternative explanations, and possible directions | Mark suggestions as ideas, not established findings |
| Methods coach and planner | Teach research methods and turn rough thoughts into an ordered plan | Explain choices and limitations; leave research decisions to you |

Each suggestion is reviewable. Your original notes remain intact until you accept a change. Agents run only when requested, with visible progress and a cancellation control.

## ChatGPT sign-in

The app uses the official Sign in with ChatGPT flow and eligible ChatGPT plan usage. It does not ask you to copy ChatGPT cookies or session tokens. Account eligibility and a successful real sign-in must be verified with your account.

OpenAI currently documents plan usage for local/open-source apps; paid or remotely hosted distribution requires a separate eligibility review. Ordinary API billing is separate from a ChatGPT subscription. See the [authentication decision](docs/authentication.md) before choosing a provider.

## Project documents

- [Product specification](docs/product-spec.md)
- [Architecture proposal](docs/architecture.md)
- [Authentication decision and official references](docs/authentication.md)
- [Implementation roadmap and acceptance checks](docs/roadmap.md)
- [Agent instructions](agents/README.md)

Source repository: [Srimi1/research------bot](https://github.com/Srimi1/research------bot). The project uses the repository's [MIT license](LICENSE). Linux desktop builds are available under [Releases](https://github.com/Srimi1/research------bot/releases).
