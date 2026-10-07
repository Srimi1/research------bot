import { App } from '@capacitor/app';
import { createHandlers, type Handlers } from '../../core/api';
import { AuthService } from '../../core/auth';
import { describeError } from '../../core/errors';
import { createEvidenceSearch } from '../../core/evidence';
import { Runner } from '../../core/runner';
import { Store } from '../../core/store';
import type { Account, ResearchAPI, RunEvent } from '../shared/types';
import { back } from '../back';
import { keystoreCredentials, nativeFetch, nativeFiles, nativeLoopback } from './adapters';
import { PersistentDatabase } from './database';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Native } from './native';
import { startAndroidUpdates } from './updater';
import shared from '../../agents/shared.md?raw';
import grammar from '../../agents/grammar-editor.md?raw';
import methods from '../../agents/methods-coach.md?raw';
import brainstorm from '../../agents/brainstorming-partner.md?raw';

const instructions: Record<string, string> = {
  'shared.md': shared,
  'grammar-editor.md': grammar,
  'methods-coach.md': methods,
  'brainstorming-partner.md': brainstorm,
};

const MIME = { json: 'application/json', markdown: 'text/markdown' } as const;

/**
 * The same backend as the desktop app (core/), running inside the Android WebView with native
 * networking, Keystore credentials and an on-device SQLite database.
 */
export function createAndroidAPI(): ResearchAPI {
  const listeners = new Set<(event: RunEvent) => void>();
  const device = Native.appInfo()
    .then(info => ({ appVersion: info.version, webviewVersion: info.webviewVersion }))
    .catch(() => undefined);
  const withDevice = async (operation: Promise<Account>): Promise<Account> => {
    const [account, info] = await Promise.all([operation, device]);
    return { ...account, ...(info ? { device: info } : {}) };
  };
  const ready = (async () => {
    const db = await PersistentDatabase.open(nativeFiles, wasmUrl);
    const store = new Store(db);
    store.failInterruptedRuns();
    await db.flush();
    const auth = new AuthService({
      fetch: nativeFetch,
      files: nativeFiles,
      openBrowser: url => Native.openUrl({ url }),
      credentials: keystoreCredentials,
      startLoopback: nativeLoopback,
    });
    const runner = new Runner(
      store,
      auth,
      file => {
        const text = instructions[file];
        if (text === undefined) throw new Error(`Missing agent instructions: ${file}`);
        return text;
      },
      event => listeners.forEach(listener => listener(event)),
      createEvidenceSearch(nativeFetch),
    );
    const handlers = createHandlers({
      store,
      auth,
      runner,
      saveFile: file => Native.saveFile({ name: file.name, mimeType: MIME[file.kind], content: file.content }),
      openUrl: url => Native.openUrl({ url }),
    });
    // Android may stop the app at any time once it is in the background, so write everything now.
    // A failed save is logged and retried by the database itself.
    const saveNow = () => void db.flush().catch(() => undefined);
    void App.addListener('pause', saveNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveNow();
    });
    void App.addListener('backButton', () => {
      if (!back()) void App.minimizeApp();
    });
    startAndroidUpdates(
      nativeFetch,
      () => store.getSettings().autoUpdate,
      message => console.warn(message),
    );
    return { handlers };
  })();

  const call =
    <K extends keyof Handlers>(name: K) =>
    async (...args: Parameters<Handlers[K]>): Promise<Awaited<ReturnType<Handlers[K]>>> => {
      const { handlers } = await ready.catch(error => {
        throw new Error(describeError(error));
      });
      try {
        // Changes reach the in-memory database now and the file shortly after (see database.ts).
        return await (handlers[name] as (...values: unknown[]) => any)(...args);
      } catch (error) {
        throw new Error(describeError(error));
      }
    };

  return {
    listProjects: call('listProjects'),
    createProject: call('createProject'),
    getProject: call('getProject'),
    saveProject: call('saveProject'),
    deleteProject: call('deleteProject'),
    saveSource: call('saveSource'),
    deleteSource: call('deleteSource'),
    saveSteps: call('saveSteps'),
    undoNotes: call('undoNotes'),
    redoNotes: call('redoNotes'),
    exportProject: call('exportProject'),
    account: () => withDevice(call('account')()),
    signIn: () => withDevice(call('signIn')()),
    cancelSignIn: call('cancelSignIn'),
    signOut: call('signOut'),
    models: call('models'),
    getSettings: call('getSettings'),
    saveSettings: call('saveSettings'),
    run: call('run'),
    cancelRun: call('cancelRun'),
    openExternal: call('openExternal'),
    onRunEvent: callback => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}
