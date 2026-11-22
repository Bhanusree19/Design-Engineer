// src/api/client.ts
//
// Design Engineer backend client — Supabase-auth aware.
//
// The plugin authenticates every request with the Supabase access token that
// was returned by signup / signin / refresh. All account, project, GitHub and
// Codex state lives in Supabase via the backend; nothing here touches Docker.

// Injected by webpack at build time. This is a public URL, not a secret.
// The default retains the previous local-development experience.
declare const __DESIGN_ENGINEER_API_URL__: string;
const DEFAULT_BASE_URL = __DESIGN_ENGINEER_API_URL__;
export function getBaseUrl(): string {
  return (
    (window as any).__DESIGN_ENGINEER_API__ ||
    DEFAULT_BASE_URL
  ).replace(/\/+$/, '');
}

// -----------------------------------------------------------------------------
// ACCESS TOKEN
// -----------------------------------------------------------------------------

let authToken: string | null = null;

export function setAccessToken(token: string | null) {
  authToken = token;
}

export function getAccessToken(): string | null {
  return authToken;
}

// -----------------------------------------------------------------------------
// REQUEST HELPER
// -----------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T = any>(
  path: string,
  options: RequestInit = {},
  token: string | null = authToken
): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await res.text().catch(() => '');
  let json: any = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined; // non-JSON body
  }

  // A successful response is returned as-is, even when it carries an `error`
  // field (a failed job, a Google sign-in error status). Previously such a
  // response was turned into a bare string, so failed jobs went unnoticed.
  if (res.ok) return (json === undefined ? text : json) as T;

  const message =
    json && typeof json.error === 'string'
      ? json.error
      : `Request to ${path} failed (${res.status})${text && !json ? `: ${text.slice(0, 160)}` : ''}`;
  throw new ApiError(message, res.status, json && typeof json.code === 'string' ? json.code : undefined);
}

/**
 * True when the backend does not have a newer endpoint yet (migration or
 * deploy not done). The plugin then falls back to today's behaviour.
 */
export function isNotAvailable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === 'NOT_AVAILABLE') return true;
  return error.status === 404 && !error.code && /cannot (get|post|patch|delete)|route not found|failed \(404\)/i.test(error.message);
}

// -----------------------------------------------------------------------------
// AUTH
// -----------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  created_at?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface SignupResponse extends Partial<AuthSession> {
  confirmationRequired?: boolean;
  email?: string;
}

export function signup(email: string, password: string): Promise<SignupResponse> {
  return request('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function signin(email: string, password: string): Promise<AuthSession> {
  return request('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function refreshSession(refreshToken: string): Promise<AuthSession> {
  return request(
    '/auth/refresh',
    {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    },
    null
  );
}

export function logout(): Promise<{ success: boolean }> {
  return request('/auth/logout', { method: 'POST' });
}

// -----------------------------------------------------------------------------
// GOOGLE AUTH (create account / sign in with Google)
// -----------------------------------------------------------------------------

export function googleConnect(): Promise<{ url: string; state: string }> {
  return request('/auth/google/connect', { method: 'POST' });
}

export interface GoogleStatusResponse {
  status: 'pending' | 'done' | 'expired' | 'error';
  session?: AuthSession;
  error?: string;
}

export function googleStatus(state: string): Promise<GoogleStatusResponse> {
  return request(`/auth/google/status?state=${encodeURIComponent(state)}`);
}

export interface GithubStatus {
  connected: boolean;
  githubUser: string | null;
}

export interface CodexStatusInfo {
  connected: boolean;
  codexUser: string | null;
  credentialsSaved?: boolean;
}

export type Stack = 'react-native' | 'react-js';
export type Agent = 'codex' | 'claude' | 'opencode' | 'gemini-api' | 'direct-api';
export type ModelProvider = 'opencode' | 'ollama-cloud' | 'deepseek' | 'moonshotai' | 'openai' | 'anthropic' | 'gemini';
export interface ModelVerification {
  connected: boolean;
  verified: boolean;
  method: string;
  billingVerified: boolean;
}
export function saveProviderKey(agent: Agent, provider: ModelProvider, model: string | null, apiKey: string): Promise<ModelVerification> {
  return request('/api/models/connections', {method:'POST',
    body:JSON.stringify({agent,provider,model,apiKey})});
}
export function verifyModel(agent: Agent, provider: ModelProvider, model: string | null): Promise<ModelVerification> {
  return request('/api/models/verify', {method:'POST',
    body:JSON.stringify({agent,provider,model})});
}
export function listAgents(): Promise<{agents:Agent[];providers:ModelProvider[]}> {return request('/api/agents');}
export function listModels(provider:ModelProvider): Promise<{models:string[]}> {return request('/api/models?provider='+encodeURIComponent(provider));}
export type DirectProvider = 'gemini' | 'deepseek' | 'openai' | 'anthropic';
export function listDirectModels(provider: DirectProvider, apiKey?: string): Promise<{models:string[]}> {
  return request('/api/models/direct',{method:'POST',body:JSON.stringify({provider,apiKey:apiKey||undefined})});
}
export function listGeminiModels(apiKey?:string): Promise<{models:string[]}> {
  return request('/api/models/gemini',{method:'POST',body:JSON.stringify({apiKey:apiKey||undefined})});
}


// What Design Engineer found in the chosen repository branch.
export interface RepoApp {
  root: string;
  stack: Stack;
  framework: string;
  frameworkName: string;
  versions: { react: string | null; reactNative: string | null; expo: string | null; next: string | null };
  language: 'typescript' | 'javascript';
  packageManager: string | null;
  styling: string[];
  uiLibraries: string[];
  navigation: string[];
  state: string[];
  testing: string[];
  components: { dirs: string[]; count: number; names: string[] };
  screenDirs: string[];
  themeFiles: string[];
  scripts: string[];
}
export type RepoContextStatus =
  | 'existing-app' | 'multiple-apps' | 'empty' | 'no-app' | 'unsupported' | 'branch-not-found' | 'repo-not-found';
export interface RepoContext {
  version: number;
  status: RepoContextStatus;
  stack: Stack | null;
  summary: string;
  app?: RepoApp;
  apps?: RepoApp[];
  detectedOther?: string;
  repository?: string;
  branch?: string;
  analyzedAt?: string;
  truncated?: boolean;
}
export function analyzeRepoContext(projectId: string): Promise<{ project: Project; context: RepoContext; autoStack: boolean }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/repo-context`, { method: 'POST', body: '{}' });
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: string;
  repository: string | null;
  base_branch: string | null;
  stack: Stack | null;
  /** 'detected' when the stack came from the repository, 'user' when picked. */
  stack_source?: 'detected' | 'user' | null;
  repo_context?: RepoContext | null;
  coding_agent?: Agent;
  model_provider?: ModelProvider | null;
  model_id?: string | null;
  execution_mode?: 'cli' | 'direct-api';
  created_at: string;
  updated_at: string;
}

export interface MeResponse {
  user: AuthUser;
  profile: { email?: string } | null;
  github: GithubStatus;
  projects: Project[];
  codex: CodexStatusInfo;
}

export function getMe(): Promise<MeResponse> {
  return request('/auth/me');
}

// -----------------------------------------------------------------------------
// GITHUB
// -----------------------------------------------------------------------------

export function githubConnect(): Promise<{ url: string }> {
  return request('/api/github/connect', { method: 'POST' });
}

export function githubStatus(): Promise<GithubStatus> {
  return request('/api/github/status');
}

export function githubDisconnect(): Promise<{ success: boolean }> {
  return request('/api/github/disconnect', { method: 'POST' });
}

// -----------------------------------------------------------------------------
// PROJECTS
// -----------------------------------------------------------------------------

export function listProjects(): Promise<{ projects: Project[] }> {
  return request('/api/projects');
}

export function createProject(name: string, description?: string): Promise<{ project: Project }> {
  return request('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export function getProject(id: string): Promise<{ project: Project; fetchedScreens: unknown[] }> {
  return request(`/api/projects/${encodeURIComponent(id)}`);
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'status' | 'repository' | 'base_branch' | 'stack' | 'coding_agent' | 'model_provider' | 'model_id'>>
): Promise<{ project: Project }> {
  return request(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteProject(id: string): Promise<{ success: boolean }> {
  return request(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// -----------------------------------------------------------------------------
// CODEX
// -----------------------------------------------------------------------------

export function codexStatus(): Promise<CodexStatusInfo> {
  return request('/auth/codex/status');
}

export function logoutCodex(): Promise<{ success: boolean }> {
  return request('/auth/codex/logout', { method: 'POST' });
}

export function startCodexAuth() {
  return request<{
    device_code: string;
    interval: number;
    alreadyAuthenticated?: boolean;
    browserAuth?: boolean;
    deviceAuth?: boolean;
    verificationUrl?: string | null;
    userCode?: string | null;
    codexUser?: string;
  }>('/auth/codex/device', { method: 'POST' });
}

export function getCodexAuthStatus(authId: string) {
  return request<{
    status: 'pending' | 'approved' | 'expired';
    codexUser: string | null;
    error?: string | null;
  }>(`/auth/codex/device/${encodeURIComponent(authId)}/status`);
}

// -----------------------------------------------------------------------------
// LEGACY COMPATIBILITY HELPERS
// -----------------------------------------------------------------------------

export interface SessionInfo {
  sessionId: string;
}

export function createSession(): Promise<SessionInfo> {
  return Promise.resolve({ sessionId: `plugin-${Date.now()}` });
}

export interface SessionStatus {
  githubConnected: boolean;
  githubUser: string | null;
}

export function getSessionStatus(_sessionId?: string): Promise<SessionStatus> {
  return getMe().then((me) => ({
    githubConnected: !!me.github.connected,
    githubUser: me.github.githubUser || null,
  }));
}

export function getCodexStatus(_sessionId?: string): Promise<CodexStatusInfo> {
  return codexStatus();
}

export function githubAuthUrl(_sessionId?: string): string {
  return `${getBaseUrl()}/auth/github`;
}

// -----------------------------------------------------------------------------
// REPOSITORIES & BRANCHES
// -----------------------------------------------------------------------------

export interface Repo {
  fullName: string;
  private: boolean;
}

export function listRepos(): Promise<{ repos: Repo[] }> {
  return request('/api/repos');
}

export interface Branch {
  name: string;
}

export function listBranches(owner: string, repo: string): Promise<{ branches: Branch[] }> {
  return request(
    `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`
  );
}

// -----------------------------------------------------------------------------
// DESIGN CONTEXT
// -----------------------------------------------------------------------------

export function submitScreens(
  projectId: string,
  repo: string,
  branch: string,
  screens: unknown[]
): Promise<{ saved: string[]; screenCount?: number }> {
  return request('/api/screens/fetch', {
    method: 'POST',
    body: JSON.stringify({ projectId, repo, branch, screens }),
  });
}

export interface ImplementationResult {
  screens: string[];
  branch: string;
  pullRequestUrl: string;
}

export interface ScreenPlanInfo {
  name: string;
  size: string | null;
  page: string | null;
  nodeCount: number;
  details: string;
}

export interface ScreenPlan {
  success: boolean;
  plan: string;
  prompt: string;
  proposedBranch: string;
  stack: Stack;
  repository: string;
  baseBranch: string;
  screens: ScreenPlanInfo[];
}

export function planScreens(
  projectId: string,
  screens: unknown[]
): Promise<ScreenPlan> {
  return request('/api/screens/plan', {
    method: 'POST',
    body: JSON.stringify({ projectId, screens }),
  });
}

export interface ImplementationJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result: ImplementationResult | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export function getImplementationJob(jobId: string): Promise<ImplementationJob> {
  return request('/api/jobs/' + encodeURIComponent(jobId));
}
export function implementScreens(
  projectId: string,
  screens: unknown[]
): Promise<{ jobId: string; status: 'queued' } | { implementations: ImplementationResult[] }> {
  return request('/api/screens/implement', {
    method: 'POST',
    body: JSON.stringify({ projectId, screens }),
  });
}

 
// -----------------------------------------------------------------------------
// DATABASE-DEFINED IMPLEMENTATION MINUTES + RAZORPAY CHECKOUT
// -----------------------------------------------------------------------------

export interface MinuteUsage {
  plan: 'free' | 'plus' | 'studio';
  planName: string;
  allowanceSeconds: number;
  /** Plan's own build minutes in seconds (paid periods add carryoverSeconds). */
  planSeconds?: number;
  /** Unused paid seconds carried over from an early renewal or plan switch. */
  carryoverSeconds?: number;
  usedSeconds: number;
  remainingSeconds: number;
  availableSeconds: number;
  reservedSeconds: number;
  priceInr: number;
  expiresAt: string | null;
}
export interface SubscriptionPlan {
  slug: 'free' | 'plus' | 'studio';
  name: string;
  build_minutes: number;
  price_inr: number;
  currency: string;
  features: string[];
  sort_order: number;
}
export interface BillingStatus {
  usage: MinuteUsage;
  plans: SubscriptionPlan[];
  paymentsEnabled: boolean;
  membership?: {expired:boolean;previousPlan:string|null;periodEnd:string|null;prepaidCancellationScheduled?:boolean};
  recurringEnabled?: boolean;
  renewal?: {plan:string;status:string;autoRenew:boolean;cancelAtPeriodEnd:boolean}|null;
}
export function billingStatus(): Promise<BillingStatus> {
  return request('/api/billing/status');
}
export interface BuildUsage {
  jobId: string;
  projectName: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  bucket: 'free' | 'paid';
  billedSeconds: number;
  meterState: 'reserved' | 'running' | 'finished';
  screenCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}
export interface PaymentRecord {
  planSlug: string;
  amount: number; // paise
  currency: string;
  status: 'paid' | 'refunded';
  createdAt: string;
  paidAt: string | null;
}
export interface BillingHistory { builds: BuildUsage[]; payments: PaymentRecord[]; }
export function billingHistory(): Promise<BillingHistory> {
  return request('/api/billing/history');
}
export function startCheckout(plan: 'plus' | 'studio',recurring=false): Promise<{checkoutUrl:string}> {
  return request(recurring?'/api/billing/subscription/start':'/api/billing/order',{method:'POST',body:JSON.stringify({plan})});
}
export function cancelPrepaidPlan(): Promise<{success:boolean;effectiveAt:string}> {
 return request('/api/billing/prepaid/cancel',{method:'POST'});
}
export function cancelSubscription(): Promise<{success:boolean;cancelAtPeriodEnd:boolean}> {
  return request('/api/billing/subscription/cancel',{method:'POST'});
}

// -----------------------------------------------------------------------------
// DEPLOYMENT 09: REPOSITORY LINKS, ACCOUNT MODEL, PROJECT BUILDS
// Each call answers NOT_AVAILABLE (see isNotAvailable) until the backend has
// migration 011; callers then fall back to the project's own fields.
// -----------------------------------------------------------------------------

export interface RepoLink {
  id: string;
  projectId: string;
  repository: string;
  branch: string;
  appRoot: string;
  stack: Stack | null;
  stackSource: 'detected' | 'user' | null;
  repoContext: RepoContext | null;
  isDefault: boolean;
  lastCheckedAt: string | null;
  createdAt?: string;
}
export function listRepoLinks(projectId: string): Promise<{ links: RepoLink[]; activeLinkId: string | null }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/repos`);
}
export function addRepoLink(projectId: string, link: { repository: string; branch: string; stack?: Stack | null; isDefault?: boolean }): Promise<{ link: RepoLink }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/repos`, { method: 'POST', body: JSON.stringify(link) });
}
export function updateRepoLink(projectId: string, linkId: string, patch: { branch?: string; stack?: Stack | null; isDefault?: boolean }): Promise<{ link: RepoLink }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(linkId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export function deleteRepoLink(projectId: string, linkId: string): Promise<{ success: boolean; defaultLinkId: string | null }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(linkId)}`, { method: 'DELETE' });
}
export function activateRepoLink(projectId: string, linkId: string): Promise<{ project: Project; link: RepoLink }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(linkId)}/activate`, { method: 'POST', body: '{}' });
}

export interface ProjectBuild {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  repository: string | null;
  branch: string | null;
  agent: Agent | null;
  provider: ModelProvider | null;
  model: string | null;
  screenCount: number | null;
  billedSeconds: number | null;
  pullRequestUrl: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export function listProjectBuilds(projectId: string): Promise<{ builds: ProjectBuild[]; startBufferSeconds: number }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/builds`);
}

export interface AccountModel {
  agent: Agent;
  provider: ModelProvider;
  model: string | null;
}
export function getAccountModel(): Promise<{ model: AccountModel | null }> {
  return request('/api/account/model');
}
// POST: the Cloudflare gateway does not allow PUT.
export function setAccountModel(model: AccountModel): Promise<{ model: AccountModel }> {
  return request('/api/account/model', { method: 'POST', body: JSON.stringify(model) });
}

export interface SavedConnection {
  provider: ModelProvider;
  status: string;
  updatedAt: string | null;
}
export function listConnections(): Promise<{ connections: SavedConnection[] }> {
  return request('/api/models/connections');
}
