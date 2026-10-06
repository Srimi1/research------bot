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

The interface uses a forest-green and ivory palette with role accents, readable text and generous controls. `src/mobile.css` contains phone layout and animation adjustments. `src/MobileEnhancements.tsx` contains the decorative welcome artwork and real project progress; it does not generate fake research findings.

Animations are short and disabled or reduced when the user requests reduced motion. Prompt shortcuts prepare editable text; they never send an assistant request automatically.

The screenshots were rendered in a browser at phone dimensions. Project/source content is synthetic and the Android welcome account state is mocked. They illustrate the design without establishing real-device or live-authentication behavior.
