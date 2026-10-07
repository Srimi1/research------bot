# Research Bot on your Mac

Research Bot is a full desktop research workspace. The Mac edition includes the same local SQLite backend as Windows and Linux, with a wider notes/assistant workspace, native menus, standard text editing, macOS file-save dialogs and Keychain-backed protection for ChatGPT credentials.

## Download and install

Open [the 0.3.6 release](https://github.com/Srimi1/research------bot/releases/tag/v0.3.6) and choose the DMG that matches **Apple menu → About This Mac**:

| Your Mac                               | Installer                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Apple Silicon: M1, M2, M3, M4 or later | [Apple Silicon DMG](https://github.com/Srimi1/research------bot/releases/download/v0.3.6/research-bot-0.3.6-mac-arm64.dmg) |
| Intel processor                        | [Intel DMG](https://github.com/Srimi1/research------bot/releases/download/v0.3.6/research-bot-0.3.6-mac-x64.dmg)           |

Use macOS 13 or later. Both installers are built and tested on macOS 15; older supported systems and physical MacBooks still need verification.

1. Open the DMG and drag **Research Bot** to **Applications**.
2. Eject the mounted installer and open Research Bot from Applications.
3. This beta is **ad hoc signed**, without an Apple Developer ID certificate or notarization. If macOS blocks it, follow [Apple's instructions for opening an app from an unidentified developer](https://support.apple.com/en-us/102445): after attempting to open it, visit **System Settings → Privacy & Security → Open Anyway** and confirm the specific app. Keep the Mac's general security settings enabled.

Checksums are attached as `SHA256SUMS-mac-arm64.txt` and `SHA256SUMS-mac-x64.txt`. Download the corresponding file alongside the DMG and run this from that folder:

```sh
shasum -a 256 -c SHA256SUMS-mac-arm64.txt  # Apple Silicon
# or
shasum -a 256 -c SHA256SUMS-mac-x64.txt    # Intel
```

## Do your research

- Create separate projects, refine a research question, keep autosaved notes and undo/redo saved revisions.
- Use **Evidence finder** to search Crossref scholarly metadata without an account. Open the original sources before citing them; record methods, findings, limitations and reading notes in the source library.
- Build and edit a research plan, mark steps complete and review the history of assistant tasks.
- Connect an eligible ChatGPT account through the system browser to use the methods coach, brainstorming partner and grammar editor. Account eligibility and live inference are still unverified. Review suggestions before applying them to your notes.
- Export the active project as Markdown or JSON through **File → Export Project…**. The native save dialog lets you choose a folder. Exports contain project work, sources, plans and task history, and exclude credentials.

The assistants are coordinated research roles; the app does not bundle an offline AI model. Source search and AI requests need internet access. Local notes and plans work offline.

## Mac controls

| Shortcut          | Action                                                      |
| ----------------- | ----------------------------------------------------------- |
| ⌘N                | New research project                                        |
| ⌘S                | Save current notes                                          |
| ⌘⇧E               | Choose an export format                                     |
| ⌘,                | Account and preferences                                     |
| ⌘1 / ⌘2 / ⌘3 / ⌘4 | Notes and assistants / source library / plan / task history |
| ⌘+ / ⌘− / ⌘0      | Enlarge / reduce / reset the interface                      |
| ⌘Q                | Quit                                                        |

Standard editing commands apply to the focused text field. The workspace's undo/redo buttons restore **saved note revisions**, which is separate from ordinary text editing. Closing the Mac window keeps the app running; click its Dock icon to reopen the same session. Use Quit to exit.

## Your data and updates

Projects are stored locally in `~/Library/Application Support/research-bot/research.sqlite`. ChatGPT credentials are encrypted separately using Electron's macOS Keychain-backed `safeStorage`. Research content itself does not have additional app-level encryption. Android and Mac projects do not synchronize automatically; there is currently no project-import UI.

Mac automatic updates stay off until a Developer ID signed release is configured. To update this beta, quit Research Bot and replace its app in Applications with the newer release. Replacing the app keeps its user-data directory. Export valuable projects before changing installations.

## Build and verify

On a Mac with Node.js 24:

```sh
npm ci
npm run build
npx electron-builder --mac dmg --arm64 --publish never  # Apple Silicon
# or: npx electron-builder --mac dmg --x64 --publish never
node scripts/macos-dmg-smoke.mjs release/research-bot-0.3.6-mac-arm64.dmg
```

Use the matching architecture for the runtime test. CI mounts each actual DMG, copies out its application, verifies the executable's architecture and icon, then launches the packaged app to check native menus, project creation, note persistence, revision undo/redo, plans, export controls, Dock reopening and interruption recovery. This validates research workflows on GitHub's Mac runners; it does not establish live ChatGPT access or notarization.

For Developer ID distribution, replace the beta's `mac.identity: "-"` setting, enable the hardened runtime with suitable Electron entitlements, configure signing/notarization credentials and validate the resulting downloaded app separately before enabling Mac updates.
