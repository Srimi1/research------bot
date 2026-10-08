# Research Bot branding

<img src="../public/app-icon.png" alt="Research Bot app icon" width="160" />

The project uses its existing book, magnifying-glass and leaf artwork. This update preserves the repository's artwork. The repository's MIT license is unchanged; no new third-party brand assets were added.

## Assets

| Asset                                                    | Purpose                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| `public/app-icon.png`                                    | Current app artwork, README logo, Linux/Electron runtime icon     |
| `public/favicon.png`                                     | Browser favicon                                                   |
| `public/apple-touch-icon.png`                            | Browser home-screen icon                                          |
| `build/icon.ico`                                         | Windows installer/app icon                                        |
| `build/icon.icns`                                        | macOS app icon                                                    |
| `android/app/src/main/res/mipmap-*`                      | Square, round and adaptive Android launcher assets                |
| `build/icon.svg`, `build/icon.png`, `public/favicon.svg` | Legacy vector artwork; `npm run icon` renders the legacy PNG only |
| `docs/screenshots/`                                      | Synthetic phone UI previews used in the README                    |

Android assets are generated from `public/app-icon.png` with `npm run icon:android` (Playwright Chromium required). Desktop packaging selects the files configured in `package.json`; changing the legacy SVG alone does not update the current artwork or the Windows/macOS files.

## Interface

The interface uses a forest-green and ivory palette with role accents, readable text and generous controls. `src/MobileEnhancements.tsx` contains the decorative welcome artwork and real project progress; it does not generate fake research findings. Prompt shortcuts prepare editable text; they never send an assistant request automatically.

### Design tokens

`src/tokens.css` is the single source for the look. `src/styles.css` and `src/mobile.css` only reference its tokens; do not add raw font sizes, font families, radii, shadows, palette colors or durations to those files.

### Type

| Role                | Family                    | Token            |
| ------------------- | ------------------------- | ---------------- |
| Interface and body  | Inter (variable)          | `--font-sans`    |
| Headings and titles | Fraunces (variable, opsz) | `--font-display` |

Both fonts are bundled from `@fontsource-variable` (SIL Open Font License), Latin subset only, so desktop and Android work offline and inside the content security policy.

| Token         | Desktop | Phone | Typical use                |
| ------------- | ------- | ----- | -------------------------- |
| `--text-2xs`  | 11px    | 12px  | Badges, counters, eyebrows |
| `--text-xs`   | 12px    | 13px  | Meta lines, helper text    |
| `--text-sm`   | 13px    | 14px  | Secondary text, labels     |
| `--text-base` | 14px    | 15px  | Body, buttons, inputs      |
| `--text-md`   | 16px    | 16px  | Card titles, phone inputs  |
| `--text-lg`   | 18px    | 18px  | Section titles             |
| `--text-xl`   | 22px    | 22px  | Screen titles              |
| `--text-2xl`  | 28px    | 28px  | Page headings              |
| `--text-3xl`  | 34px    | 34px  | Large headings             |
| `--text-4xl`  | 42px    | 42px  | Display                    |
| `--text-5xl`  | 52px    | 52px  | Welcome display            |

Line heights are `--leading-tight` (1.2) through `--leading-loose` (1.9). Letter spacing is `--tracking-tight`, `--tracking-snug`, `--tracking-normal` and `--tracking-wide` (uppercase eyebrows). Weights are `--weight-regular`, `--weight-medium` and `--weight-semibold`.

### Motion

Durations are `--dur-fast` (150ms, hover and press), `--dur-base` (220ms, dialogs, toasts, state changes) and `--dur-slow` (340ms, screen and list entrances). Easings are `--ease-out`, `--ease-in-out` and `--ease-spring` (small confirmations only). Lists stagger by `--stagger` (40ms) per item, capped at the eighth item.

- Screens, tabs and results rise in; lists arrive one item after another.
- Dialogs scale in on desktop and slide up as a sheet on phones; the phone drawer eases open.
- A soft shimmer runs while an assistant works or a project loads.
- Buttons give under a press, primary buttons and cards lift on hover (pointer devices only).
- Fields ease into their focus ring; finished plan steps and dismissed ideas fade to their new state.

All animations and transitions are disabled when the system requests reduced motion. On Android this includes turning off animations in the accessibility or developer settings.

The screenshots were rendered in a browser at phone dimensions. Project/source content is synthetic and the Android welcome account state is mocked. They illustrate the design without establishing real-device or live-authentication behavior.
