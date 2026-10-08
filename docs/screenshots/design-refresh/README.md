# Design refresh review

Before and after captures use the same fictional campus food-waste project, saved sources, research plan and task history. No account credentials or private research content are included. The baseline is commit `02d9027adbd7259539ef3db05c94992cdd73d9f1` on `main`; the refreshed captures correspond to this feature branch.

Playwright Chromium rendered the browser preview at **1280 × 900**, **412 × 892** and **320 × 760**, with a device scale factor of 1. Screenshots capture the full page, so fixed phone navigation appears at the viewport's bottom within longer images. Screenshot capture finishes entrance animations and pauses ambient effects for a stable comparison; font and motion audits run separately with the requested media preferences.

| Screen   | Desktop 1280                                                                          | Phone 412                                                                       | Narrow phone 320                                                                  |
| -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Welcome  | [Before](before/desktop-1280-welcome.png) · [After](after/desktop-1280-welcome.png)   | [Before](before/phone-412-welcome.png) · [After](after/phone-412-welcome.png)   | [Before](before/narrow-320-welcome.png) · [After](after/narrow-320-welcome.png)   |
| Notes    | [Before](before/desktop-1280-notes.png) · [After](after/desktop-1280-notes.png)       | [Before](before/phone-412-notes.png) · [After](after/phone-412-notes.png)       | [Before](before/narrow-320-notes.png) · [After](after/narrow-320-notes.png)       |
| Evidence | [Before](before/desktop-1280-evidence.png) · [After](after/desktop-1280-evidence.png) | [Before](before/phone-412-evidence.png) · [After](after/phone-412-evidence.png) | [Before](before/narrow-320-evidence.png) · [After](after/narrow-320-evidence.png) |
| Sources  | [Before](before/desktop-1280-sources.png) · [After](after/desktop-1280-sources.png)   | [Before](before/phone-412-sources.png) · [After](after/phone-412-sources.png)   | [Before](before/narrow-320-sources.png) · [After](after/narrow-320-sources.png)   |
| Plan     | [Before](before/desktop-1280-plan.png) · [After](after/desktop-1280-plan.png)         | [Before](before/phone-412-plan.png) · [After](after/phone-412-plan.png)         | [Before](before/narrow-320-plan.png) · [After](after/narrow-320-plan.png)         |
| Settings | [Before](before/desktop-1280-settings.png) · [After](after/desktop-1280-settings.png) | [Before](before/phone-412-settings.png) · [After](after/phone-412-settings.png) | [Before](before/narrow-320-settings.png) · [After](after/narrow-320-settings.png) |

Additional captures show [loading](after/phone-412-loading.png), [320px notes with an 8px text boost](after/narrow-320-boosted-notes.png), and [the account sheet with the same boost](after/narrow-320-boosted-settings.png). Larger text intentionally adds wrapping; the navigation can grow to keep its labels separate and dialog actions wrap within the sheet.

## Verification

- `npm run lint`, `npm run format:check`, `npm test` (106 tests), `npm run build` (TypeScript, Vite and Electron), and the complete `npm run test:ui` suite pass. Existing layout assertions remain intact.
- Vite emits exactly four local Latin WOFF2 assets, normal and italic Inter/Fraunces, totaling 301,460 bytes (about 294 KiB). Their OFL notices ship under `dist/fonts/`.
- All 274 component font-size declarations use tokens. No numeric pixel font sizes or duplicate font stacks/palette literals remain outside `src/tokens.css`.
- Across the 38 final browser scenarios, visible text resolves to Inter/Fraunces and stays at least 11px, with no page overflow. Chrome's font inspection also confirms actual custom Inter/Fraunces glyphs on headings, controls and body text at every width.
- Notes, sources, plan and settings were checked under reduced motion at all three widths: no animations or transitions on elements or pseudo-elements, and no active document animations. Hover lifts, press feedback, skeletons, stagger delays and dismissed-card opacity were checked separately.

The compact [baseline audit](before/audit.json) and [final audit](after/audit.json) record the browser evidence. These captures verify browser rendering and the production-bundle smoke tests; native device rendering and live account services were not exercised by the screenshot fixture.
