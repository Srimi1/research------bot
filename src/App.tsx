import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  Leaf,
  Lightbulb,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Redo2,
  Search,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type {
  Account,
  ConnectionDiagnostics,
  AgentResult,
  GrammarEdit,
  GrammarResult,
  MethodsResult,
  PlanStep,
  Project,
  ProjectDetail,
  Role,
  Settings,
  Source,
} from './shared/types';
import { isBrowserPreview, platform } from './platform';
import { onBack } from './back';
import { buildAgentInput } from './shared/agent-input';
import { MAX_NOTES, MAX_QUESTION } from './shared/limits';
import { ProjectOverview, WelcomeArtwork } from './MobileEnhancements';
import { randomId } from '../core/platform';
import { version as appVersion } from '../package.json';

const api = () => window.research;
const roles: { id: Role; title: string; label: string; description: string; icon: typeof BookOpen; action: string }[] =
  [
    {
      id: 'methods',
      title: 'Methods coach',
      label: 'Plan your approach',
      description: 'Turn a rough thought into a clear question and a research plan you understand.',
      icon: FlaskConical,
      action: 'Explore research methods',
    },
    {
      id: 'evidence',
      title: 'Evidence finder',
      label: 'Follow the evidence',
      description: 'Find candidate articles, open the originals, and decide what belongs in your research.',
      icon: Search,
      action: 'Find sources',
    },
    {
      id: 'brainstorm',
      title: 'Brainstorming',
      label: 'Make room for possibilities',
      description: 'Explore alternative explanations, useful connections, and questions worth asking.',
      icon: Lightbulb,
      action: 'Explore ideas',
    },
    {
      id: 'grammar',
      title: 'Grammar review',
      label: 'Your words, a little clearer',
      description: 'Review only grammar, spelling, and punctuation. Accept each correction yourself.',
      icon: FileText,
      action: 'Review grammar',
    },
  ];
const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const signature = (p: Project) => JSON.stringify([p.title, p.topic, p.question, p.notes]);
const MATRIX_LABELS = {
  method: 'Method / setting',
  findings: 'Key findings',
  limitations: 'Limitations',
  notes: 'Your reading notes',
} as const;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const uid = randomId;

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useRef(`dialog-${uid()}`);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>('input,button,textarea,select')?.focus(),
    );
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const elements = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]',
          ) || [],
        );
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', listener);
    const removeBack = onBack(() => closeRef.current());
    return () => {
      cancelAnimationFrame(frame);
      removeBack();
      document.removeEventListener('keydown', listener);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        ref={ref}
      >
        <div className="modal-heading">
          <h2 id={titleId.current}>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ProjectForm({
  project,
  onSubmit,
  onClose,
  onDelete,
}: {
  project?: Project;
  onSubmit: (title: string, topic: string) => Promise<void>;
  onClose: () => void;
  /** Offered in the details form so phones, which hide the section tabs, can still delete a project. */
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(project?.title || '');
  const [topic, setTopic] = useState(project?.topic || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title={project ? 'Project details' : 'Start a research project'} onClose={onClose}>
      <p className="muted">A working title is enough. You can refine your question as you go.</p>
      <form
        onSubmit={async event => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            await onSubmit(title, topic);
            onClose();
          } catch (error) {
            setError(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field-label" htmlFor="project-title">
          Project title
        </label>
        <input
          id="project-title"
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder="e.g. Food waste on campus"
          maxLength={200}
          required
          autoComplete="off"
        />
        <label className="field-label" htmlFor="project-topic">
          Topic <span className="muted">· optional</span>
        </label>
        <input
          id="project-topic"
          value={topic}
          onChange={event => setTopic(event.target.value)}
          placeholder="e.g. Sustainability"
          maxLength={200}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {onDelete && (
            <button type="button" className="text-button danger modal-delete" onClick={onDelete} disabled={busy}>
              <Trash2 size={15} />
              Delete project
            </button>
          )}
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !title.trim()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
            {project ? 'Save details' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AccountSettings({
  account,
  setAccount,
  onClose,
  autoSignIn = false,
}: {
  account: Account | null;
  setAccount: (account: Account) => void;
  onClose: () => void;
  /** Start ChatGPT sign-in as soon as the dialog opens (from a "Sign in with ChatGPT" button). */
  autoSignIn?: boolean;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connection, setConnection] = useState<ConnectionDiagnostics | null>(null);
  const connectionController = useRef<AbortController | null>(null);
  useEffect(() => () => connectionController.current?.abort(), []);
  useEffect(() => {
    let mounted = true;
    Promise.allSettled([
      api().getSettings(),
      account?.signedIn ? api().models() : Promise.resolve([] as string[]),
    ]).then(([preferences, catalog]) => {
      if (!mounted) return;
      const available = catalog.status === 'fulfilled' ? catalog.value : [];
      setModels(available);
      if (preferences.status === 'fulfilled')
        setSettings({
          ...preferences.value,
          model: available.includes(preferences.value.model) ? preferences.value.model : '',
        });
      else setError(errorText(preferences.reason));
      if (catalog.status === 'rejected') setError(errorText(catalog.reason));
    });
    return () => {
      mounted = false;
    };
  }, [account?.signedIn]);
  const signIn = async () => {
    setSigning(true);
    setConnection(null);
    setError('');
    setMessage('Your browser will open for ChatGPT sign-in.');
    try {
      const next = await api().signIn();
      setAccount(next);
      const catalog = next.signedIn ? await api().models() : [];
      setModels(catalog);
      const preferences = await api().getSettings();
      setSettings({ ...preferences, model: catalog.includes(preferences.model) ? preferences.model : '' });
      setMessage(next.signedIn ? 'Your ChatGPT account is connected.' : next.message || 'Sign-in has not completed.');
    } catch (error) {
      setMessage('');
      setError(errorText(error));
      // The backend retains safe sign-in diagnostics across dialog closure and app restarts.
      try {
        setAccount(await api().account());
      } catch {
        /* Keep the original sign-in error visible. */
      }
    } finally {
      setSigning(false);
    }
  };
  const signingRef = useRef(false);
  signingRef.current = signing;
  // Closing the dialog any way (Close, Escape, the Android back gesture) ends a sign-in still waiting
  // on the browser, so a later "Sign in with ChatGPT" starts fresh instead of reporting a busy sign-in.
  useEffect(
    () => () => {
      if (signingRef.current)
        void api()
          .cancelSignIn()
          .catch(() => undefined);
    },
    [],
  );
  const signInRef = useRef(signIn);
  signInRef.current = signIn;
  const autoStarted = useRef(false);
  useEffect(() => {
    // StrictMode runs effects twice in development; sign-in must still start only once.
    if (!autoSignIn || autoStarted.current || account?.signedIn || isBrowserPreview) return;
    autoStarted.current = true;
    void signInRef.current();
  }, [autoSignIn, account?.signedIn]);
  return (
    <Modal title="Account & preferences" onClose={onClose}>
      <div className="account-box">
        <div className="account-mark">
          <Sparkles size={22} />
        </div>
        <div>
          <strong>
            {account?.signedIn ? account.name || account.email || 'ChatGPT connected' : 'Connect your ChatGPT account'}
          </strong>
          <p className="muted">
            {account?.signedIn
              ? account.email || 'Requests use your eligible ChatGPT plan.'
              : isBrowserPreview
                ? 'Use your eligible plan with the desktop or Android app.'
                : 'Sign in through your browser to use your eligible ChatGPT plan.'}
          </p>
        </div>
        {account?.signedIn && <span className="tag green">Connected</span>}
      </div>
      {!signing && account?.message && account.message !== error && (
        <p className="callout">
          {account.message.includes('[RB-AUTH-') && (
            <>
              <strong>Previous sign-in attempt</strong>
              <br />
            </>
          )}
          {account.message}
        </p>
      )}
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {platform === 'android' && (
        <p className="help">
          Research Bot {appVersion} · Android System WebView {account?.device?.webviewVersion || 'unavailable'}
          {account?.device?.nativeVersion && account.device.nativeVersion !== appVersion && (
            <> · Installed APK {account.device.nativeVersion}</>
          )}
        </p>
      )}
      <div className="account-actions">
        {account?.signedIn ? (
          <button
            className="button secondary"
            disabled={busy || checkingConnection}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await api().signOut();
                setAccount(await api().account());
                setMessage('Signed out of ChatGPT.');
              } catch (error) {
                setError(errorText(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Sign out
          </button>
        ) : signing ? (
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await api().cancelSignIn();
                setMessage('Sign-in cancelled.');
              } catch (error) {
                setError(errorText(error));
              }
            }}
          >
            Cancel sign-in
          </button>
        ) : (
          <button className="button primary" onClick={signIn} disabled={isBrowserPreview || checkingConnection}>
            <Sparkles size={16} />
            Continue with ChatGPT
          </button>
        )}
        {signing && (
          <span className="muted inline">
            <LoaderCircle className="spin" size={16} />
            Waiting for sign-in…
          </span>
        )}
        {platform === 'android' && (
          <button
            className="button secondary"
            disabled={busy || signing || checkingConnection}
            onClick={async () => {
              const check = api().checkSignInConnection;
              if (!check) return;
              const controller = new AbortController();
              connectionController.current = controller;
              setCheckingConnection(true);
              setConnection(null);
              setMessage('');
              try {
                const result = await check(controller.signal);
                if (!controller.signal.aborted) setConnection(result);
              } catch {
                if (!controller.signal.aborted) setError('The connection check could not complete. Try again.');
              } finally {
                if (!controller.signal.aborted) setCheckingConnection(false);
              }
            }}
          >
            {checkingConnection ? <LoaderCircle className="spin" size={16} /> : <CircleHelp size={16} />}
            {checkingConnection ? 'Checking connection…' : 'Check connection'}
          </button>
        )}
        {platform === 'android' &&
          !signing &&
          api().openAppSettings &&
          `${error} ${account?.message ?? ''}`.includes('RB-AUTH-INTERRUPTED') && (
            <button
              className="button secondary"
              onClick={() =>
                void api()
                  .openAppSettings?.()
                  .catch(() => setError('Android settings could not be opened.'))
              }
            >
              Battery settings
            </button>
          )}
      </div>
      {connection && (
        <div className="callout" role="status">
          <strong>Sign-in connection check</strong>
          <p className="help">
            Uses public endpoints and a dummy token request. No account credentials are sent. An HTTP 4xx reply to the
            dummy request means the token server is reachable.
          </p>
          <ul>
            {connection.checks.map(check => (
              <li key={check.service}>
                {check.service}: {check.result}
              </li>
            ))}
          </ul>
          <p className="help">
            WebView support: signal composition {connection.features.signalAny ? 'built in' : 'fallback'}, request
            timeout {connection.features.signalTimeout ? 'built in' : 'fallback'}, secure IDs{' '}
            {connection.features.randomUuid ? 'built in' : 'fallback'}.
          </p>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(JSON.stringify(connection, null, 2));
                setMessage('Connection results copied. They contain no account credentials.');
              } catch {
                setMessage('Copy is unavailable. You can report the result codes shown here.');
              }
            }}
          >
            <Copy size={16} />
            Copy connection results
          </button>
        </div>
      )}
      <div className="divider" />
      <h3>Agent preferences</h3>
      {settings && (
        <>
          <label className="field-label" htmlFor="model">
            Model
          </label>
          <select
            id="model"
            value={settings.model}
            disabled={!account?.signedIn || !models.length}
            onChange={event => setSettings({ ...settings, model: event.target.value })}
          >
            <option value="">Choose an available model</option>
            {models.map(model => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          {!models.length && <p className="help">Models become available after successful sign-in.</p>}
          <label className="field-label" htmlFor="requests">
            AI requests per app session
          </label>
          <input
            id="requests"
            type="number"
            min="1"
            max="1000"
            value={settings.maxRequests}
            onChange={event => setSettings({ ...settings, maxRequests: Number(event.target.value) })}
          />
          <p className="help">
            A limit of 1–1,000 bounds AI requests until the app restarts. Only your selected agent runs; source searches
            do not use this allowance.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.autoUpdate}
              disabled={isBrowserPreview}
              onChange={event => setSettings({ ...settings, autoUpdate: event.target.checked })}
            />
            Check for updates automatically
          </label>
          <p className="help">
            {platform === 'android'
              ? 'Downloads new versions of Research Bot from its GitHub Releases page, checks they are signed by the same key, and asks before installing.'
              : 'Downloads new versions of Research Bot from its GitHub Releases page and asks before restarting.'}{' '}
            Only the app version is checked; nothing about your research is sent.
          </p>
        </>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Close
        </button>
        <button
          className="button primary"
          disabled={!settings || busy || signing}
          onClick={async () => {
            if (!settings) return;
            setBusy(true);
            setError('');
            try {
              await api().saveSettings(settings);
              setMessage('Preferences saved.');
            } catch (error) {
              setError(errorText(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Save preferences
        </button>
      </div>
    </Modal>
  );
}

function ManualSource({ onClose, onSave }: { onClose: () => void; onSave: (source: Source) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState('');
  const [category, setCategory] = useState<Source['category']>('article');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Add a source" onClose={onClose}>
      <p className="muted">Save an article, report, document, or forum you found yourself.</p>
      <form
        onSubmit={async event => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const parsed = new URL(url);
            if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Use an HTTP or HTTPS link.');
            await onSave({
              id: uid(),
              title: title.trim(),
              url: parsed.href,
              authors: authors
                .split(',')
                .map(author => author.trim())
                .filter(Boolean),
              year,
              doi: '',
              category,
              inspected: 'user-added',
              retrievedAt: new Date().toISOString(),
              abstract: '',
              query: 'Added by researcher',
              method: '',
              findings: '',
              limitations: '',
              notes: '',
            });
            onClose();
          } catch (error) {
            setError(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field-label" htmlFor="source-title">
          Title
        </label>
        <input
          id="source-title"
          required
          maxLength={1000}
          value={title}
          onChange={event => setTitle(event.target.value)}
        />
        <label className="field-label" htmlFor="source-url">
          Original source URL
        </label>
        <input
          id="source-url"
          type="url"
          required
          value={url}
          placeholder="https://…"
          onChange={event => setUrl(event.target.value)}
        />
        <label className="field-label" htmlFor="source-author">
          Authors or organization <span className="muted">· optional, comma separated</span>
        </label>
        <input id="source-author" value={authors} onChange={event => setAuthors(event.target.value)} />
        <div className="form-columns">
          <div>
            <label className="field-label" htmlFor="source-year">
              Year
            </label>
            <input id="source-year" value={year} maxLength={20} onChange={event => setYear(event.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="source-kind">
              Source category
            </label>
            <select
              id="source-kind"
              value={category}
              onChange={event => setCategory(event.target.value as Source['category'])}
            >
              {['article', 'report', 'document', 'forum'].map(kind => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !title.trim()}>
            <Plus size={16} />
            Save source
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SourceResult({
  source,
  saved,
  onSave,
  onOpen,
}: {
  source: Source;
  saved: boolean;
  onSave: (source: Source) => Promise<void>;
  onOpen: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [abstract, setAbstract] = useState(false);
  return (
    <article className="source-result">
      <div className="source-meta">
        <span className="eyebrow">{source.category}</span>
        <span>
          {source.year || 'Undated'} · {source.inspected === 'metadata' ? 'Metadata match' : source.inspected}
        </span>
      </div>
      <button className="source-title" onClick={() => onOpen(source.url)}>
        {source.title}
        <ExternalLink size={14} />
      </button>
      <p className="source-author">
        {source.authors.slice(0, 3).join(', ') || 'Author not listed'}
        {source.authors.length > 3 ? ' et al.' : ''}
      </p>
      {source.abstract && (
        <>
          <button className="text-button" onClick={() => setAbstract(!abstract)}>
            {abstract ? 'Hide' : 'View'} supplied abstract
            <ChevronDown size={14} />
          </button>
          {abstract && <p className="abstract">{source.abstract}</p>}
        </>
      )}
      <div className="source-footer">
        <button className="text-button" onClick={() => onOpen(source.url)}>
          Open original
          <ArrowRight size={14} />
        </button>
        <button
          className={`button small ${saved ? 'saved-button' : 'secondary'}`}
          disabled={saved || busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await onSave(source);
            } catch (error) {
              setError(errorText(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {saved ? <Check size={14} /> : busy ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}
          {saved ? 'In your library' : 'Save source'}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

function MatrixRow({
  source,
  onSave,
  onDelete,
  onOpen,
}: {
  source: Source;
  onSave: (source: Source) => Promise<void>;
  onDelete: (id: string) => void;
  onOpen: (url: string) => void;
}) {
  const [draft, setDraft] = useState(source);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(source) !== JSON.stringify(draft);
  useEffect(() => {
    setDraft(source);
  }, [source]);
  return (
    <tr>
      <td className="matrix-source" data-label="Source & provenance">
        <span className="tag">{source.category}</span>
        <button className="source-title" onClick={() => onOpen(source.url)}>
          {source.title}
          <ExternalLink size={12} />
        </button>
        <p className="source-author">
          {source.authors.slice(0, 2).join(', ') || 'Author not listed'} · {source.year || 'Undated'}
        </p>
        <span className="help">
          {source.inspected} · retrieved {date(source.retrievedAt)}
        </span>
        <div className="row-actions">
          <button
            className="text-button"
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onSave(draft);
              } catch (error) {
                setError(errorText(error));
              } finally {
                setBusy(false);
              }
            }}
            disabled={!dirty || busy}
          >
            {busy ? 'Saving…' : dirty ? 'Save notes' : 'Saved'}
            {!dirty && <Check size={12} />}
          </button>
          <button
            className="icon-button danger-hover"
            aria-label={`Remove ${source.title}`}
            onClick={() => onDelete(source.id)}
          >
            <Trash2 size={14} />
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </td>
      {(['method', 'findings', 'limitations', 'notes'] as const).map(field => (
        <td key={field} data-label={MATRIX_LABELS[field]}>
          <textarea
            disabled={busy}
            aria-label={`${field} for ${source.title}`}
            value={draft[field]}
            onChange={event => setDraft({ ...draft, [field]: event.target.value })}
            placeholder={
              field === 'notes'
                ? 'Your reading notes, inclusion decisions, and page references…'
                : 'Not recorded. Add after reading the source…'
            }
          />
        </td>
      ))}
    </tr>
  );
}

function StepEditor({
  step,
  index,
  count,
  onChange,
  onMove,
  onDelete,
}: {
  step: PlanStep;
  index: number;
  count: number;
  onChange: (step: PlanStep) => Promise<void>;
  onMove: (direction: number) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(step);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(step);
  }, [step]);
  return (
    <article className={`plan-card ${step.done ? 'done' : ''}`}>
      <div className="plan-heading">
        <button
          className="step-check"
          aria-label={`${step.done ? 'Mark incomplete' : 'Complete'}: ${step.title}`}
          aria-pressed={step.done}
          onClick={async () => {
            try {
              await onChange({ ...step, done: !step.done });
            } catch (error) {
              setError(errorText(error));
            }
          }}
        >
          {step.done && <Check size={14} />}
        </button>
        <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
        <button className="plan-title" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {step.title}
          <ChevronDown className={expanded ? 'rotate' : ''} size={16} />
        </button>
        <div className="step-controls">
          <button className="icon-button" aria-label="Move step up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Move step down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown size={15} />
          </button>
        </div>
      </div>
      <p className="plan-purpose">{step.purpose}</p>
      {expanded ? (
        <div className="step-form">
          {(['title', 'purpose', 'output', 'dependsOn', 'check'] as const).map(field => (
            <label className="field-label" key={field}>
              {
                {
                  title: 'Step title',
                  purpose: 'Why this matters',
                  output: 'Expected output',
                  dependsOn: 'Dependencies',
                  check: 'Completion check',
                }[field]
              }
              <textarea
                value={draft[field]}
                onChange={event => setDraft({ ...draft, [field]: event.target.value })}
                rows={field === 'title' ? 1 : 2}
              />
            </label>
          ))}
          <div className="source-footer">
            <button className="text-button danger" onClick={onDelete}>
              <Trash2 size={14} />
              Remove step
            </button>
            <button
              className="button small primary"
              disabled={busy || JSON.stringify(draft) === JSON.stringify(step)}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await onChange(draft);
                } catch (error) {
                  setError(errorText(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save step
            </button>
          </div>
        </div>
      ) : (
        <div className="plan-output">
          <span>Expected output</span>
          <p>{step.output}</p>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

function GrammarReview({
  result,
  currentNotes,
  onApply,
}: {
  result: GrammarResult;
  currentNotes: string;
  onApply: (notes: string) => void;
}) {
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  function proposal(ids: Set<string>) {
    let text = result.original;
    result.edits
      .filter(edit => ids.has(edit.id))
      .sort((a, b) => b.start - a.start)
      .forEach(edit => {
        text = text.slice(0, edit.start) + edit.after + text.slice(edit.end);
      });
    return text;
  }
  const expected = proposal(accepted);
  const stale = expected !== currentNotes;
  const accept = (edit: GrammarEdit) => {
    const next = new Set(accepted).add(edit.id);
    onApply(proposal(next));
    setAccepted(next);
  };
  return (
    <div className="grammar-output">
      <p className="result-intro">
        Corrections stay separate until you accept them. Review each correction to check that it preserves your meaning.
      </p>
      {result.clarification && (
        <div className="callout">
          <CircleHelp size={17} />
          <p>{result.clarification}</p>
        </div>
      )}
      {stale && (
        <p className="callout warning">
          These notes changed after the review. Run a new review before applying corrections.
        </p>
      )}
      {!result.edits.length ? (
        <div className="good-state">
          <CheckCheck size={24} />
          <h3>No corrections proposed</h3>
          <p>Your notes have been left unchanged.</p>
        </div>
      ) : (
        <>
          <div className="result-label">
            {result.edits.length} proposed correction{result.edits.length === 1 ? '' : 's'}
          </div>
          {result.edits.map(edit => (
            <article
              className={`edit-card ${accepted.has(edit.id) || rejected.has(edit.id) ? 'reviewed' : ''}`}
              key={edit.id}
            >
              <div className="edit-diff">
                <del>{edit.before || '(insert)'}</del>
                <ArrowRight size={14} />
                <ins>{edit.after || '(remove)'}</ins>
              </div>
              <p>{edit.reason}</p>
              <div className="edit-actions">
                {accepted.has(edit.id) ? (
                  <span className="tag green">
                    <Check size={12} />
                    Accepted
                  </span>
                ) : rejected.has(edit.id) ? (
                  <span className="tag">Dismissed</span>
                ) : (
                  <>
                    <button
                      className="button small secondary"
                      disabled={stale}
                      onClick={() => setRejected(new Set(rejected).add(edit.id))}
                    >
                      Dismiss
                    </button>
                    <button className="button small primary" disabled={stale} onClick={() => accept(edit)}>
                      <Check size={13} />
                      Accept correction
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </>
      )}
    </div>
  );
}

function MethodsReview({
  result,
  existingSteps,
  onQuestion,
  onPlan,
}: {
  result: MethodsResult;
  existingSteps: PlanStep[];
  onQuestion: (question: string) => void;
  onPlan: (steps: PlanStep[]) => Promise<void>;
}) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const included = result.steps.every(step => existingSteps.some(existing => existing.id === step.id));
  const complete = accepted || included;
  return (
    <>
      <p className="result-intro">{result.explanation}</p>
      <div className="suggested-question">
        <span className="eyebrow">Suggested question</span>
        <p>{result.question}</p>
        <button className="text-button" onClick={() => onQuestion(result.question)}>
          Use this research question
          <ArrowRight size={14} />
        </button>
      </div>
      {result.assumptions.length > 0 && (
        <details className="assumptions">
          <summary>Assumptions to check</summary>
          <ul>
            {result.assumptions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      <h3 className="result-subheading">Methods to consider</h3>
      {result.options.map((option, index) => (
        <article className="method-option" key={index}>
          <h4>{option.name}</h4>
          <p>{option.rationale}</p>
          <p className="help">
            <strong>Limitations:</strong> {option.limitations}
          </p>
        </article>
      ))}
      <div className="result-subheading-row">
        <h3>A possible next path</h3>
        <span className="muted">{result.steps.length} steps</span>
      </div>
      <ol className="suggested-steps">
        {result.steps.map(step => (
          <li key={step.id}>
            <strong>{step.title}</strong>
            <p>{step.purpose}</p>
            <span>Output: {step.output}</span>
            {step.dependsOn && <span>Depends on: {step.dependsOn}</span>}
            {step.check && <span>Complete when: {step.check}</span>}
          </li>
        ))}
      </ol>
      <button
        className="button primary full-width"
        disabled={busy || complete}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await onPlan(result.steps);
            setAccepted(true);
          } catch (error) {
            setError(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {complete ? <Check size={16} /> : <Plus size={16} />}
        {complete ? 'Added to your plan' : existingSteps.length ? 'Add proposed steps to plan' : 'Accept this plan'}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function BrainstormReview({
  result,
  onAccept,
}: {
  result: Extract<AgentResult, { kind: 'brainstorm' }>;
  onAccept: (text: string) => void;
}) {
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  return (
    <>
      <p className="callout">
        <Lightbulb size={17} />
        <span>These are possibilities to investigate. They are not established findings.</span>
      </p>
      {result.ideas.map((idea, index) => (
        <article className={`idea-card ${dismissed.has(index) ? 'dismissed' : ''}`} key={index}>
          <span className="eyebrow">Possibility {String(index + 1).padStart(2, '0')}</span>
          <h3>{idea.title}</h3>
          <p>{idea.explanation}</p>
          <dl>
            <dt>Assumptions</dt>
            <dd>{idea.assumptions}</dd>
            <dt>Evidence needed</dt>
            <dd>{idea.evidenceNeeded}</dd>
            <dt>A next step</dt>
            <dd>{idea.nextStep}</dd>
          </dl>
          <div className="edit-actions">
            {accepted.has(index) ? (
              <span className="tag green">
                <Check size={12} />
                Saved to your notes
              </span>
            ) : dismissed.has(index) ? (
              <span className="tag">Dismissed</span>
            ) : (
              <>
                <button className="button small secondary" onClick={() => setDismissed(new Set(dismissed).add(index))}>
                  Dismiss
                </button>
                <button
                  className="button small primary"
                  onClick={() => {
                    onAccept(
                      `Idea to investigate: ${idea.title}\n${idea.explanation}\nAssumptions: ${idea.assumptions}\nEvidence needed: ${idea.evidenceNeeded}\nNext step: ${idea.nextStep}`,
                    );
                    setAccepted(new Set(accepted).add(index));
                  }}
                >
                  <Plus size={13} />
                  Save idea to notes
                </button>
              </>
            )}
          </div>
        </article>
      ))}
    </>
  );
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const detailRef = useRef<ProjectDetail | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [role, setRole] = useState<Role>('methods');
  // 'assistants' is the research desk with the agents in front. Phones show notes and agents as
  // separate screens; on wider windows both views show the whole desk.
  const [view, setView] = useState<'workspace' | 'assistants' | 'library' | 'plan' | 'history'>('workspace');
  const showView = (next: typeof view) => {
    setView(next);
    setExportOpen(false);
    if (window.matchMedia('(max-width: 720px)').matches) window.scrollTo({ top: 0 });
  };
  const [creating, setCreating] = useState(false);
  const [newProjectRole, setNewProjectRole] = useState<Role | null>(null);
  const [editingProject, setEditingProject] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState<false | 'preferences' | 'signin'>(false);
  const signInPrompt = !isBrowserPreview && account !== null && !account.signedIn;
  const [addingSource, setAddingSource] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [taskInput, setTaskInput] = useState('');
  const [activeRun, setActiveRun] = useState<{ id?: string; projectId: string; role: Role; message: string } | null>(
    null,
  );
  const activeRef = useRef<typeof activeRun>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  useEffect(() => (mobileSidebar ? onBack(() => setMobileSidebar(false)) : undefined), [mobileSidebar]);
  const versions = useRef(new Map<string, number>());
  const saved = useRef(new Map<string, string>());
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadNumber = useRef(0);
  const navigating = useRef(false);
  const stepsQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [undoBusy, setUndoBusy] = useState(false);
  const currentRole = roles.find(item => item.id === role)!;
  const updateDetail = useCallback((update: (detail: ProjectDetail) => ProjectDetail) => {
    if (!detailRef.current) return;
    const next = update(detailRef.current);
    detailRef.current = next;
    setDetail(next);
  }, []);
  const openDetail = (next: ProjectDetail) => {
    detailRef.current = next;
    setDetail(next);
    versions.current.set(next.project.id, next.project.version);
    saved.current.set(next.project.id, signature(next.project));
    setSaveState('saved');
    setSelectedRun(null);
    setTaskInput('');
  };
  const persist = useCallback(async () => {
    const snapshot = detailRef.current?.project;
    if (!snapshot) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const job = saveQueue.current
      .catch(() => {})
      .then(async () => {
        if (saved.current.get(snapshot.id) === signature(snapshot)) return;
        if (detailRef.current?.project.id === snapshot.id) setSaveState('saving');
        const result = await api().saveProject({
          id: snapshot.id,
          title: snapshot.title,
          topic: snapshot.topic,
          notes: snapshot.notes,
          question: snapshot.question,
          version: versions.current.get(snapshot.id) ?? snapshot.version,
        });
        versions.current.set(snapshot.id, result.version);
        saved.current.set(snapshot.id, signature(result));
        setProjects(previous => previous.map(project => (project.id === result.id ? result : project)));
        if (detailRef.current?.project.id === result.id) {
          updateDetail(current => ({
            ...current,
            project: { ...current.project, version: result.version, updatedAt: result.updatedAt },
          }));
          setSaveState(signature(detailRef.current!.project) === signature(result) ? 'saved' : 'unsaved');
        }
      });
    saveQueue.current = job;
    return job;
  }, [updateDetail]);
  const changeProject = (patch: Partial<Pick<Project, 'title' | 'topic' | 'notes' | 'question'>>) => {
    updateDetail(current => ({ ...current, project: { ...current.project, ...patch } }));
    setSaveState('unsaved');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      persist().catch(error => {
        setError(errorText(error));
        setSaveState('unsaved');
      });
    }, 900);
  };
  useEffect(() => {
    let mounted = true;
    Promise.allSettled([api().listProjects(), api().account()]).then(async results => {
      if (!mounted) return;
      const [projectResult, accountResult] = results;
      if (accountResult.status === 'fulfilled') setAccount(accountResult.value);
      else setError(errorText(accountResult.reason));
      if (projectResult.status === 'fulfilled') {
        setProjects(projectResult.value);
        if (projectResult.value.length) {
          try {
            const next = await api().getProject(projectResult.value[0].id);
            if (mounted) openDetail(next);
          } catch (error) {
            if (mounted) setError(errorText(error));
          }
        }
      } else setError(errorText(projectResult.reason));
      if (mounted) setLoading(false);
    });
    const unsubscribe = api().onRunEvent(event => {
      const current = activeRef.current;
      if (!current || event.projectId !== current.projectId) return;
      if (current.id && current.id !== event.runId) return;
      const next = {
        ...current,
        id: event.runId,
        message: event.type === 'status' ? event.text : 'Receiving a response…',
      };
      activeRef.current = next;
      setActiveRun(next);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      const current = detailRef.current?.project;
      if (current && saved.current.get(current.id) !== signature(current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        persist().catch(error => setError(errorText(error)));
      }
    };
    // Phones rarely unload a page; they hide it and may stop the app later. Save on the way out.
    const hidden = () => {
      if (document.visibilityState === 'hidden') persist().catch(error => setError(errorText(error)));
    };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('keydown', keyboard);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('keydown', keyboard);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [persist]);
  useEffect(
    () =>
      api().onDesktopAction?.(action => {
        if (loading || (action !== 'save' && document.querySelector('[role="dialog"]'))) return;
        if (action === 'save') void persist().catch(error => setError(errorText(error)));
        else if (action === 'new-project') {
          setNewProjectRole(null);
          setCreating(true);
        } else if (action === 'preferences') setSettingsOpen('preferences');
        else if (detailRef.current) {
          if (action === 'export') setExportOpen(true);
          else {
            setView(action);
            setExportOpen(false);
          }
        }
      }),
    [loading, persist],
  );
  const selectProject = async (id: string) => {
    if (id === detailRef.current?.project.id) {
      setMobileSidebar(false);
      return;
    }
    if (navigating.current) return;
    navigating.current = true;
    setLoading(true);
    const attempt = ++loadNumber.current;
    try {
      await persist();
      const next = await api().getProject(id);
      if (attempt !== loadNumber.current) return;
      openDetail(next);
      setView('workspace');
      setMobileSidebar(false);
      setError('');
    } catch (error) {
      setError(errorText(error));
    } finally {
      navigating.current = false;
      if (attempt === loadNumber.current) setLoading(false);
    }
  };
  const saveSource = async (source: Source) => {
    const id = detailRef.current?.project.id;
    if (!id) return;
    const result = await api().saveSource(id, source);
    if (detailRef.current?.project.id === id)
      updateDetail(current => ({
        ...current,
        sources: current.sources.some(item => item.id === result.id)
          ? current.sources.map(item => (item.id === result.id ? result : item))
          : [...current.sources, result],
      }));
  };
  const saveSteps = async (steps: PlanStep[]) => {
    const current = detailRef.current;
    if (!current) return;
    const id = current.project.id;
    const previous = current.steps;
    updateDetail(detail => ({ ...detail, steps }));
    const job = stepsQueue.current.catch(() => {}).then(() => api().saveSteps(id, steps));
    stepsQueue.current = job;
    try {
      await job;
    } catch (error) {
      if (detailRef.current?.project.id === id && JSON.stringify(detailRef.current.steps) === JSON.stringify(steps))
        updateDetail(detail => ({ ...detail, steps: previous }));
      throw error;
    }
  };
  const open = async (url: string) => {
    try {
      await api().openExternal(url);
    } catch (error) {
      setError(errorText(error));
    }
  };
  const startRun = async () => {
    const current = detailRef.current;
    if (!current || activeRef.current) return;
    const selectedRole = role;
    let input;
    try {
      input = buildAgentInput(selectedRole, {
        question: current.project.question,
        notes: current.project.notes,
        taskInput,
      });
    } catch (error) {
      setError(errorText(error));
      return;
    }
    const text = input.text;
    const active = { projectId: current.project.id, role: selectedRole, message: 'Saving your notes…' };
    activeRef.current = active;
    setActiveRun(active);
    try {
      await persist();
    } catch (error) {
      setError(errorText(error));
      activeRef.current = null;
      setActiveRun(null);
      return;
    }
    setError('');
    setSelectedRun(null);
    if (input.notice) setNotice(input.notice);
    try {
      const result = await api().run({ projectId: current.project.id, role: selectedRole, text });
      if (detailRef.current?.project.id === current.project.id) {
        updateDetail(detail => ({ ...detail, runs: [result, ...detail.runs.filter(run => run.id !== result.id)] }));
        if (result.status === 'completed') setSelectedRun(result.id);
      }
    } catch (error) {
      setError(errorText(error));
    } finally {
      activeRef.current = null;
      setActiveRun(null);
      setCancelBusy(false);
    }
  };
  const cancelActiveRun = async () => {
    const current = activeRef.current;
    if (!current?.id || cancelBusy) return;
    setCancelBusy(true);
    try {
      await api().cancelRun(current.id);
    } catch (error) {
      setError(errorText(error));
      setCancelBusy(false);
    }
  };
  const moveThroughNotes = async (direction: 'undo' | 'redo') => {
    const id = detailRef.current?.project.id;
    if (!id) return;
    setUndoBusy(true);
    try {
      await persist();
      const result = await (direction === 'undo' ? api().undoNotes(id) : api().redoNotes(id));
      versions.current.set(result.id, result.version);
      saved.current.set(result.id, signature(result));
      if (detailRef.current?.project.id === result.id) {
        updateDetail(current => ({ ...current, project: result }));
        setSaveState('saved');
      }
      setProjects(current => current.map(item => (item.id === result.id ? result : item)));
      setNotice(
        direction === 'undo'
          ? 'Restored the previous saved notes. Redo brings back what you had.'
          : 'Brought back the notes you had before undoing.',
      );
    } catch (error) {
      setError(errorText(error));
    } finally {
      setUndoBusy(false);
    }
  };
  const currentRuns = detail?.runs.filter(run => run.role === role) || [];
  const resultRun = (selectedRun ? currentRuns.find(run => run.id === selectedRun) : currentRuns[0]) || currentRuns[0];
  const result = resultRun?.result;
  const currentActive = Boolean(
    activeRun && detail && activeRun.projectId === detail.project.id && activeRun.role === role,
  );
  const canRun = role === 'evidence' || !!account?.signedIn;
  const showResult = result && resultRun?.status === 'completed' && !currentActive;
  const completion = detail ? detail.steps.filter(step => step.done).length : 0;
  const focusNotes = () => {
    const input = document.getElementById('research-notes') as HTMLTextAreaElement | null;
    input?.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
    input?.focus({ preventScroll: true });
  };
  const askAgent = (next: Role) => {
    setRole(next);
    setSelectedRun(null);
    setTaskInput('');
    showView('assistants');
  };

  return (
    <div
      className={`app-shell ${detail ? 'with-bottom-nav' : ''} ${creating || editingProject || deleting || settingsOpen || addingSource ? 'has-dialog' : ''}`}
    >
      <aside className={`sidebar ${mobileSidebar ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">
            <img src="./app-icon.png" alt="" width={37} height={37} />
          </span>
          <div>
            <strong>Research Bot</strong>
            <span>A space for curious minds</span>
          </div>
          <button
            className="icon-button mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobileSidebar(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button className="new-project button" disabled={loading} onClick={() => setCreating(true)}>
          <Plus size={17} />
          New project
        </button>
        <div className="sidebar-label">
          Your research<span>{projects.length}</span>
        </div>
        <nav className="project-list" aria-label="Research projects">
          {projects.map(project => (
            <button
              key={project.id}
              className={`project-link ${detail?.project.id === project.id ? 'active' : ''}`}
              onClick={() => selectProject(project.id)}
              disabled={loading}
            >
              <span className="project-dot" />
              <span className="project-link-copy">
                <strong>{project.title}</strong>
                <span>{project.topic || 'Independent research'}</span>
              </span>
              {detail?.project.id === project.id && <ChevronRight size={15} />}
            </button>
          ))}
          {!projects.length && !loading && (
            <p className="sidebar-empty">Every good question starts somewhere. Create your first project.</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="human-led">
            <BookOpen size={18} />
            <div>
              <strong>You lead the research.</strong>
              <p>
                Your agents help you think,
                <br />
                find, plan, and refine.
              </p>
            </div>
          </div>
          <button className="account-link" onClick={() => setSettingsOpen('preferences')}>
            <span className="avatar">
              {account?.signedIn ? (account.name || account.email || 'R').slice(0, 1).toUpperCase() : 'R'}
            </span>
            <span>
              <strong>{account?.signedIn ? account.name || 'Your account' : 'Personal workspace'}</strong>
              <span>{account?.signedIn ? 'ChatGPT connected' : 'Connect ChatGPT'}</span>
            </span>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>
      {mobileSidebar && (
        <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileSidebar(false)} />
      )}
      <main className="main">
        <div className="topbar">
          <div className="topbar-path">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileSidebar(true)}
            >
              <MoreHorizontal size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{detail ? detail.project.title : 'Welcome'}</strong>
          </div>
          <div className="topbar-actions">
            {activeRun && (
              <div className="global-task" role="status">
                <LoaderCircle className="spin" size={13} />
                <span>{roles.find(item => item.id === activeRun.role)?.title} running</span>
                <button
                  className="icon-button"
                  aria-label="Cancel active task"
                  disabled={!activeRun.id || cancelBusy}
                  onClick={cancelActiveRun}
                >
                  <Square size={12} />
                </button>
              </div>
            )}
            <span className="local-status">
              <span className="status-dot" />
              {isBrowserPreview ? 'Browser preview' : 'Stored on this device'}
            </span>
            {signInPrompt && (
              <button className="button secondary topbar-signin" onClick={() => setSettingsOpen('signin')}>
                <Sparkles size={14} />
                <span>Sign in with ChatGPT</span>
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Account and preferences"
              onClick={() => setSettingsOpen('preferences')}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </div>
        {isBrowserPreview && (
          <div className="preview-banner">
            <span>
              Browser preview · Projects save in this browser. ChatGPT agents require the desktop or Android app.
            </span>
            <button onClick={() => setSettingsOpen('preferences')}>
              Account details
              <ArrowRight size={12} />
            </button>
          </div>
        )}
        {loading && !detail ? (
          <div className="page-loading">
            <LoaderCircle size={28} className="spin" />
            <p>Opening your research workspace…</p>
          </div>
        ) : !detail ? (
          <div className="welcome">
            <WelcomeArtwork />
            <span className="eyebrow welcome-badge">
              <Sparkles size={13} /> A space for curious minds
            </span>
            <h1>
              Start with a question.
              <br />
              <em>Make a discovery.</em>
            </h1>
            <p>
              Collect your thoughts, follow the evidence,
              <br className="desktop-break" /> and turn a little curiosity into something meaningful.
            </p>
            <div className="welcome-actions">
              <button className="button primary" onClick={() => setCreating(true)}>
                <Plus size={17} />
                Create your first project
              </button>
              {signInPrompt && (
                <button className="button secondary" onClick={() => setSettingsOpen('signin')}>
                  <Sparkles size={17} />
                  Sign in with ChatGPT
                </button>
              )}
            </div>
            {signInPrompt && (
              <p className="welcome-signin-note">
                Uses your eligible ChatGPT plan. Source search works without signing in.
              </p>
            )}
            {account?.signedIn && (
              <p className="welcome-signin-note">
                Signed in to ChatGPT{account.email || account.name ? ` as ${account.email || account.name}` : ''}.
              </p>
            )}
            <div className="welcome-team-heading">
              <span className="eyebrow">Meet your research team</span>
              <span>Four ways to move an idea forward</span>
            </div>
            <div className="welcome-agents">
              {roles.map(item => (
                <button
                  key={item.id}
                  data-agent={item.id}
                  aria-label={`Start a project with ${item.title}`}
                  onClick={() => {
                    setNewProjectRole(item.id);
                    setCreating(true);
                  }}
                >
                  <span className="welcome-agent-icon">
                    <item.icon size={22} strokeWidth={1.8} />
                  </span>
                  <ChevronRight className="welcome-agent-arrow" size={15} />
                  <h3>{item.title}</h3>
                  <p>
                    {item.id === 'methods'
                      ? 'A clearer question. A practical plan.'
                      : item.id === 'evidence'
                        ? 'Find articles. Follow the evidence.'
                        : item.id === 'brainstorm'
                          ? 'Fresh angles for your next idea.'
                          : 'Polish your words, in your voice.'}
                  </p>
                </button>
              ))}
            </div>
            <div className="welcome-footer">
              <span className="status-dot" />
              Local projects. Deliberate choices. Your words.
            </div>
          </div>
        ) : (
          <fieldset className="project-content" disabled={loading || undoBusy}>
            <header className="project-header">
              <div>
                <div className="project-kicker">
                  <span className="eyebrow">{detail.project.topic || 'Independent research'}</span>
                  <span>Started {date(detail.project.createdAt)}</span>
                </div>
                <h1>{detail.project.title}</h1>
                <p>Your ideas at the center. A little help along the way.</p>
              </div>
              <div className="project-header-actions">
                <div className="export-menu">
                  <button
                    className="button secondary"
                    aria-expanded={exportOpen}
                    onClick={() => setExportOpen(!exportOpen)}
                  >
                    <Download size={15} />
                    Export
                    <ChevronDown size={13} />
                  </button>
                  {exportOpen && (
                    <div className="dropdown">
                      {(['markdown', 'json'] as const).map(format => (
                        <button
                          key={format}
                          onClick={async () => {
                            setExportOpen(false);
                            try {
                              await persist();
                              const result = await api().exportProject(detail.project.id, format);
                              if (result.saved)
                                setNotice(
                                  result.path ? `Export saved to ${result.path}` : 'Your export has been downloaded.',
                                );
                            } catch (error) {
                              setError(errorText(error));
                            }
                          }}
                        >
                          <FileText size={14} />
                          {format === 'markdown' ? 'Markdown document' : 'JSON project archive'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="icon-button"
                  aria-label="Edit project details"
                  onClick={() => setEditingProject(true)}
                >
                  <MoreHorizontal size={20} />
                </button>
              </div>
            </header>
            <nav className="view-nav" aria-label="Project sections">
              {(
                [
                  { id: 'workspace', label: 'Research desk', icon: FileText },
                  { id: 'library', label: 'Source library', icon: BookOpen },
                  { id: 'plan', label: 'Research plan', icon: FlaskConical },
                  { id: 'history', label: 'Task history', icon: Undo2 },
                ] as const
              ).map(item => (
                <button
                  key={item.id}
                  className={view === item.id || (item.id === 'workspace' && view === 'assistants') ? 'active' : ''}
                  onClick={() => showView(item.id)}
                >
                  <item.icon size={16} />
                  {item.label}
                  {item.id === 'library' && detail.sources.length > 0 && <span>{detail.sources.length}</span>}
                  {item.id === 'plan' && detail.steps.length > 0 && (
                    <span>
                      {completion}/{detail.steps.length}
                    </span>
                  )}
                </button>
              ))}
              <button
                className="delete-project"
                disabled={activeRun?.projectId === detail.project.id}
                title={
                  activeRun?.projectId === detail.project.id
                    ? 'Cancel the active task before deleting this project'
                    : 'Delete project'
                }
                aria-label="Delete this project"
                onClick={() => setDeleting(true)}
              >
                <Trash2 size={15} />
              </button>
            </nav>
            {view === 'workspace' && (
              <ProjectOverview
                wordCount={words(detail.project.notes)}
                sourceCount={detail.sources.length}
                stepCount={detail.steps.length}
                completed={completion}
                onNotes={focusNotes}
                onSources={() => showView('library')}
                onPlan={() => showView('plan')}
                onAsk={askAgent}
              />
            )}
            {(view === 'workspace' || view === 'assistants') && (
              <div className={`desk desk-focus-${view}`} key={`${detail.project.id}-${view}`}>
                <section className="notes-panel" aria-labelledby="notes-heading">
                  <div className="panel-heading">
                    <div className="inline">
                      <span className="section-icon">
                        <FileText size={17} />
                      </span>
                      <h2 id="notes-heading">Your research notes</h2>
                    </div>
                    <span className={`save-indicator ${saveState}`} role="status">
                      {saveState === 'saving' ? (
                        <LoaderCircle className="spin" size={13} />
                      ) : saveState === 'saved' ? (
                        <Check size={13} />
                      ) : (
                        <span className="status-dot" />
                      )}
                      {saveState === 'saved' ? (
                        'Saved'
                      ) : saveState === 'saving' ? (
                        'Saving…'
                      ) : (
                        <button onClick={() => persist().catch(error => setError(errorText(error)))}>Save now</button>
                      )}
                    </span>
                  </div>
                  <div className="question-area">
                    <label className="eyebrow" htmlFor="research-question">
                      Working research question
                    </label>
                    <textarea
                      id="research-question"
                      maxLength={MAX_QUESTION}
                      value={detail.project.question}
                      onChange={event => changeProject({ question: event.target.value })}
                      placeholder="What would you like to understand?"
                      rows={2}
                    />
                    <span className="help">It's okay if this changes. Good questions evolve.</span>
                  </div>
                  <div className="notes-body">
                    {!detail.project.notes.trim() && (
                      <div className="notes-starter">
                        <span className="eyebrow">Make yourself a starting point</span>
                        <p>What have you noticed? What would you like to understand?</p>
                        <button
                          className="text-button"
                          onClick={() => {
                            changeProject({ notes: 'What I know\n\nWhat I want to understand\n\nIdeas to explore\n' });
                            requestAnimationFrame(focusNotes);
                          }}
                        >
                          <Plus size={14} /> Add a note outline
                        </button>
                      </div>
                    )}
                    <label className="sr-only" htmlFor="research-notes">
                      Your research notes
                    </label>
                    <textarea
                      id="research-notes"
                      maxLength={MAX_NOTES}
                      value={detail.project.notes}
                      onChange={event => changeProject({ notes: event.target.value })}
                      placeholder={
                        'Begin with what’s on your mind…\n\nA rough idea, an observation, a question you can’t stop thinking about. These are your notes; agents only add or change things when you choose.'
                      }
                      spellCheck
                    />
                    <div className="notes-footer">
                      <span>{words(detail.project.notes)} words</span>
                      <div className="inline">
                        <button className="text-button" onClick={() => moveThroughNotes('undo')}>
                          <Undo2 size={14} />
                          Undo last saved change
                        </button>
                        <button className="text-button" onClick={() => moveThroughNotes('redo')}>
                          <Redo2 size={14} />
                          Redo
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="desk-tip">
                    <Lightbulb size={17} />
                    <p>
                      Keep it rough. Start with your thoughts, then ask the methods coach to help shape an approach.
                    </p>
                  </div>
                </section>
                <section className="assistant-panel" aria-labelledby="assistant-heading" data-agent={role}>
                  <div className="panel-heading">
                    <div className="inline">
                      <span className="section-icon green-icon">
                        <Sparkles size={17} />
                      </span>
                      <h2 id="assistant-heading">Your research team</h2>
                    </div>
                    <span className="agent-status">On demand</span>
                  </div>
                  <nav className="role-tabs" aria-label="Research agents">
                    {roles.map(item => (
                      <button
                        key={item.id}
                        data-agent={item.id}
                        aria-pressed={role === item.id}
                        className={role === item.id ? 'active' : ''}
                        title={item.title}
                        onClick={() => {
                          setRole(item.id);
                          setSelectedRun(null);
                          setTaskInput('');
                        }}
                      >
                        <item.icon size={18} />
                        <span>
                          {item.id === 'methods'
                            ? 'Methods'
                            : item.id === 'evidence'
                              ? 'Evidence'
                              : item.id === 'grammar'
                                ? 'Grammar'
                                : 'Ideas'}
                        </span>
                      </button>
                    ))}
                  </nav>
                  <div className="assistant-content" key={role}>
                    <div className="agent-intro">
                      <span className="eyebrow">{currentRole.title}</span>
                      <h2>{currentRole.label}</h2>
                      <p>{currentRole.description}</p>
                    </div>
                    <div className="task-form">
                      {role !== 'grammar' ? (
                        <>
                          <label className="field-label" htmlFor="task-input">
                            {role === 'evidence' ? 'What are you looking for?' : 'What would you like help with?'}{' '}
                            <span className="muted">· optional</span>
                          </label>
                          <textarea
                            id="task-input"
                            rows={3}
                            value={taskInput}
                            onChange={event => setTaskInput(event.target.value)}
                            placeholder={
                              role === 'evidence'
                                ? 'e.g. Food waste interventions at universities'
                                : role === 'methods'
                                  ? 'e.g. Help me narrow my question and choose a method.'
                                  : 'e.g. What alternative explanations could I investigate?'
                            }
                          />
                          <p className="help">
                            {role === 'evidence'
                              ? 'Searches scholarly metadata. Reports and forums can be added to your library.'
                              : 'Uses this instruction, or your research question and notes when left blank.'}
                          </p>
                          <div className="prompt-starters" aria-label="Suggested prompts">
                            {(role === 'evidence'
                              ? [
                                  {
                                    label: 'Search my topic',
                                    text: detail.project.question || detail.project.topic || detail.project.title,
                                  },
                                  {
                                    label: 'Find review articles',
                                    text: `${detail.project.topic || detail.project.question || detail.project.title} review`,
                                  },
                                ]
                              : role === 'methods'
                                ? [
                                    {
                                      label: 'Narrow my question',
                                      text: 'Help me narrow my research question into something clear and manageable.',
                                    },
                                    {
                                      label: 'Choose an approach',
                                      text: 'Suggest a practical research approach and explain its limitations.',
                                    },
                                  ]
                                : [
                                    {
                                      label: 'Explore new angles',
                                      text: 'What fresh angles could I explore in this research?',
                                    },
                                    {
                                      label: 'Challenge assumptions',
                                      text: 'Which assumptions should I question, and what evidence would help me test them?',
                                    },
                                  ]
                            ).map(prompt => (
                              <button
                                key={prompt.label}
                                aria-pressed={taskInput === prompt.text}
                                onClick={() => {
                                  setTaskInput(prompt.text);
                                  document.getElementById('task-input')?.focus({ preventScroll: true });
                                }}
                              >
                                <Sparkles size={12} />
                                {prompt.label}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="grammar-note">
                          <FileText size={16} />
                          Reviews the current text in your notes. Corrections require your acceptance.
                        </p>
                      )}
                      {!canRun && (
                        <div className="auth-prompt">
                          <span className="status-dot" />
                          <p>
                            {isBrowserPreview
                              ? 'ChatGPT agents need the desktop or Android app.'
                              : 'Sign in with ChatGPT to use this agent.'}
                          </p>
                          <button
                            className="text-button"
                            onClick={() => setSettingsOpen(isBrowserPreview ? 'preferences' : 'signin')}
                          >
                            {isBrowserPreview ? 'Details' : 'Sign in with ChatGPT'}
                            <ArrowRight size={13} />
                          </button>
                        </div>
                      )}
                      <button
                        className="button primary full-width"
                        disabled={!canRun || !!activeRun || (role === 'grammar' && !detail.project.notes.trim())}
                        onClick={startRun}
                      >
                        {currentActive ? <LoaderCircle className="spin" size={16} /> : <currentRole.icon size={16} />}
                        {currentActive ? 'Working on your request…' : currentRole.action}
                        {!currentActive && <ArrowRight size={16} />}
                      </button>
                      {activeRun && !currentActive && (
                        <p className="help">Another agent is working. Cancel it or wait before starting a new task.</p>
                      )}
                    </div>
                    {currentActive && activeRun && (
                      <div className="run-progress" aria-live="polite">
                        <LoaderCircle size={24} className="spin" />
                        <p>{activeRun.message}</p>
                        <button
                          className="button small secondary"
                          disabled={!activeRun.id || cancelBusy}
                          onClick={cancelActiveRun}
                        >
                          <Square size={12} />
                          {cancelBusy ? 'Cancelling…' : 'Cancel task'}
                        </button>
                      </div>
                    )}
                    {!currentActive && resultRun?.status === 'failed' && (
                      <div className="result-error" role="alert">
                        <h3>This task could not finish</h3>
                        <p>{resultRun.error || 'Please try again.'}</p>
                      </div>
                    )}
                    {!currentActive && resultRun?.status === 'cancelled' && (
                      <div className="callout">This task was cancelled. Your notes remain available.</div>
                    )}
                    {showResult && (
                      <div className="agent-results">
                        <div className="results-heading">
                          <span className="eyebrow">For your review</span>
                          <span>{date(resultRun.createdAt)}</span>
                        </div>
                        {result.kind === 'evidence' && (
                          <>
                            <p className="evidence-disclaimer">{result.limitations}</p>
                            <div className="result-label">
                              {result.sources.length} source candidates{result.cached ? ' · cached search' : ''}
                            </div>
                            {result.sources.length === 0 && (
                              <p className="muted">No matching sources found. Try a broader search term.</p>
                            )}
                            {result.sources.map(source => (
                              <SourceResult
                                key={source.id}
                                source={source}
                                saved={detail.sources.some(
                                  item => item.id === source.id || (!!item.doi && item.doi === source.doi),
                                )}
                                onSave={saveSource}
                                onOpen={open}
                              />
                            ))}
                          </>
                        )}
                        {result.kind === 'grammar' && (
                          <GrammarReview
                            key={resultRun.id}
                            result={result}
                            currentNotes={detail.project.notes}
                            onApply={notes => changeProject({ notes })}
                          />
                        )}
                        {result.kind === 'methods' && (
                          <MethodsReview
                            key={resultRun.id}
                            result={result}
                            existingSteps={detail.steps}
                            onQuestion={question => {
                              changeProject({ question });
                              setNotice('Research question adopted. You can edit it at any time.');
                            }}
                            onPlan={async steps => {
                              const existing = detailRef.current?.steps || [];
                              const additions = steps.filter(step => !existing.some(item => item.id === step.id));
                              await saveSteps([...existing, ...additions]);
                              setNotice('Proposed steps added to your editable research plan.');
                            }}
                          />
                        )}
                        {result.kind === 'brainstorm' && (
                          <BrainstormReview
                            key={resultRun.id}
                            result={result}
                            onAccept={text => {
                              const previous = detailRef.current?.project.notes || '';
                              changeProject({ notes: `${previous}${previous ? '\n\n' : ''}${text}` });
                            }}
                          />
                        )}
                      </div>
                    )}
                    {!currentActive && !resultRun && (
                      <div className="assistant-empty">
                        <span className="empty-orbit">
                          <currentRole.icon size={25} strokeWidth={1.4} />
                        </span>
                        <p>
                          {role === 'evidence'
                            ? 'A good source is a starting point.'
                            : role === 'grammar'
                              ? 'A careful second pair of eyes.'
                              : role === 'brainstorm'
                                ? 'Let curiosity open a few doors.'
                                : 'A little structure goes a long way.'}
                        </p>
                        <span>
                          {role === 'evidence'
                            ? 'Review each original before drawing conclusions.'
                            : 'Suggestions will appear here for you to review.'}
                        </span>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}
            {view === 'library' && (
              <section className="full-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">Read. Evaluate. Connect.</span>
                    <h2>Your source library</h2>
                    <p>Record what you learn in your literature matrix. Keep unsupported findings blank.</p>
                  </div>
                  <button className="button primary" onClick={() => setAddingSource(true)}>
                    <Plus size={16} />
                    Add a source
                  </button>
                </div>
                {detail.sources.length ? (
                  <>
                    <div className="callout matrix-note">
                      <BookOpen size={17} />
                      <span>
                        Metadata identifies a source; reading establishes what it says. Record page references and
                        inclusion decisions in your notes.
                      </span>
                    </div>
                    <div className="matrix-scroll">
                      <table className="literature-matrix">
                        <thead>
                          <tr>
                            <th>Source & provenance</th>
                            <th>Method / setting</th>
                            <th>Key findings</th>
                            <th>Limitations</th>
                            <th>Your reading notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.sources.map(source => (
                            <MatrixRow
                              key={source.id}
                              source={source}
                              onSave={saveSource}
                              onOpen={open}
                              onDelete={async id => {
                                try {
                                  const projectId = detail.project.id;
                                  await api().deleteSource(projectId, id);
                                  if (detailRef.current?.project.id === projectId)
                                    updateDetail(current => ({
                                      ...current,
                                      sources: current.sources.filter(source => source.id !== id),
                                    }));
                                } catch (error) {
                                  setError(errorText(error));
                                }
                              }}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="section-empty">
                    <BookOpen size={34} strokeWidth={1.3} />
                    <h3>Your next discovery belongs here.</h3>
                    <p>Find articles with the evidence agent, or add a source you already know.</p>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setRole('evidence');
                        showView('assistants');
                      }}
                    >
                      <Search size={16} />
                      Find sources
                    </button>
                  </div>
                )}
              </section>
            )}
            {view === 'plan' && (
              <section className="full-section plan-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">One considered step at a time</span>
                    <h2>Your research plan</h2>
                    <p>Make this approach your own. Edit steps and check them off as you progress.</p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={async () => {
                      try {
                        await saveSteps([
                          ...detailRef.current!.steps,
                          {
                            id: uid(),
                            title: 'New research step',
                            purpose: '',
                            output: '',
                            dependsOn: '',
                            check: '',
                            done: false,
                          },
                        ]);
                      } catch (error) {
                        setError(errorText(error));
                      }
                    }}
                  >
                    <Plus size={16} />
                    Add a step
                  </button>
                </div>
                {detail.steps.length ? (
                  <>
                    <div className="plan-progress">
                      <div>
                        <strong>
                          {completion} of {detail.steps.length} complete
                        </strong>
                        <span>{Math.round((completion / detail.steps.length) * 100)}%</span>
                      </div>
                      <progress max={detail.steps.length} value={completion} aria-label="Research plan completion" />
                    </div>
                    <div className="plan-list">
                      {detail.steps.map((step, index) => (
                        <StepEditor
                          key={step.id}
                          step={step}
                          index={index}
                          count={detail.steps.length}
                          onChange={next =>
                            saveSteps(detailRef.current!.steps.map(item => (item.id === next.id ? next : item)))
                          }
                          onMove={async direction => {
                            const steps = [...detailRef.current!.steps];
                            [steps[index], steps[index + direction]] = [steps[index + direction], steps[index]];
                            try {
                              await saveSteps(steps);
                            } catch (error) {
                              setError(errorText(error));
                            }
                          }}
                          onDelete={async () => {
                            try {
                              await saveSteps(detailRef.current!.steps.filter(item => item.id !== step.id));
                            } catch (error) {
                              setError(errorText(error));
                            }
                          }}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="section-empty">
                    <FlaskConical size={34} strokeWidth={1.3} />
                    <h3>Find a path that fits your question.</h3>
                    <p>The methods coach can explain your options and suggest a plan for you to review.</p>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setRole('methods');
                        showView('assistants');
                      }}
                    >
                      Open methods coach
                      <ArrowRight size={16} />
                    </button>
                  </div>
                )}
              </section>
            )}
            {view === 'history' && (
              <section className="full-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">A record of your process</span>
                    <h2>Task history</h2>
                    <p>Revisit agent requests and their results. Accepted work lives in your notes and plan.</p>
                  </div>
                </div>
                {detail.runs.length ? (
                  <div className="history-list">
                    {detail.runs.map(run => {
                      const item = roles.find(role => role.id === run.role)!;
                      return (
                        <article className="history-card" key={run.id}>
                          <span className="section-icon">
                            <item.icon size={18} />
                          </span>
                          <div>
                            <div className="history-title">
                              <strong>{item.title}</strong>
                              <span className={`tag ${run.status === 'completed' ? 'green' : ''}`}>{run.status}</span>
                            </div>
                            <p>{run.input}</p>
                            <span className="help">
                              {date(run.createdAt)}
                              {run.model && ` · ${run.model}`}
                              {run.usage && ` · ${run.usage.input + run.usage.output} tokens`}
                            </span>
                            {run.error && <p className="error">{run.error}</p>}
                          </div>
                          <button
                            className="button small secondary"
                            onClick={() => {
                              setRole(run.role);
                              setSelectedRun(run.id);
                              showView('assistants');
                            }}
                          >
                            View
                            <ArrowRight size={14} />
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="section-empty">
                    <Undo2 size={34} strokeWidth={1.3} />
                    <h3>A fresh start.</h3>
                    <p>Your completed, cancelled, and failed tasks will appear here.</p>
                    <button className="button secondary" onClick={() => askAgent('evidence')}>
                      <Search size={16} /> Try a source search <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </section>
            )}
          </fieldset>
        )}
        {detail && (
          <nav className="bottom-nav" aria-label="Project sections">
            <span
              className="bottom-nav-indicator"
              aria-hidden="true"
              style={{
                transform: `translateX(${['workspace', 'assistants', 'library', 'plan', 'history'].indexOf(view) * 100}%)`,
              }}
            />
            {(
              [
                { id: 'workspace', label: 'Notes', icon: FileText },
                { id: 'assistants', label: 'Assistants', icon: Sparkles },
                { id: 'library', label: 'Sources', icon: BookOpen },
                { id: 'plan', label: 'Plan', icon: FlaskConical },
                { id: 'history', label: 'History', icon: Undo2 },
              ] as const
            ).map(item => {
              const badge =
                item.id === 'library' && detail.sources.length > 0
                  ? String(detail.sources.length)
                  : item.id === 'plan' && detail.steps.length > 0
                    ? `${completion}/${detail.steps.length}`
                    : item.id === 'assistants' && activeRun?.projectId === detail.project.id
                      ? '•'
                      : '';
              return (
                <button
                  key={item.id}
                  className={view === item.id ? 'active' : ''}
                  aria-current={view === item.id ? 'page' : undefined}
                  onClick={() => showView(item.id)}
                >
                  <span className="bottom-nav-icon">
                    <item.icon size={21} strokeWidth={view === item.id ? 2.2 : 1.7} />
                    {badge && <span className="bottom-nav-badge">{badge}</span>}
                  </span>
                  {item.label}
                </button>
              );
            })}
          </nav>
        )}
        <footer className="app-footer">
          <Leaf size={13} />
          <span>Research is a practice. Take your time.</span>
          <span>Research Bot · {isBrowserPreview ? 'Preview' : platform === 'android' ? 'Android' : 'Desktop'}</span>
        </footer>
      </main>
      {(error || notice) && (
        <div key={error || notice} className={`toast ${error ? 'toast-error' : ''}`} role={error ? 'alert' : 'status'}>
          <span>{error || notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => {
              setError('');
              setNotice('');
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {creating && (
        <ProjectForm
          onClose={() => {
            setCreating(false);
            setNewProjectRole(null);
          }}
          onSubmit={async (title, topic) => {
            await persist();
            const next = await api().createProject({ title, topic });
            setProjects(current => [next.project, ...current]);
            openDetail(next);
            setView(newProjectRole ? 'assistants' : 'workspace');
            if (newProjectRole) setRole(newProjectRole);
            setMobileSidebar(false);
          }}
        />
      )}
      {editingProject && detail && (
        <ProjectForm
          project={detail.project}
          onClose={() => setEditingProject(false)}
          onDelete={
            activeRun?.projectId === detail.project.id
              ? undefined
              : () => {
                  setEditingProject(false);
                  setDeleting(true);
                }
          }
          onSubmit={async (title, topic) => {
            changeProject({ title: title.trim(), topic: topic.trim() });
            await persist();
          }}
        />
      )}
      {deleting && detail && (
        <Modal title="Delete this project?" onClose={() => setDeleting(false)}>
          <p>
            “{detail.project.title}” and its notes, source library, plan, and task history will be removed from this
            device.
          </p>
          <p className="muted">Export the project first if you'd like a backup.</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDeleting(false)}>
              Keep project
            </button>
            <button
              className="button danger-button"
              onClick={async () => {
                try {
                  await persist();
                  await api().deleteProject(detail.project.id);
                  const remaining = projects.filter(project => project.id !== detail.project.id);
                  setProjects(remaining);
                  if (remaining.length) openDetail(await api().getProject(remaining[0].id));
                  else {
                    detailRef.current = null;
                    setDetail(null);
                  }
                  setDeleting(false);
                  setView('workspace');
                  setNotice('Project deleted.');
                } catch (error) {
                  setError(errorText(error));
                }
              }}
            >
              <Trash2 size={16} />
              Delete project
            </button>
          </div>
        </Modal>
      )}
      {settingsOpen && (
        <AccountSettings
          account={account}
          setAccount={setAccount}
          onClose={() => setSettingsOpen(false)}
          autoSignIn={settingsOpen === 'signin'}
        />
      )}
      {addingSource && <ManualSource onClose={() => setAddingSource(false)} onSave={saveSource} />}
    </div>
  );
}
