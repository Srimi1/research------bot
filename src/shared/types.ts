export type Role = 'methods' | 'evidence' | 'grammar' | 'brainstorm';
export interface Project {
  id: string;
  title: string;
  topic: string;
  question: string;
  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface PlanStep {
  id: string;
  title: string;
  purpose: string;
  output: string;
  dependsOn: string;
  check: string;
  done: boolean;
}
export interface Source {
  id: string;
  title: string;
  authors: string[];
  year: string;
  url: string;
  doi: string;
  category: 'article' | 'report' | 'forum' | 'document';
  inspected: 'metadata' | 'abstract' | 'full-text' | 'user-added';
  retrievedAt: string;
  abstract: string;
  query: string;
  method: string;
  findings: string;
  limitations: string;
  notes: string;
}
export interface GrammarEdit {
  id: string;
  before: string;
  after: string;
  reason: string;
  start: number;
  end: number;
}
export interface GrammarResult {
  kind: 'grammar';
  original: string;
  proposed: string;
  edits: GrammarEdit[];
  clarification: string;
}
export interface MethodsResult {
  kind: 'methods';
  question: string;
  assumptions: string[];
  explanation: string;
  options: { name: string; rationale: string; limitations: string }[];
  steps: PlanStep[];
}
export interface BrainstormResult {
  kind: 'brainstorm';
  ideas: { title: string; explanation: string; assumptions: string; evidenceNeeded: string; nextStep: string }[];
}
export interface EvidenceResult {
  kind: 'evidence';
  sources: Source[];
  query: string;
  cached: boolean;
  limitations: string;
}
export type AgentResult = GrammarResult | MethodsResult | BrainstormResult | EvidenceResult;
export interface Run {
  id: string;
  projectId: string;
  role: Role;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  model: string;
  input: string;
  result?: AgentResult;
  error?: string;
  createdAt: string;
  usage?: { input: number; output: number };
}
export interface ProjectDetail {
  project: Project;
  sources: Source[];
  steps: PlanStep[];
  runs: Run[];
}
export interface Account {
  signedIn: boolean;
  name?: string;
  email?: string;
  model?: string;
  storageAvailable: boolean;
  message?: string;
}
export interface Settings {
  model: string;
  maxRequests: number;
  /** Download new versions from GitHub Releases in the background. */
  autoUpdate: boolean;
}
export interface RunRequest {
  projectId: string;
  role: Role;
  text: string;
  refresh?: boolean;
}
export interface RunEvent {
  runId: string;
  projectId: string;
  type: 'delta' | 'status';
  text: string;
}
export interface ResearchAPI {
  listProjects(): Promise<Project[]>;
  createProject(input: { title: string; topic: string }): Promise<ProjectDetail>;
  getProject(id: string): Promise<ProjectDetail>;
  saveProject(input: Pick<Project, 'id' | 'title' | 'topic' | 'question' | 'notes' | 'version'>): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  saveSource(projectId: string, source: Source): Promise<Source>;
  deleteSource(projectId: string, sourceId: string): Promise<void>;
  saveSteps(projectId: string, steps: PlanStep[]): Promise<void>;
  undoNotes(projectId: string): Promise<Project>;
  redoNotes(projectId: string): Promise<Project>;
  exportProject(projectId: string, format: 'json' | 'markdown'): Promise<{ saved: boolean; path?: string }>;
  account(): Promise<Account>;
  signIn(): Promise<Account>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  models(): Promise<string[]>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  run(request: RunRequest): Promise<Run>;
  cancelRun(runId: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  onRunEvent(callback: (event: RunEvent) => void): () => void;
}
declare global {
  interface Window {
    research: ResearchAPI;
  }
}
