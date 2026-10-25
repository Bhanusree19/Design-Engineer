// src/api/client.ts
//
// Design Engineer backend client — Supabase-auth aware.
//
// The plugin authenticates every request with the Supabase access token that
// was returned by signup / signin / refresh. All account, project, GitHub and
// Codex state lives in Supabase via the backend; nothing here touches Docker.

const DEFAULT_BASE_URL = 'https://design-engineer.onrender.com';

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
  let detail: any = text || res.statusText;
  let code: string | undefined;

  try {
    const json = JSON.parse(text);
    if (json && typeof json.error === 'string') {
      detail = json.error;
      code = json.code;
    } else if (json) {
      detail = json;
    }
  } catch {
    // non-JSON body
  }

  if (!res.ok) {
    throw new ApiError(
      typeof detail === 'string'
        ? detail
        : `Request to ${path} failed (${res.status})`,
      res.status,
      code
    );
  }

  return detail as T;
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

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: string;
  repository: string | null;
  base_branch: string | null;
  stack: Stack | null;
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
  patch: Partial<Pick<Project, 'name' | 'description' | 'status' | 'repository' | 'base_branch' | 'stack'>>
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

export function implementScreens(
  projectId: string,
  screens: unknown[]
): Promise<{ implementations: ImplementationResult[] }> {
  return request('/api/screens/implement', {
    method: 'POST',
    body: JSON.stringify({ projectId, screens }),
  });
}
