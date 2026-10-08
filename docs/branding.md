# Research Bot branding

<img src="../public/app-icon.png" alt="Research Bot app icon" width="160" />

The project uses its existing book, magnifying-glass and leaf artwork. The design refresh preserves this original artwork and the forest-green and ivory palette. The repository's MIT license is unchanged. Inter and Fraunces are bundled third-party fonts, each licensed under the SIL Open Font License; their license notices ship in `public/fonts/`.

## Assets

| Asset                                                         | Purpose                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `public/app-icon.png`                                         | Current app artwork, README logo, Linux/Electron runtime icon     |
| `public/favicon.png`                                          | Browser favicon                                                   |
| `public/apple-touch-icon.png`                                 | Browser home-screen icon                                          |
| `build/icon.ico`                                              | Windows installer/app icon                                        |
| `build/icon.icns`                                             | macOS app icon                                                    |
| `android/app/src/main/res/mipmap-*`                           | Square, round and adaptive Android launcher assets                |
| `build/icon.svg`, `build/icon.png`, `public/favicon.svg`      | Legacy vector artwork; `npm run icon` renders the legacy PNG only |
| `docs/screenshots/`                                           | Synthetic phone UI previews used in the README                    |
| `public/fonts/OFL-Inter.txt`, `public/fonts/OFL-Fraunces.txt` | License notices for the bundled interface fonts                   |

Android assets are generated from `public/app-icon.png` with `npm run icon:android` (Playwright Chromium required). Desktop packaging selects the files configured in `package.json`; changing the legacy SVG alone does not update the current artwork or the Windows/macOS files.

## Shared interface system

Electron, Android WebView and the browser use the same design tokens in `src/tokens.css`. Import tokens first, then `src/fonts.css`, `src/styles.css`, `src/mobile.css` and `src/motion.css`. Keep responsive layout rules in `src/mobile.css`; consume the shared typography and palette there without defining a separate phone font stack or colors.

The interface retains its layouts, readable text and generous controls. `src/MobileEnhancements.tsx` contains the decorative welcome artwork and real project progress; it does not generate fake research findings. Prompt shortcuts prepare editable text; they never send an assistant request automatically.

### Typography

Use **Inter** for body text, controls, labels and captions through `--font-sans`. Use **Fraunces** for headings and display text through `--font-display`, with `font-optical-sizing: auto`. Inter falls back to system sans-serif fonts; Fraunces falls back to Georgia and serif fonts if a glyph is unavailable.

The variable fonts come from the `@fontsource-variable/inter` and `@fontsource-variable/fraunces` development dependencies. `src/fonts.css` explicitly selects only their Latin standard normal and italic WOFF2 files; importing Fontsource's default stylesheet would include additional subsets. Vite emits these four local assets under `dist/assets`, so the fonts work offline in Electron and Android and use the existing CSP's `default-src 'self'`. No external font service is contacted. The fonts retain variable weight and optical-size axes.

Every font size in the interface consumes this scale. The phone values apply at widths up to 720px. Line heights are unitless multipliers.

| Size token    | Desktop | Phone | Line-height token | Line height |
| ------------- | ------- | ----- | ----------------- | ----------- |
| `--text-2xs`  | 11px    | 14px  | `--leading-2xs`   | 1.5         |
| `--text-xs`   | 12px    | 15px  | `--leading-xs`    | 1.5         |
| `--text-sm`   | 13px    | 16px  | `--leading-sm`    | 1.6         |
| `--text-base` | 15px    | 17px  | `--leading-base`  | 1.7         |
| `--text-md`   | 17px    | 19px  | `--leading-md`    | 1.6         |
| `--text-lg`   | 20px    | 20px  | `--leading-lg`    | 1.4         |
| `--text-xl`   | 24px    | 24px  | `--leading-xl`    | 1.3         |
| `--text-2xl`  | 30px    | 30px  | `--leading-2xl`   | 1.2         |
| `--text-3xl`  | 38px    | 38px  | `--leading-3xl`   | 1.18        |

The minimum desktop size is 11px. Phone tokens include `--text-boost: 3px` for `2xs`, `xs` and `sm`, and `--text-boost-large: 2px` for `base` and `md`. Individual rules consume the size token directly; they must not add the boost again. Larger headings retain their desktop sizes.

Reusable text roles define the common combinations. Existing component selectors use the same values, so adopting these classes does not require rearranging markup.

| Role         | Family   | Size          | Weight | Tracking             |
| ------------ | -------- | ------------- | ------ | -------------------- |
| `.t-display` | Fraunces | `--text-3xl`  | 400    | `--tracking-display` |
| `.t-title`   | Fraunces | `--text-2xl`  | 400    | `--tracking-tight`   |
| `.t-heading` | Fraunces | `--text-lg`   | 400    | `--tracking-tight`   |
| `.t-body`    | Inter    | `--text-base` | 400    | `--tracking-normal`  |
| `.t-label`   | Inter    | `--text-sm`   | 600    | `--tracking-normal`  |
| `.t-caption` | Inter    | `--text-2xs`  | 400    | `--tracking-normal`  |

Use `--weight-regular` (400), `--weight-medium` (500) and `--weight-semibold` (600). Tracking tokens are `--tracking-display` (-0.04em), `--tracking-tight` (-0.03em), `--tracking-normal` (0), `--tracking-wide` (0.04em), `--tracking-label` (0.08em) and `--tracking-caps` (0.12em). Use wider tracking for short uppercase labels, with normal tracking for body copy.

### Color, spacing and surfaces

Define palette colors once in `src/tokens.css`. The core colors are forest green `--green` (#254b3d), ivory `--paper` (#fffefb), canvas `--canvas` (#faf9f6), text `--text` (#29372f) and muted text `--muted` (#5e665a). Shared tokens also cover borders, hover and selected states, focus, scrims and semantic success, warning, danger, information and violet accents. Agent roles select their ink and tint from these same colors on every platform.

| Tokens                                      | Values                                  |
| ------------------------------------------- | --------------------------------------- |
| `--space-1` through `--space-8`             | 4, 8, 12, 16, 20, 24, 32 and 48px       |
| `--radius-sm`, `--radius-md`, `--radius-lg` | 6, 10 and 16px                          |
| `--radius-xl`, `--radius-pill`              | 24px and 999px                          |
| `--shadow-1`                                | Light elevation for small surfaces      |
| `--shadow-2`                                | Raised cards and hover feedback         |
| `--shadow-3`                                | Dialogs and prominent floating surfaces |

Use the shared focus, navigation and drawer shadow tokens for those specific surfaces. Preserve layout-specific dimensions where they serve the existing layout; choose a spacing, radius, color or shadow token whenever its role fits.

### Calm motion

`src/motion.css` defines motion for every platform. Use `--dur-fast` (120ms) for direct feedback, `--dur-base` (220ms) for fades and dialogs, and `--dur-slow` (360ms) for screen entrances and sheets. Use `--ease-out` for arrivals, `--ease-in-out` for continuous effects and `--ease-spring` for the navigation indicator and small spring accents. Avoid animating every property with `transition: all`.

- Screens and tabs fade in with a slight rise. List items use a `--i` index for a 40ms stagger, capped at index 6 (240ms) so long lists appear promptly.
- Buttons scale to 0.97 while pressed. Cards lift 2px with `--shadow-2` only on devices supporting hover; touch users receive press feedback.
- Dialog backdrops fade in. Desktop dialog panels use `pop-in`; phone sheets use `sheet-up`. Toasts retain their centered `toast-in` entrance, retimed to the shared duration.
- The bottom navigation indicator retains its spring movement through the shared timing and easing tokens.
- Content loading uses decorative shimmer skeletons with adjacent status text. Keep the small `spin` animation for inline loaders. Shimmer and spin use 1200ms cycles; ambient decorative motion uses 4500ms.
- Under `prefers-reduced-motion: reduce`, the global rules in `src/styles.css` disable **all** animations and transitions, including pseudo-elements. Phone-specific rules and `src/motion.css` also suppress navigation, hover and press movement. Scrolling becomes immediate. Loading shapes and text remain visible without animation.

### Review screenshots

The README's original phone previews use synthetic project/source content and a mocked Android welcome account state. The design-refresh screenshots use the browser preview with fictional research data. Browser captures illustrate the design without establishing real-device or live-authentication behavior.

Design-refresh comparisons live in the [screenshot review](screenshots/design-refresh/README.md), using the same synthetic fixture at 1280px desktop, 412px phone and 320px narrow phone widths. Compare the `before/` and `after/` versions of each screen. Screenshots document appearance; build, UI smoke tests, computed fonts and reduced-motion checks provide separate verification.
