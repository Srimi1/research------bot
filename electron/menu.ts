import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { DesktopAction } from '../src/shared/types';

/** macOS menus use standard editing/window roles and send a fixed set of research actions. */
export function installMacMenu(window: BrowserWindow): void {
  const action = (label: string, command: DesktopAction, accelerator: string): MenuItemConstructorOptions => ({
    id: `research-${command}`,
    label,
    accelerator,
    click: () => {
      if (window.isDestroyed()) return;
      window.show();
      window.focus();
      window.webContents.send('desktop:action', command);
    },
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          action('Preferences…', 'preferences', 'Command+,'),
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          action('New Research Project…', 'new-project', 'Command+N'),
          action('Save Notes', 'save', 'Command+S'),
          action('Export Project…', 'export', 'Command+Shift+E'),
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'Research',
        submenu: [
          action('Notes & Assistants', 'workspace', 'Command+1'),
          action('Source Library', 'library', 'Command+2'),
          action('Research Plan', 'plan', 'Command+3'),
          action('Task History', 'history', 'Command+4'),
        ],
      },
      {
        label: 'View',
        submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }],
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          {
            label: 'Research Bot Guide',
            click: () => void shell.openExternal('https://github.com/Srimi1/research------bot/blob/main/docs/macos.md'),
          },
        ],
      },
    ]),
  );
}
