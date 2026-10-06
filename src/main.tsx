import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { browserAPI } from './browser-api';
import { platform } from './platform';
import { watchKeyboard } from './keyboard';
import './styles.css';
import './mobile.css';

async function start() {
  // Desktop: the Electron preload already set window.research. Android loads its backend on demand
  // so the desktop and browser bundles do not carry SQLite or the native bridge.
  if (platform === 'android') window.research = (await import('./android/api')).createAndroidAPI();
  else if (platform === 'browser') window.research = browserAPI;
  watchKeyboard();
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void start();
