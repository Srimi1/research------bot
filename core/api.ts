import { z } from 'zod';
import type { ResearchAPI } from '../src/shared/types';
import { markdownExport } from '../src/shared/export';
import { MAX_AGENT_INPUT, MAX_NOTES, MAX_QUESTION } from '../src/shared/limits';
import { safeExternal } from '../src/shared/external-url';
import type { AuthService } from './auth';
import type { Runner } from './runner';
import type { Store } from './store';

const id = z.string().uuid();
const text = z.string().max(100000);
const sourceSchema = z.object({
  id,
  title: z.string().min(1).max(2000),
  authors: z.array(z.string().max(1000)).max(200),
  year: z.string().max(50),
  url: z.string().url().max(3000),
  doi: z.string().max(500),
  category: z.enum(['article', 'report', 'forum', 'document']),
  inspected: z.enum(['metadata', 'abstract', 'full-text', 'user-added']),
  retrievedAt: z.string().max(100),
  abstract: text,
  query: text,
  method: text,
  findings: text,
  limitations: text,
  notes: text,
});
const stepSchema = z.object({
  id,
  title: text,
  purpose: text,
  output: text,
  dependsOn: text,
  check: text,
  done: z.boolean(),
});

export { safeExternal } from '../src/shared/external-url';

export interface ExportFile {
  name: string;
  kind: 'json' | 'markdown';
  content: string;
}

export interface ApiHost {
  store: Store;
  auth: AuthService;
  runner: Runner;
  /** Ask the researcher where to save, then write. */
  saveFile(file: ExportFile): Promise<{ saved: boolean; path?: string }>;
  /** Open an already validated public link outside the app. */
  openUrl(url: string): Promise<void>;
}

/** Every request the interface can make, validated the same way on every platform. */
export type Handlers = Omit<ResearchAPI, 'onRunEvent' | 'onDesktopAction' | 'checkSignInConnection'>;

export function createHandlers({ store, auth, runner, saveFile, openUrl }: ApiHost): Handlers {
  return {
    listProjects: async () => store.listProjects(),
    createProject: async input =>
      store.createProject(
        z.object({ title: z.string().trim().min(1).max(200), topic: z.string().max(500) }).parse(input),
      ),
    getProject: async value => store.getProject(id.parse(value)),
    saveProject: async input =>
      store.saveProject(
        z
          .object({
            id,
            title: z.string().trim().min(1).max(200),
            topic: z.string().max(500),
            question: z.string().max(MAX_QUESTION),
            notes: z.string().max(MAX_NOTES),
            version: z.number().int().nonnegative(),
          })
          .parse(input),
      ),
    deleteProject: async value => {
      const projectId = id.parse(value);
      runner.cancelProject(projectId);
      store.deleteProject(projectId);
    },
    saveSource: async (projectId, source) => {
      const parsed = sourceSchema.parse(source);
      safeExternal(parsed.url);
      return store.saveSource(id.parse(projectId), parsed);
    },
    deleteSource: async (projectId, sourceId) => store.deleteSource(id.parse(projectId), id.parse(sourceId)),
    saveSteps: async (projectId, steps) =>
      store.saveSteps(id.parse(projectId), z.array(stepSchema).max(200).parse(steps)),
    undoNotes: async value => store.undoNotes(id.parse(value)),
    redoNotes: async value => store.redoNotes(id.parse(value)),
    exportProject: async (value, format) => {
      const detail = store.getProject(id.parse(value));
      const kind = z.enum(['json', 'markdown']).parse(format);
      return saveFile({
        name: `${detail.project.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.${kind === 'json' ? 'json' : 'md'}`,
        kind,
        content: kind === 'json' ? JSON.stringify(detail, null, 2) : markdownExport(detail),
      });
    },
    account: () => auth.account(),
    signIn: () => auth.signIn(),
    cancelSignIn: async () => auth.cancelSignIn(),
    signOut: async () => {
      runner.stop();
      await auth.signOut();
      store.saveSettings({ ...store.getSettings(), model: '' });
    },
    models: () => auth.models(),
    getSettings: async () => store.getSettings(),
    saveSettings: async settings =>
      store.saveSettings(
        z
          .object({
            model: z.string().max(200),
            maxRequests: z.number().int().min(1).max(1000),
            autoUpdate: z.boolean(),
          })
          .parse(settings),
      ),
    run: input =>
      runner.run(
        z
          .object({
            projectId: id,
            role: z.enum(['methods', 'evidence', 'grammar', 'brainstorm']),
            text: z
              .string()
              .min(1)
              .max(MAX_AGENT_INPUT)
              .refine(value => Boolean(value.trim()), 'Enter a research question or passage.'),
            refresh: z.boolean().optional(),
          })
          .parse(input),
      ),
    cancelRun: async value => runner.cancel(id.parse(value)),
    openExternal: async value => openUrl(safeExternal(z.string().max(3000).parse(value))),
  };
}

/** IPC channel names used by the desktop preload, mapped to handler names. */
export const CHANNELS: Record<string, keyof Handlers> = {
  'projects:list': 'listProjects',
  'projects:create': 'createProject',
  'projects:get': 'getProject',
  'projects:save': 'saveProject',
  'projects:delete': 'deleteProject',
  'sources:save': 'saveSource',
  'sources:delete': 'deleteSource',
  'steps:save': 'saveSteps',
  'notes:undo': 'undoNotes',
  'notes:redo': 'redoNotes',
  'projects:export': 'exportProject',
  'auth:account': 'account',
  'auth:signin': 'signIn',
  'auth:cancel': 'cancelSignIn',
  'auth:signout': 'signOut',
  'auth:models': 'models',
  'settings:get': 'getSettings',
  'settings:save': 'saveSettings',
  'agents:run': 'run',
  'agents:cancel': 'cancelRun',
  'external:open': 'openExternal',
};
