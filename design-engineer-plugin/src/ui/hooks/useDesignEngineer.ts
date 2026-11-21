// src/ui/hooks/useDesignEngineer.ts
//
// All plugin behaviour lives here. Screens only read `state` and call `actions`.
//
// Flow (deployment 09): Google sign-in → Home (projects) → Project page. From the
// project page each task (link a repo, choose the AI model, build screens) is
// pushed on a navigation stack, so Back always returns to the screen that
// opened it. Back never signs out, deletes anything or cancels a build.
//
// Compatibility: the newer backend routes (repo links, account model, project
// builds) are optional. When the backend answers NOT_AVAILABLE the plugin uses
// today's behaviour: the project's own repository / branch, the model saved in
// Figma client storage, and the billing history filtered by project.

import { useEffect, useRef, useState } from 'react';

import { onPluginMessage, sendToPlugin } from '../figmaBridge';
import * as api from '../../api/client';
import type { DesignContext } from '../../figma/parser';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export type RouteName =
  | 'restoring'
  | 'signin'
  | 'google'
  | 'home'
  | 'new-project'
  | 'project'
  | 'link-github'
  | 'link-repo'
  | 'link-branch'
  | 'link-reading'
  | 'link-stack'
  | 'model'
  | 'model-connect'
  | 'screens'
  | 'plan'
  | 'running'
  | 'result'
  | 'billing';

export interface Route {
  name: RouteName;
  params?: Record<string, any>;
}

export interface SelectionItem {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
}

/** Id used for the single link made from a project's own fields on older backends. */
export const PROJECT_LINK_ID = 'project';

export type LinkState = 'ok' | 'github' | 'branch-not-found' | 'repo-not-found' | 'unknown' | 'checking';

export interface LinkFlow {
  mode: 'new' | 'branch';
  linkId: string | null;
  repository: string | null;
  branch: string | null;
  /** Route to return to when the link is finished: 'plan' or 'project'. */
  returnTo: 'plan' | 'project';
}

export interface CodexWait {
  deviceCode: string;
  userCode: string | null;
  verificationUrl: string | null;
  browserOnly: boolean;
}

export interface RunningJob {
  jobId: string;
  projectId: string;
  screens: string[];
  repository: string | null;
  branch: string | null;
  proposedBranch: string | null;
  agent: api.Agent | null;
  startedAt: number;
  status: 'queued' | 'running';
  serverStarted: boolean;
}

export interface BuildResult {
  jobId: string;
  projectId: string;
  status: 'completed' | 'failed';
  pullRequestUrl: string | null;
  branch: string | null;
  baseBranch: string | null;
  repository: string | null;
  agent: api.Agent | null;
  screens: string[];
  error: string | null;
  billedSeconds: number | null;
  startBufferSeconds: number;
  fidelity: api.FidelityResult | null;
}

interface Prefs {
  model?: api.AccountModel | null;
  job?: Omit<RunningJob, 'status' | 'serverStarted'> | null;
}

// -----------------------------------------------------------------------------
// HOOK
// -----------------------------------------------------------------------------

export function useDesignEngineer() {
  // Navigation ------------------------------------------------------------------
  const [stack, setStack] = useState<Route[]>([{ name: 'restoring' }]);
  const stackRef = useRef<Route[]>(stack);
  function setRoutes(next: Route[]) {
    stackRef.current = next;
    setStack(next);
  }
  const route = stack[stack.length - 1];

  // Feedback --------------------------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Account ---------------------------------------------------------------------
  const [user, setUser] = useState<api.AuthUser | null>(null);
  const [githubUser, setGithubUser] = useState<string | null>(null);
  const [githubConnected, setGithubConnected] = useState(false);
  const [codexConnected, setCodexConnected] = useState(false);
  const [codexUser, setCodexUser] = useState<string | null>(null);
  const [accountModel, setAccountModelState] = useState<api.AccountModel | null>(null);
  const [modelAvailable, setModelAvailable] = useState(true);
  const [connections, setConnections] = useState<api.SavedConnection[] | null>(null);
  const [billing, setBilling] = useState<api.BillingStatus | null>(null);
  const [billingHistory, setBillingHistory] = useState<api.BillingHistory | null>(null);
  const [sheet, setSheet] = useState<null | { kind: 'account' } | { kind: 'link'; linkId: string } | { kind: 'project' } | { kind: 'target' }>(null);

  // Projects --------------------------------------------------------------------
  const [projects, setProjects] = useState<api.Project[]>([]);
  const [project, setProjectState] = useState<api.Project | null>(null);
  const projectRef = useRef<api.Project | null>(null);
  function setProject(next: api.Project | null) {
    projectRef.current = next;
    setProjectState(next);
    if (next) setProjects((list) => list.map((p) => (p.id === next.id ? next : p)));
  }
  const [links, setLinksState] = useState<api.RepoLink[]>([]);
  const linksRef = useRef<api.RepoLink[]>([]);
  function setLinks(next: api.RepoLink[]) {
    linksRef.current = next;
    setLinksState(next);
  }
  const [linksAvailable, setLinksAvailable] = useState(true);
  const [linkStates, setLinkStates] = useState<Record<string, LinkState>>({});
  const [projectStates, setProjectStates] = useState<Record<string, LinkState>>({});
  const [builds, setBuilds] = useState<api.ProjectBuild[]>([]);
  const [buildsAvailable, setBuildsAvailable] = useState(true);
  const [loadingProject, setLoadingProject] = useState(false);

  // Linking ---------------------------------------------------------------------
  const [linkFlow, setLinkFlowState] = useState<LinkFlow | null>(null);
  const linkFlowRef = useRef<LinkFlow | null>(null);
  function setLinkFlow(next: LinkFlow | null) {
    linkFlowRef.current = next;
    setLinkFlowState(next);
  }
  const [repos, setRepos] = useState<api.Repo[] | null>(null);
  const [branches, setBranches] = useState<api.Branch[] | null>(null);
  const [readingContext, setReadingContext] = useState<api.RepoContext | null>(null);

  // Model -----------------------------------------------------------------------
  const [codexWait, setCodexWait] = useState<CodexWait | null>(null);

  // Building --------------------------------------------------------------------
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [extractingCount, setExtractingCount] = useState(0);
  const screensRef = useRef<DesignContext[]>([]);
  const [screens, setScreensState] = useState<DesignContext[]>([]);
  function setScreens(next: DesignContext[]) {
    screensRef.current = next;
    setScreensState(next);
  }
  const [targetLinkId, setTargetLinkIdState] = useState<string | null>(null);
  const targetLinkIdRef = useRef<string | null>(null);
  function setTargetLinkId(id: string | null) {
    targetLinkIdRef.current = id;
    setTargetLinkIdState(id);
  }
  const [plan, setPlanState] = useState<api.ScreenPlan | null>(null);
  const planRef = useRef<api.ScreenPlan | null>(null);
  function setPlan(next: api.ScreenPlan | null) {
    planRef.current = next;
    setPlanState(next);
  }
  const [planLoading, setPlanLoading] = useState(false);
  const [runningJob, setRunningJobState] = useState<RunningJob | null>(null);
  const runningJobRef = useRef<RunningJob | null>(null);
  function setRunningJob(next: RunningJob | null) {
    runningJobRef.current = next;
    setRunningJobState(next);
  }
  const [result, setResult] = useState<BuildResult | null>(null);
  const [now, setNow] = useState(Date.now());

  // Session ---------------------------------------------------------------------
  const sessionRef = useRef<api.AuthSession | null>(null);
  const endedRef = useRef(false);
  const returnProjectRef = useRef<string | null>(null);
  const prefsRef = useRef<Prefs>({});
  const prefsWaiters = useRef<((p: Prefs) => void)[]>([]);
  const prefsLoaded = useRef(false);
  const authPoll = useRef<number | null>(null);
  const jobPoll = useRef<number | null>(null);
  const handlers = useRef<{ extracted: (r: DesignContext[]) => void; saved: (s: any) => void }>({
    extracted: () => {},
    saved: () => {},
  });

  // ===========================================================================
  // NAVIGATION
  // ===========================================================================

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }
  function push(next: Route) {
    clearFeedback();
    setSheet(null);
    setRoutes([...stackRef.current, next]);
  }
  function replace(next: Route) {
    clearFeedback();
    setSheet(null);
    setRoutes([...stackRef.current.slice(0, -1), next]);
  }
  function resetTo(next: Route[]) {
    clearFeedback();
    setSheet(null);
    setRoutes(next);
  }
  function has(name: RouteName) {
    return stackRef.current.some((r) => r.name === name);
  }
  /** Pops back to the last route with this name. Returns false if none. */
  function popTo(name: RouteName): boolean {
    const s = stackRef.current;
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].name === name) {
        clearFeedback();
        setSheet(null);
        setRoutes(s.slice(0, i + 1));
        return true;
      }
    }
    return false;
  }
  function current(): Route {
    const s = stackRef.current;
    return s[s.length - 1];
  }

  function stopAuthPoll() {
    if (authPoll.current !== null) {
      window.clearInterval(authPoll.current);
      authPoll.current = null;
    }
  }
  function stopJobPoll() {
    if (jobPoll.current !== null) {
      window.clearInterval(jobPoll.current);
      jobPoll.current = null;
    }
  }

  /** Back: leaves the current screen without undoing anything. */
  function back() {
    const here = current();
    if (sheet) {
      setSheet(null);
      return;
    }
    // Leaving a waiting screen stops the wait (never the build).
    stopAuthPoll();
    setCodexWait(null);
    setBusy(null);
    if (here.name === 'result' && result?.status === 'failed' && planRef.current && screensRef.current.length) {
      // A failed build goes back to its plan, with the screens still selected.
      const p = projectRef.current;
      if (p) {
        resetTo([{ name: 'home' }, { name: 'project', params: { id: p.id } }, { name: 'screens' }, { name: 'plan' }]);
        return;
      }
    }
    const s = stackRef.current;
    if (s.length <= 1) return;
    const prev = s[s.length - 2];
    clearFeedback();
    setRoutes(s.slice(0, -1));
    if (prev.name === 'project' && projectRef.current) void refreshProject(projectRef.current.id);
    if (prev.name === 'home') void loadHome();
  }

  // ===========================================================================
  // FEEDBACK + AUTH HELPERS
  // ===========================================================================

  function fail(message: string, err?: unknown) {
    if (err) console.error('[Design Engineer]', message, err);
    setBusy(null);
    if (endedRef.current) return; // the session-ended screen explains itself
    setError(message);
  }

  async function authed<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      // A 401 about GitHub means GitHub needs reconnecting, not that the session ended.
      if (!(err instanceof api.ApiError) || err.status !== 401 || err.code === 'GITHUB_REAUTH_REQUIRED') throw err;
      const refreshToken = sessionRef.current?.refreshToken;
      if (!refreshToken) {
        sessionEnded();
        throw err;
      }
      let refreshed: api.AuthSession;
      try {
        refreshed = await api.refreshSession(refreshToken);
      } catch (refreshError) {
        sessionEnded();
        throw err;
      }
      acceptSession(refreshed, false);
      return fn();
    }
  }

  function sessionEnded() {
    if (endedRef.current) return;
    endedRef.current = true;
    stopAuthPoll();
    returnProjectRef.current = projectRef.current?.id || null;
    api.setAccessToken(null);
    sessionRef.current = null;
    sendToPlugin({ type: 'clear-session' });
    setRoutes([{ name: 'signin', params: { ended: true, projectName: projectRef.current?.name || null } }]);
    setSheet(null);
    setBusy(null);
    setError(null);
  }

  function acceptSession(session: api.AuthSession, persist = true) {
    sessionRef.current = session;
    api.setAccessToken(session.accessToken);
    if (persist || session.refreshToken) sendToPlugin({ type: 'save-session', session });
  }

  // ===========================================================================
  // PREFERENCES (Figma client storage, via code.ts)
  // ===========================================================================

  function loadPrefs(): Promise<Prefs> {
    if (prefsLoaded.current) return Promise.resolve(prefsRef.current);
    return new Promise((resolve) => {
      prefsWaiters.current.push(resolve);
      sendToPlugin({ type: 'get-prefs' });
      // Never block start-up on storage.
      window.setTimeout(() => {
        if (!prefsLoaded.current) {
          prefsLoaded.current = true;
          prefsWaiters.current.splice(0).forEach((w) => w(prefsRef.current));
        }
      }, 1500);
    });
  }
  function savePrefs(patch: Partial<Prefs>) {
    prefsRef.current = { ...prefsRef.current, ...patch };
    sendToPlugin({ type: 'set-prefs', prefs: prefsRef.current });
  }

  // ===========================================================================
  // START-UP
  // ===========================================================================

  useEffect(() => {
    const cleanup = onPluginMessage((msg) => {
      if (msg.type === 'saved-session') handlers.current.saved(msg.session || null);
      if (msg.type === 'prefs') {
        prefsRef.current = msg.prefs && typeof msg.prefs === 'object' ? msg.prefs : {};
        prefsLoaded.current = true;
        prefsWaiters.current.splice(0).forEach((w) => w(prefsRef.current));
      }
      if (msg.type === 'selection-changed') applySelection(msg.selection || []);
      if (msg.type === 'extract-started') setExtractingCount(msg.total || 0);
      if (msg.type === 'extraction-error') fail(msg.error || 'Figma could not read the selected screens.');
      if (msg.type === 'screens-extracted') handlers.current.extracted(msg.results || []);
    });
    sendToPlugin({ type: 'get-saved-session' });
    sendToPlugin({ type: 'get-selection' });
    return () => {
      cleanup();
      stopAuthPoll();
      stopJobPoll();
    };
    // Listener intentionally registered once; handlers are read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ticking clock for running-build timers.
  useEffect(() => {
    if (!runningJob) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [runningJob]);

  async function restoreSavedSession(saved: api.AuthSession | null) {
    if (!saved?.accessToken || !saved.refreshToken) {
      setRoutes([{ name: 'signin' }]);
      return;
    }
    sessionRef.current = saved;
    api.setAccessToken(saved.accessToken);
    try {
      await enterApp();
    } catch (err) {
      if (endedRef.current) return;
      console.error('[Design Engineer] Restore failed', err);
      setRoutes([{ name: 'signin' }]);
      setError(describe(err, 'Your saved session could not be restored.'));
    }
  }

  async function enterApp() {
    const me = await authed(() => api.getMe());
    endedRef.current = false;
    setUser(me.user);
    setGithubConnected(!!me.github?.connected);
    setGithubUser(me.github?.githubUser || null);
    setCodexConnected(!!me.codex?.connected);
    setCodexUser(me.codex?.codexUser || null);
    const list = Array.isArray(me.projects) ? me.projects : [];
    setProjects(list);
    const prefs = await loadPrefs();
    await Promise.all([
      loadAccountModel(list, prefs),
      refreshBilling(),
      loadConnections(),
    ]);
    const returnTo = returnProjectRef.current;
    returnProjectRef.current = null;
    const resumed = await resumeJob(prefs, list);
    if (resumed) return;
    if (returnTo && list.some((p) => p.id === returnTo)) {
      setRoutes([{ name: 'home' }, { name: 'project', params: { id: returnTo } }]);
      void openProjectData(returnTo);
      return;
    }
    setRoutes([{ name: 'home' }]);
    void checkProjects(list, !!me.github?.connected);
  }

  async function retryHome() {
    clearFeedback();
    setBusy('home');
    try {
      await enterApp();
      setBusy(null);
    } catch (err) {
      fail(describe(err, "Couldn't load your projects."), err);
    }
  }

  async function loadHome() {
    try {
      const data = await authed(() => api.listProjects());
      const list = data.projects || [];
      setProjects(list);
      void refreshBilling();
      void checkProjects(list, githubConnected);
    } catch (err) {
      console.warn('[Design Engineer] Projects refresh failed', err);
    }
  }

  // ===========================================================================
  // GOOGLE SIGN-IN (the only sign-in)
  // ===========================================================================

  async function signInWithGoogle() {
    clearFeedback();
    stopAuthPoll();
    try {
      const { url, state: oauthState } = await api.googleConnect();
      window.open(url, '_blank');
      const s = stackRef.current;
      setRoutes([...(current().name === 'google' ? s.slice(0, -1) : s), { name: 'google', params: { url } }]);
      authPoll.current = window.setInterval(async () => {
        try {
          const status = await api.googleStatus(oauthState);
          if (status.status === 'done' && status.session) {
            stopAuthPoll();
            acceptSession(status.session);
            setRoutes([{ name: 'restoring' }]);
            try {
              await enterApp();
            } catch (err) {
              setRoutes([{ name: 'signin' }]);
              fail(describe(err, "Signed in, but your projects couldn't be loaded."), err);
            }
          } else if (status.status === 'error' || status.status === 'expired') {
            stopAuthPoll();
            setRoutes([{ name: 'signin' }]);
            fail(status.error || 'Google sign-in expired. Please try again.');
          }
        } catch (err) {
          console.warn('[Design Engineer] Google polling', err);
        }
      }, 2000);
    } catch (err) {
      fail(describe(err, "Google sign-in couldn't start."), err);
    }
  }

  function reopenGoogle() {
    const url = current().params?.url;
    if (url) window.open(url, '_blank');
  }

  function cancelGoogle() {
    stopAuthPoll();
    setRoutes([{ name: 'signin', params: current().params?.ended ? { ended: true } : undefined }]);
  }

  async function logout(thenSignIn = false) {
    setSheet(null);
    stopAuthPoll();
    stopJobPoll();
    try {
      await api.logout();
    } catch (err) {
      console.warn('[Design Engineer] Logout request failed', err);
    }
    api.setAccessToken(null);
    sessionRef.current = null;
    sendToPlugin({ type: 'clear-session' });
    prefsRef.current = {};
    setUser(null);
    setProjects([]);
    setProject(null);
    setLinks([]);
    setBuilds([]);
    setBilling(null);
    setBillingHistory(null);
    setAccountModelState(null);
    setConnections(null);
    setRunningJob(null);
    setResult(null);
    setPlan(null);
    setScreens([]);
    setGithubConnected(false);
    setGithubUser(null);
    setRoutes([{ name: 'signin' }]);
    if (thenSignIn) void signInWithGoogle();
  }

  // ===========================================================================
  // BILLING
  // ===========================================================================

  async function refreshBilling(): Promise<api.BillingStatus | null> {
    try {
      const data = await authed(() => api.billingStatus());
      setBilling(data);
      return data;
    } catch (err) {
      console.warn('[Design Engineer] Minutes unavailable', err);
      return null;
    }
  }

  async function openBilling() {
    push({ name: 'billing' });
    void refreshBilling();
    try {
      setBillingHistory(await authed(() => api.billingHistory()));
    } catch (err) {
      console.warn('[Design Engineer] History unavailable', err);
    }
  }

  async function buyPlan(plan: 'plus' | 'studio') {
    clearFeedback();
    setBusy('checkout');
    try {
      const { checkoutUrl } = await authed(() => api.startCheckout(plan));
      window.open(checkoutUrl, '_blank');
      setBusy(null);
      setNotice('Finish paying in your browser, then come back. Your minutes update by themselves.');
    } catch (err) {
      fail(describe(err, "Couldn't open checkout."), err);
    }
  }

  // Keep the balance fresh while it matters.
  useEffect(() => {
    if (!user) return;
    const fast = ['billing', 'plan', 'running'].includes(route.name);
    const t = window.setInterval(() => void refreshBilling(), fast ? 5000 : 30000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name, user]);

  // ===========================================================================
  // AI MODEL (per account)
  // ===========================================================================

  function modelFromProject(list: api.Project[]): api.AccountModel | null {
    const withModel = [...list]
      .filter((p) => p.coding_agent)
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    const p = withModel[0];
    if (!p || !p.coding_agent) return null;
    return { agent: p.coding_agent, provider: (p.model_provider || defaultProvider(p.coding_agent)) as api.ModelProvider, model: p.model_id || null };
  }

  async function loadAccountModel(list: api.Project[], prefs: Prefs) {
    try {
      const data = await authed(() => api.getAccountModel());
      setModelAvailable(true);
      if (data.model) {
        setAccountModelState(data.model);
        return;
      }
      // First time on the new backend: carry over what this person used before.
      const carried = prefs.model || modelFromProject(list);
      if (carried) {
        setAccountModelState(carried);
        try {
          await authed(() => api.setAccountModel(carried));
        } catch (err) {
          console.warn('[Design Engineer] Could not carry the model over', err);
        }
      } else setAccountModelState(null);
    } catch (err) {
      if (!api.isNotAvailable(err)) console.warn('[Design Engineer] Account model unavailable', err);
      setModelAvailable(false);
      setAccountModelState(prefs.model || modelFromProject(list));
    }
  }

  async function loadConnections() {
    try {
      const data = await authed(() => api.listConnections());
      setConnections(data.connections || []);
    } catch (err) {
      setConnections(null);
    }
  }

  async function refreshCodex() {
    try {
      const status = await authed(() => api.codexStatus());
      setCodexConnected(!!status.connected);
      setCodexUser(status.codexUser || null);
      return !!status.connected;
    } catch {
      return codexConnected;
    }
  }

  /** Whether an agent can be used without connecting first. */
  function isConnected(agent: api.Agent, provider?: api.ModelProvider | null): boolean {
    if (agent === 'codex') return codexConnected;
    const p = provider || defaultProvider(agent);
    if (connections) {
      if (agent === 'opencode' && p === 'opencode' && accountModel?.agent === 'opencode') return true;
      return connections.some((c) => c.provider === p);
    }
    // Older backends can't list saved keys: the current choice was verified when made.
    return !!accountModel && accountModel.agent === agent && (!provider || accountModel.provider === provider);
  }

  function agentConnected(agent: api.Agent): boolean {
    if (agent === 'codex') return codexConnected;
    if (agent === 'claude') return isConnected('claude', 'anthropic');
    if (accountModel?.agent === agent) return isConnected(agent, accountModel.provider);
    return false;
  }

  function openModel() {
    if (runningJobRef.current && projectRef.current && runningJobRef.current.projectId === projectRef.current.id && current().name === 'project') {
      setNotice('The AI model is locked while a build is running.');
      return;
    }
    push({ name: 'model' });
    void refreshCodex();
    void loadConnections();
  }

  /** A connected agent is used straight away; otherwise its Connect screen opens. */
  async function chooseAgent(agent: api.Agent) {
    clearFeedback();
    if (agent === 'codex') {
      if (codexConnected || (await refreshCodex())) {
        await finishModel({ agent: 'codex', provider: 'openai', model: null });
        return;
      }
      push({ name: 'model-connect', params: { agent } });
      void startCodexConnect();
      return;
    }
    if (agent === 'claude' && isConnected('claude', 'anthropic')) {
      await finishModel({ agent: 'claude', provider: 'anthropic', model: accountModel?.agent === 'claude' ? accountModel.model : null });
      return;
    }
    if ((agent === 'opencode' || agent === 'direct-api') && accountModel?.agent === agent) {
      await finishModel(accountModel);
      return;
    }
    push({ name: 'model-connect', params: { agent } });
  }

  function changeModelSettings(agent: api.Agent) {
    clearFeedback();
    push({ name: 'model-connect', params: { agent } });
    if (agent === 'codex') void startCodexConnect();
  }

  async function saveAccountModel(model: api.AccountModel) {
    setAccountModelState(model);
    savePrefs({ model });
    if (!modelAvailable) return;
    try {
      await authed(() => api.setAccountModel(model));
    } catch (err) {
      if (api.isNotAvailable(err)) {
        setModelAvailable(false);
        return;
      }
      throw err;
    }
  }

  /** Saves the account model and returns to the screen that opened the picker. */
  async function finishModel(model: api.AccountModel) {
    setBusy('model');
    try {
      await saveAccountModel(model);
      setBusy(null);
      void loadConnections();
      const s = stackRef.current;
      let i = s.length - 1;
      while (i > 0 && (s[i].name === 'model' || s[i].name === 'model-connect')) i--;
      setRoutes(s.slice(0, i + 1));
      clearFeedback();
      setCodexWait(null);
      stopAuthPoll();
      if (s[i].name === 'plan') void preparePlan();
    } catch (err) {
      fail(describe(err, "Couldn't save the AI model."), err);
    }
  }

  async function startCodexConnect() {
    clearFeedback();
    stopAuthPoll();
    setCodexWait(null);
    setBusy('codex');
    try {
      const device = await authed(() => api.startCodexAuth());
      if (device.alreadyAuthenticated) {
        setCodexConnected(true);
        setCodexUser(device.codexUser || null);
        await finishModel({ agent: 'codex', provider: 'openai', model: null });
        return;
      }
      const wait: CodexWait = {
        deviceCode: device.device_code,
        userCode: device.userCode || null,
        verificationUrl: device.verificationUrl || null,
        browserOnly: !device.deviceAuth,
      };
      setCodexWait(wait);
      setBusy(null);
      if (wait.userCode) copyText(wait.userCode);
      if (wait.verificationUrl) window.open(wait.verificationUrl, '_blank');
      authPoll.current = window.setInterval(async () => {
        try {
          const status = await api.getCodexAuthStatus(device.device_code);
          if (status.status === 'approved') {
            stopAuthPoll();
            setCodexConnected(true);
            setCodexUser(status.codexUser || null);
            await finishModel({ agent: 'codex', provider: 'openai', model: null });
          } else if (status.status === 'expired') {
            stopAuthPoll();
            setCodexWait(null);
            fail(status.error || "Codex sign-in didn't finish. Try again.");
          }
        } catch (err) {
          console.warn('[Design Engineer] Codex polling', err);
        }
      }, Math.max(1, device.interval || 3) * 1000);
    } catch (err) {
      fail(describe(err, "Codex sign-in couldn't start."), err);
    }
  }

  /** Verifies a key (or a saved key) with the provider, then uses it. */
  async function connectModel(agent: api.Agent, provider: api.ModelProvider, model: string | null, apiKey: string) {
    clearFeedback();
    setBusy('verify');
    try {
      const key = apiKey.trim();
      if (key) await authed(() => api.saveProviderKey(agent, provider, model, key));
      else await authed(() => api.verifyModel(agent, provider, model));
      setBusy(null);
      await finishModel({ agent, provider, model });
    } catch (err) {
      fail(describe(err, "Couldn't verify this connection."), err);
    }
  }

  /** Right before plan / implement the project gets the account model. */
  async function applyModelToProject(p: api.Project): Promise<api.Project> {
    const m = accountModel;
    if (!m) return p;
    if (p.coding_agent === m.agent && (p.model_provider || null) === (m.provider || null) && (p.model_id || null) === (m.model || null)) return p;
    const updated = await authed(() => api.updateProject(p.id, { coding_agent: m.agent, model_provider: m.provider, model_id: m.model }));
    setProject(updated.project);
    return updated.project;
  }

  // ===========================================================================
  // PROJECTS
  // ===========================================================================

  async function createProject(name: string, description: string) {
    const clean = name.trim();
    if (!clean) {
      setError('Give the project a name.');
      return;
    }
    clearFeedback();
    setBusy('create');
    try {
      const data = await authed(() => api.createProject(clean, description.trim() || undefined));
      setProjects((list) => [data.project, ...list.filter((p) => p.id !== data.project.id)]);
      setBusy(null);
      replace({ name: 'project', params: { id: data.project.id } });
      void openProjectData(data.project.id, data.project);
    } catch (err) {
      fail(describe(err, "Couldn't create the project."), err);
    }
  }

  function openProject(id: string) {
    const p = projects.find((x) => x.id === id) || null;
    push({ name: 'project', params: { id } });
    void openProjectData(id, p);
  }

  async function openProjectData(id: string, known?: api.Project | null) {
    if (known) setProject(known);
    else if (projectRef.current?.id !== id) setProject(projects.find((p) => p.id === id) || null);
    if (projectRef.current?.id !== id) {
      setLinks([]);
      setBuilds([]);
      setLinkStates({});
    }
    setTargetLinkId(null);
    setLoadingProject(true);
    await refreshProject(id);
    setLoadingProject(false);
  }

  async function refreshProject(id: string) {
    try {
      const data = await authed(() => api.getProject(id));
      setProject(data.project);
      const l = await loadLinks(data.project);
      void loadBuilds(data.project);
      void checkLinks(l);
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 404) {
        fail('This project no longer exists.');
        resetTo([{ name: 'home' }]);
        void loadHome();
        return;
      }
      fail(describe(err, "Couldn't load the project."), err);
    }
  }

  function legacyLinks(p: api.Project): api.RepoLink[] {
    if (!p.repository || !p.base_branch) return [];
    return [{
      id: PROJECT_LINK_ID,
      projectId: p.id,
      repository: p.repository,
      branch: p.base_branch,
      appRoot: '',
      stack: p.stack || null,
      stackSource: p.stack_source || null,
      repoContext: p.repo_context || null,
      isDefault: true,
      lastCheckedAt: null,
    }];
  }

  async function loadLinks(p: api.Project): Promise<api.RepoLink[]> {
    try {
      const data = await authed(() => api.listRepoLinks(p.id));
      setLinksAvailable(true);
      const l = data.links || [];
      setLinks(l);
      return l;
    } catch (err) {
      if (!api.isNotAvailable(err)) console.warn('[Design Engineer] Links unavailable', err);
      setLinksAvailable(false);
      const l = legacyLinks(p);
      setLinks(l);
      return l;
    }
  }

  async function loadBuilds(p: api.Project) {
    try {
      const data = await authed(() => api.listProjectBuilds(p.id));
      setBuildsAvailable(true);
      setBuilds(data.builds || []);
    } catch (err) {
      setBuildsAvailable(false);
      try {
        const h = await authed(() => api.billingHistory());
        setBillingHistory(h);
        setBuilds(
          (h.builds || [])
            .filter((b) => b.projectName === p.name)
            .map((b) => ({
              jobId: b.jobId,
              status: b.status,
              repository: null,
              branch: null,
              agent: null,
              provider: null,
              model: null,
              screenCount: b.screenCount,
              billedSeconds: b.billedSeconds,
              pullRequestUrl: null,
              error: b.error,
              createdAt: b.createdAt,
              startedAt: b.startedAt,
              finishedAt: b.finishedAt,
            }))
        );
      } catch {
        setBuilds([]);
      }
    }
  }

  async function linkState(repository: string, branch: string): Promise<LinkState> {
    const [owner, repo] = repository.split('/');
    try {
      const data = await authed(() => api.listBranches(owner, repo));
      return (data.branches || []).some((b) => b.name === branch) ? 'ok' : 'branch-not-found';
    } catch (err) {
      if (err instanceof api.ApiError) {
        if (err.code === 'GITHUB_REAUTH_REQUIRED' || err.status === 403) return 'github';
        if (err.status === 404) return 'repo-not-found';
      }
      return 'unknown';
    }
  }

  async function checkLinks(l: api.RepoLink[]) {
    if (!l.length) return;
    if (!githubConnectedRef.current) {
      setLinkStates(Object.fromEntries(l.map((x) => [x.id, 'github' as LinkState])));
      return;
    }
    setLinkStates(Object.fromEntries(l.map((x) => [x.id, 'checking' as LinkState])));
    const pairs = await Promise.all(l.map(async (x) => [x.id, await linkState(x.repository, x.branch)] as const));
    setLinkStates(Object.fromEntries(pairs));
    const p = projectRef.current;
    if (p) setProjectStates((s) => ({ ...s, [p.id]: worst(pairs.map(([, v]) => v)) }));
  }

  const githubConnectedRef = useRef(false);
  useEffect(() => {
    githubConnectedRef.current = githubConnected;
  }, [githubConnected]);

  async function checkProjects(list: api.Project[], connected: boolean) {
    const withRepo = list.filter((p) => p.repository && p.base_branch).slice(0, 12);
    if (!withRepo.length) return;
    if (!connected) {
      setProjectStates(Object.fromEntries(withRepo.map((p) => [p.id, 'github' as LinkState])));
      return;
    }
    const entries = await Promise.all(withRepo.map(async (p) => [p.id, await linkState(p.repository!, p.base_branch!)] as const));
    setProjectStates((s) => ({ ...s, ...Object.fromEntries(entries) }));
  }

  async function renameProject(id: string, name: string) {
    const clean = name.trim();
    if (!clean) return;
    try {
      const data = await authed(() => api.updateProject(id, { name: clean }));
      setProjects((list) => list.map((p) => (p.id === id ? data.project : p)));
      if (projectRef.current?.id === id) setProject(data.project);
    } catch (err) {
      fail(describe(err, "Couldn't rename the project."), err);
    }
  }

  async function deleteProject(id: string) {
    setBusy('delete');
    try {
      await authed(() => api.deleteProject(id));
      setProjects((list) => list.filter((p) => p.id !== id));
      setBusy(null);
      setSheet(null);
      if (projectRef.current?.id === id) {
        setProject(null);
        resetTo([{ name: 'home' }]);
      }
    } catch (err) {
      fail(describe(err, "Couldn't delete the project."), err);
    }
  }

  // ===========================================================================
  // GITHUB + REPOSITORY LINKS
  // ===========================================================================

  function startLink(mode: 'new' | 'branch', linkId: string | null = null) {
    const l = linkId ? linksRef.current.find((x) => x.id === linkId) || null : null;
    const returnTo: 'plan' | 'project' = current().name === 'plan' ? 'plan' : 'project';
    setLinkFlow({ mode, linkId, repository: l?.repository || null, branch: l?.branch || null, returnTo });
    setSheet(null);
    if (!githubConnectedRef.current || (l && linkStates[l.id] === 'github')) {
      push({ name: 'link-github' });
      return;
    }
    if (mode === 'branch' && l) {
      push({ name: 'link-branch', params: { repository: l.repository } });
      void loadBranches(l.repository);
    } else {
      push({ name: 'link-repo' });
      void loadRepos();
    }
  }

  async function connectGithub() {
    clearFeedback();
    stopAuthPoll();
    try {
      const { url } = await authed(() => api.githubConnect());
      window.open(url, '_blank');
      setBusy('github');
      replace({ name: 'link-github', params: { waiting: true, url } });
      authPoll.current = window.setInterval(async () => {
        try {
          const status = await authed(() => api.githubStatus());
          if (status.connected) {
            stopAuthPoll();
            setBusy(null);
            setGithubConnected(true);
            githubConnectedRef.current = true;
            setGithubUser(status.githubUser || null);
            afterGithub();
          }
        } catch (err) {
          console.warn('[Design Engineer] GitHub polling', err);
        }
      }, 2000);
    } catch (err) {
      fail(describe(err, "GitHub sign-in couldn't start."), err);
    }
  }

  function afterGithub() {
    const flow = linkFlowRef.current;
    if (!flow) {
      // Connected from the account sheet.
      back();
      return;
    }
    if (flow.mode === 'branch' && flow.repository) {
      replace({ name: 'link-branch', params: { repository: flow.repository } });
      void loadBranches(flow.repository);
    } else {
      replace({ name: 'link-repo' });
      void loadRepos();
    }
    void checkLinks(linksRef.current);
  }

  function reopenGithub() {
    const url = current().params?.url;
    if (url) window.open(url, '_blank');
  }

  function cancelGithub() {
    stopAuthPoll();
    setBusy(null);
    if (current().params?.waiting) replace({ name: 'link-github' });
    else back();
  }

  async function disconnectGithub() {
    try {
      await authed(() => api.githubDisconnect());
      setGithubConnected(false);
      githubConnectedRef.current = false;
      setGithubUser(null);
      setRepos(null);
    } catch (err) {
      fail(describe(err, "Couldn't disconnect GitHub."), err);
    }
  }

  function connectGithubFromAccount() {
    setSheet(null);
    setLinkFlow(null);
    push({ name: 'link-github' });
  }

  async function loadRepos() {
    setRepos(null);
    try {
      const data = await authed(() => api.listRepos());
      setRepos(data.repos || []);
    } catch (err) {
      setRepos([]);
      fail(describe(err, "Couldn't load your repositories."), err);
    }
  }

  async function loadBranches(repository: string) {
    setBranches(null);
    try {
      const [owner, repo] = repository.split('/');
      const data = await authed(() => api.listBranches(owner, repo));
      setBranches(data.branches || []);
    } catch (err) {
      setBranches([]);
      fail(describe(err, "Couldn't load branches."), err);
    }
  }

  function chooseLinkRepo(repository: string) {
    const flow = linkFlowRef.current;
    if (flow) setLinkFlow({ ...flow, repository });
    push({ name: 'link-branch', params: { repository } });
    void loadBranches(repository);
  }

  async function confirmLinkBranch(branch: string) {
    const p = projectRef.current;
    const flow = linkFlowRef.current;
    const repository = current().params?.repository || flow?.repository;
    if (!p || !flow || !repository) return;
    clearFeedback();
    setBusy('link');
    try {
      let activeId: string | null = null;
      if (linksAvailable) {
        let link: api.RepoLink | null = null;
        if (flow.mode === 'branch' && flow.linkId && flow.linkId !== PROJECT_LINK_ID) {
          link = (await authed(() => api.updateRepoLink(p.id, flow.linkId!, { branch }))).link;
        } else {
          try {
            link = (await authed(() => api.addRepoLink(p.id, { repository, branch }))).link;
          } catch (err) {
            if (!(err instanceof api.ApiError && err.code === 'ALREADY_LINKED')) throw err;
            link = linksRef.current.find((x) => x.repository === repository && x.branch === branch) || null;
            if (!link) link = ((await authed(() => api.listRepoLinks(p.id))).links || []).find((x) => x.repository === repository && x.branch === branch) || null;
          }
        }
        if (!link) throw new Error('The repository could not be linked.');
        const activated = await authed(() => api.activateRepoLink(p.id, link!.id));
        setProject(activated.project);
        activeId = link.id;
      } else {
        // Older backend: the project holds exactly one repository and branch.
        const updated = await authed(() => api.updateProject(p.id, { repository, base_branch: branch }));
        setProject(updated.project);
        activeId = PROJECT_LINK_ID;
      }
      setLinkFlow({ ...flow, repository, branch, linkId: activeId });
      setBusy(null);
      replace({ name: 'link-reading', params: { repository, branch } });
      await readRepo();
    } catch (err) {
      fail(describe(err, "Couldn't link the repository."), err);
    }
  }

  async function readRepo() {
    const p = projectRef.current;
    if (!p) return;
    setReadingContext(null);
    try {
      const analysis = await authed(() => api.analyzeRepoContext(p.id));
      if (analysis.project) setProject(analysis.project);
      setReadingContext(analysis.context || null);
      if (analysis.autoStack && analysis.context?.app) {
        await finishLink();
        return;
      }
      if (current().name === 'link-reading') replace({ name: 'link-stack', params: { context: analysis.context || null } });
    } catch (err) {
      console.warn('[Design Engineer] Repository context unavailable', err);
      if (current().name === 'link-reading') {
        replace({ name: 'link-stack', params: { context: null } });
        setNotice("Couldn't read the repository just now, so choose the stack yourself.");
      }
    }
  }

  async function chooseLinkStack(stack: api.Stack) {
    const p = projectRef.current;
    if (!p) return;
    clearFeedback();
    setBusy('stack');
    try {
      const updated = await authed(() => api.updateProject(p.id, { stack }));
      setProject(updated.project);
      setBusy(null);
      await finishLink();
    } catch (err) {
      fail(describe(err, "Couldn't save the stack."), err);
    }
  }

  async function finishLink() {
    const flow = linkFlowRef.current;
    const p = projectRef.current;
    setLinkFlow(null);
    if (p) {
      const l = await loadLinks(p);
      void checkLinks(l);
      if (flow?.linkId) setTargetLinkId(flow.linkId);
    }
    if (flow?.returnTo === 'plan' && popTo('plan')) {
      void preparePlan();
      return;
    }
    if (!popTo('project')) resetTo([{ name: 'home' }]);
  }

  /** Changes the stack of one link: that link becomes the project's active one first. */
  async function openStackFor(linkId: string) {
    const l = linksRef.current.find((x) => x.id === linkId);
    const p = projectRef.current;
    if (!l || !p) return;
    const returnTo: 'plan' | 'project' = current().name === 'plan' ? 'plan' : 'project';
    if (l.id !== PROJECT_LINK_ID && (p.repository !== l.repository || p.base_branch !== l.branch)) {
      try {
        const activated = await authed(() => api.activateRepoLink(p.id, l.id));
        setProject(activated.project);
      } catch (err) {
        fail(describe(err, "Couldn't open this repo's stack."), err);
        return;
      }
    }
    setLinkFlow({ mode: 'branch', linkId, repository: l.repository, branch: l.branch, returnTo });
    push({ name: 'link-stack', params: { context: l.repoContext || null } });
  }

  async function makeDefaultLink(linkId: string) {
    const p = projectRef.current;
    if (!p || !linksAvailable) return;
    try {
      await authed(() => api.updateRepoLink(p.id, linkId, { isDefault: true }));
      setSheet(null);
      await loadLinks(p);
    } catch (err) {
      fail(describe(err, "Couldn't make this the default."), err);
    }
  }

  async function unlink(linkId: string) {
    const p = projectRef.current;
    if (!p) return;
    setBusy('unlink');
    try {
      if (linksAvailable && linkId !== PROJECT_LINK_ID) {
        await authed(() => api.deleteRepoLink(p.id, linkId));
        const fresh = await authed(() => api.getProject(p.id));
        setProject(fresh.project);
      } else {
        const updated = await authed(() => api.updateProject(p.id, { repository: null, base_branch: null }));
        setProject(updated.project);
      }
      setBusy(null);
      setSheet(null);
      if (targetLinkIdRef.current === linkId) setTargetLinkId(null);
      const l = await loadLinks(projectRef.current || p);
      void checkLinks(l);
    } catch (err) {
      fail(describe(err, "Couldn't unlink the repository."), err);
    }
  }

  // ===========================================================================
  // SCREENS → PLAN → BUILD
  // ===========================================================================

  function applySelection(next: SelectionItem[]) {
    setSelection((previous) => {
      const previousIds = new Set(previous.map((s) => s.id));
      setCheckedIds((checked) => {
        const out = new Set<string>();
        for (const item of next) if (checked.has(item.id) || !previousIds.has(item.id)) out.add(item.id);
        return out;
      });
      return next;
    });
  }

  function toggleChecked(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function checkAll() {
    setCheckedIds(new Set(selection.map((s) => s.id)));
  }
  function clearChecked() {
    setCheckedIds(new Set());
  }

  function targetLink(): api.RepoLink | null {
    const l = linksRef.current;
    return l.find((x) => x.id === targetLinkIdRef.current) || l.find((x) => x.isDefault) || l[0] || null;
  }

  function startBuild() {
    const p = projectRef.current;
    if (!p) return;
    if (runningJobRef.current?.projectId === p.id) {
      push({ name: 'running' });
      return;
    }
    if (!linksRef.current.length) {
      startLink('new');
      return;
    }
    setScreens([]);
    setPlan(null);
    // A new build starts with everything selected on the canvas ticked.
    setCheckedIds(new Set(selection.map((s) => s.id)));
    push({ name: 'screens' });
    sendToPlugin({ type: 'get-selection' });
  }

  function fetchScreens() {
    if (checkedIds.size === 0) {
      setError('Select at least one screen.');
      return;
    }
    clearFeedback();
    setExtractingCount(checkedIds.size);
    setBusy('extracting');
    sendToPlugin({ type: 'extract-screens', nodeIds: Array.from(checkedIds) });
  }

  async function handleExtracted(results: DesignContext[]) {
    const p = projectRef.current;
    const target = targetLink();
    if (!p || !target) {
      fail('Link a repository before fetching screens.');
      return;
    }
    if (!results.length) {
      fail('Figma returned nothing for these screens.');
      return;
    }
    setBusy('saving');
    try {
      await authed(() => api.submitScreens(p.id, target.repository, target.branch, results));
      const merged = new Map<string, DesignContext>();
      // The reference export is only for the server's fidelity check; don't keep it in memory.
      for (const s of [...screensRef.current, ...results]) {
        if (!s.screen) continue;
        const { fidelityReference: _ref, ...kept } = s;
        merged.set(s.screen, kept);
      }
      setScreens(Array.from(merged.values()));
      setCheckedIds(new Set());
      setBusy(null);
      if (current().name !== 'plan') push({ name: 'plan' });
      await preparePlan();
    } catch (err) {
      fail(describe(err, "Couldn't save the screens."), err);
    }
  }

  /** Points the project at the chosen link, applies the account model, plans. */
  async function preparePlan() {
    let p = projectRef.current;
    const target = targetLink();
    const list = screensRef.current;
    if (!p || !target || !list.length) return;
    setPlanLoading(true);
    setPlan(null);
    clearFeedback();
    try {
      if (target.id !== PROJECT_LINK_ID && (p.repository !== target.repository || p.base_branch !== target.branch)) {
        const activated = await authed(() => api.activateRepoLink(p!.id, target.id));
        setProject(activated.project);
        p = activated.project;
      }
      p = await applyModelToProject(p);
      if (!p.stack) {
        setPlanLoading(false);
        return; // the checklist asks for the stack
      }
      const data = await authed(() => api.planScreens(p!.id, list.map(({ screen }) => ({ screen }))));
      setPlan(data);
      setPlanLoading(false);
    } catch (err) {
      setPlanLoading(false);
      fail(describe(err, "Couldn't make the plan."), err);
    }
  }

  function chooseTarget(linkId: string) {
    setTargetLinkId(linkId);
    setSheet(null);
    void preparePlan();
  }

  function rememberJob(job: RunningJob | null) {
    savePrefs({
      job: job ? {
        jobId: job.jobId, projectId: job.projectId, screens: job.screens, repository: job.repository,
        branch: job.branch, proposedBranch: job.proposedBranch, agent: job.agent, startedAt: job.startedAt,
      } : null,
    });
  }

  async function startImplementation() {
    const p = projectRef.current;
    const list = screensRef.current;
    const currentPlan = planRef.current;
    if (!p || !list.length || !currentPlan) {
      setError('Make a plan before starting the build.');
      return;
    }
    clearFeedback();
    setBusy('starting');
    try {
      const minutes = await refreshBilling();
      if (minutes && minutes.usage.availableSeconds < 60) {
        setBusy(null);
        push({ name: 'billing' });
        setError('You have less than 1 build minute left. Choose Plus or Studio to keep building.');
        return;
      }
      const ready = await applyModelToProject(p);
      const response = await authed(() => api.implementScreens(ready.id, list.map(({ screen }) => ({ screen }))));
      const target = targetLink();
      const base: RunningJob = {
        jobId: 'jobId' in response ? response.jobId : `sync-${Date.now()}`,
        projectId: ready.id,
        screens: list.map((s) => s.screen),
        repository: target?.repository || ready.repository,
        branch: target?.branch || ready.base_branch,
        proposedBranch: currentPlan.proposedBranch || null,
        agent: (accountModel?.agent || ready.coding_agent || null) as api.Agent | null,
        startedAt: Date.now(),
        status: 'queued',
        serverStarted: false,
      };
      setBusy(null);
      if (!('jobId' in response)) {
        // Older single-request backends answer with the result directly.
        const done = response.implementations?.[0] || null;
        await finishJob(base, {
          id: base.jobId, status: done?.pullRequestUrl ? 'completed' : 'failed', result: done,
          error: done?.pullRequestUrl ? null : 'The build finished without a pull request.',
          createdAt: new Date().toISOString(), startedAt: null, finishedAt: null,
        });
        return;
      }
      setRunningJob(base);
      rememberJob(base);
      setResult(null);
      resetTo([{ name: 'home' }, { name: 'project', params: { id: ready.id } }, { name: 'running' }]);
      startJobPolling(base);
    } catch (err) {
      if (err instanceof api.ApiError && (err.status === 402 || err.code === 'MINUTES_EXHAUSTED')) {
        setBusy(null);
        push({ name: 'billing' });
        setError(err.message);
        return;
      }
      fail(describe(err, "The build couldn't start."), err);
    }
  }

  function startJobPolling(job: RunningJob) {
    stopJobPoll();
    let misses = 0;
    let inFlight = false;
    jobPoll.current = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const status = await authed(() => api.getImplementationJob(job.jobId));
        misses = 0;
        if (status.status === 'completed' || status.status === 'failed' || (status.status as string) === 'cancelled') {
          stopJobPoll();
          await finishJob(runningJobRef.current || job, status);
        } else if (runningJobRef.current) {
          const started = status.status === 'running';
          if (started !== runningJobRef.current.serverStarted) {
            setRunningJob({ ...runningJobRef.current, status: status.status as 'queued' | 'running', serverStarted: started });
          }
        }
      } catch (err) {
        misses++;
        if (err instanceof api.ApiError && err.status === 404) {
          stopJobPoll();
          setRunningJob(null);
          rememberJob(null);
        } else if (misses === 8) {
          setNotice("Can't reach the build service right now. The build keeps running and this screen will catch up.");
        }
      } finally {
        inFlight = false;
      }
    }, 3000);
  }

  async function resumeJob(prefs: Prefs, list: api.Project[]): Promise<boolean> {
    const saved = prefs.job;
    if (!saved?.jobId || !list.some((p) => p.id === saved.projectId)) {
      if (saved) rememberJob(null);
      return false;
    }
    try {
      const status = await authed(() => api.getImplementationJob(saved.jobId));
      const job: RunningJob = { ...saved, status: status.status === 'running' ? 'running' : 'queued', serverStarted: status.status === 'running' };
      if (status.status === 'queued' || status.status === 'running') {
        setRunningJob(job);
        setRoutes([{ name: 'home' }, { name: 'project', params: { id: saved.projectId } }, { name: 'running' }]);
        void openProjectData(saved.projectId, list.find((p) => p.id === saved.projectId) || null);
        startJobPolling(job);
        return true;
      }
      setRoutes([{ name: 'home' }, { name: 'project', params: { id: saved.projectId } }, { name: 'result' }]);
      void openProjectData(saved.projectId, list.find((p) => p.id === saved.projectId) || null);
      await finishJob(job, status);
      return true;
    } catch (err) {
      console.warn('[Design Engineer] Could not resume the build', err);
      rememberJob(null);
      return false;
    }
  }

  async function finishJob(job: RunningJob, status: api.ImplementationJob) {
    setRunningJob(null);
    rememberJob(null);
    let billed: number | null = null;
    let buffer = 0;
    // Two independent lookups: the newer per-project list, then the history.
    try {
      const data = await authed(() => api.listProjectBuilds(job.projectId));
      const hit = (data.builds || []).find((b) => b.jobId === job.jobId);
      if (hit && hit.billedSeconds != null) {
        billed = hit.billedSeconds;
        buffer = data.startBufferSeconds || 0;
      }
      setBuildsAvailable(true);
      if (projectRef.current?.id === job.projectId) setBuilds(data.builds || []);
    } catch {
      /* older backend */
    }
    if (billed == null) {
      try {
        const h = await authed(() => api.billingHistory());
        setBillingHistory(h);
        const hit = (h.builds || []).find((b) => b.jobId === job.jobId);
        if (hit) billed = hit.billedSeconds;
      } catch {
        /* history unavailable */
      }
    }
    const r = status.result || null;
    const ok = status.status === 'completed' && !!r?.pullRequestUrl;
    setResult({
      jobId: job.jobId,
      projectId: job.projectId,
      status: ok ? 'completed' : 'failed',
      pullRequestUrl: r?.pullRequestUrl || null,
      branch: r?.branch || job.proposedBranch,
      baseBranch: job.branch,
      repository: job.repository,
      agent: job.agent,
      screens: r?.screens?.length ? r.screens : job.screens,
      error: ok ? null : status.error || (status.status === 'completed' ? 'The build finished without a pull request.' : 'The build stopped.'),
      billedSeconds: billed,
      startBufferSeconds: buffer,
      fidelity: ok && r?.fidelity ? r.fidelity : null,
    });
    void refreshBilling();
    if (current().name === 'running') replace({ name: 'result' });
    else if (current().name !== 'result' && projectRef.current?.id === job.projectId && current().name === 'project') {
      setNotice(ok ? 'Your build finished. The pull request is ready.' : "Your last build didn't finish.");
    }
    if (projectRef.current?.id === job.projectId) void loadBuilds(projectRef.current);
  }

  async function tryAgain() {
    const p = projectRef.current;
    if (!p) return;
    if (planRef.current && screensRef.current.length) {
      resetTo([{ name: 'home' }, { name: 'project', params: { id: p.id } }, { name: 'screens' }, { name: 'plan' }]);
      await startImplementation();
    } else {
      resetTo([{ name: 'home' }, { name: 'project', params: { id: p.id } }]);
    }
  }

  function backToPlan() {
    const p = projectRef.current;
    if (p && planRef.current && screensRef.current.length) {
      resetTo([{ name: 'home' }, { name: 'project', params: { id: p.id } }, { name: 'screens' }, { name: 'plan' }]);
    } else if (p) {
      resetTo([{ name: 'home' }, { name: 'project', params: { id: p.id } }]);
    }
  }

  function backToProject() {
    const p = projectRef.current;
    if (!p) {
      resetTo([{ name: 'home' }]);
      return;
    }
    if (!popTo('project')) resetTo([{ name: 'home' }, { name: 'project', params: { id: p.id } }]);
    void refreshProject(p.id);
  }

  handlers.current = { extracted: handleExtracted, saved: restoreSavedSession };

  // ===========================================================================
  // STATE
  // ===========================================================================

  // The 10 s server-start charge comes with the same backend update (migration 011).
  const startBufferSeconds = buildsAvailable && modelAvailable ? 10 : 0;

  const state = {
    route,
    stack,
    error,
    notice,
    busy,
    sheet,
    user,
    githubConnected,
    githubUser,
    codexConnected,
    codexUser,
    accountModel,
    connections,
    billing,
    billingHistory,
    projects,
    projectStates,
    project,
    links,
    linksAvailable,
    linkStates,
    builds,
    buildsAvailable,
    loadingProject,
    linkFlow,
    repos,
    branches,
    readingContext,
    codexWait,
    selection,
    checkedIds,
    extractingCount,
    screens,
    targetLinkId,
    plan,
    planLoading,
    runningJob,
    result,
    now,
    startBufferSeconds,
  };

  const actions = {
    back,
    push,
    dismissError: () => setError(null),
    setSheet,
    // sign-in
    signInWithGoogle,
    reopenGoogle,
    cancelGoogle,
    logout: () => void logout(false),
    switchGoogleAccount: () => void logout(true),
    retryHome,
    // home + projects
    openProject,
    newProject: () => push({ name: 'new-project' }),
    createProject,
    renameProject,
    deleteProject,
    // billing
    openBilling,
    buyPlan,
    // model
    openModel,
    chooseAgent,
    changeModelSettings,
    agentConnected,
    isConnected,
    connectModel,
    startCodexConnect,
    copyText,
    // github + links
    startLink,
    connectGithub,
    reopenGithub,
    cancelGithub,
    disconnectGithub,
    connectGithubFromAccount,
    loadRepos,
    chooseLinkRepo,
    confirmLinkBranch,
    chooseLinkStack,
    openStackFor,
    makeDefaultLink,
    unlink,
    // build
    startBuild,
    toggleChecked,
    checkAll,
    clearChecked,
    fetchScreens,
    targetLink,
    chooseTarget,
    preparePlan,
    startImplementation,
    tryAgain,
    backToPlan,
    backToProject,
    viewRunning: () => push({ name: 'running' }),
  };

  return { state, actions };
}

export type DesignEngineerState = ReturnType<typeof useDesignEngineer>['state'];
export type DesignEngineerActions = ReturnType<typeof useDesignEngineer>['actions'];

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

export function defaultProvider(agent: api.Agent): api.ModelProvider {
  if (agent === 'codex') return 'openai';
  if (agent === 'claude') return 'anthropic';
  if (agent === 'gemini-api' || agent === 'direct-api') return 'gemini';
  return 'opencode';
}

const SEVERITY: Record<LinkState, number> = { ok: 0, checking: 1, unknown: 1, 'branch-not-found': 3, 'repo-not-found': 3, github: 2 };
export function worst(states: LinkState[]): LinkState {
  return states.reduce<LinkState>((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), 'ok');
}

/** Sync icon for a project row on Home. */
export function projectSync(p: api.Project, known?: LinkState): 'ok' | 'off' | 'warn' | 'unknown' {
  if (!p.repository || !p.base_branch) return 'off';
  if (!known || known === 'checking' || known === 'unknown') return 'unknown';
  return known === 'ok' ? 'ok' : 'warn';
}

export function agentLabel(agent: api.Agent | null | undefined): string {
  switch (agent) {
    case 'codex': return 'Codex CLI';
    case 'claude': return 'Claude Code';
    case 'opencode': return 'OpenCode';
    case 'gemini-api': return 'Gemini API';
    case 'direct-api': return 'Direct API';
    default: return 'AI model';
  }
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', opencode: 'OpenCode', 'ollama-cloud': 'Ollama Cloud',
  deepseek: 'DeepSeek', moonshotai: 'Kimi / Moonshot', gemini: 'Gemini',
};
export function providerLabel(provider: string | null | undefined): string {
  return (provider && PROVIDER_NAMES[provider]) || provider || '';
}

export function agentDetail(m: api.AccountModel | null): string {
  if (!m) return '';
  if (m.agent === 'codex') return 'ChatGPT sign-in';
  if (m.agent === 'claude') return m.model ? `Anthropic API key · ${m.model}` : 'Anthropic API key';
  return [providerLabel(m.provider), m.model].filter(Boolean).join(' · ');
}

export function stackLabel(stack: api.Stack | null | undefined): string {
  return stack === 'react-native' ? 'React Native' : stack === 'react-js' ? 'React JS' : '';
}

export function readableSeconds(total: number | null | undefined): string {
  if (total == null || !isFinite(total)) return '';
  const s = Math.max(0, Math.round(total));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return `${r} s`;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function repoName(repository: string | null | undefined): string {
  return (repository || '').split('/').pop() || '';
}

export function prNumber(url: string | null | undefined): string | null {
  const m = /\/pull\/(\d+)/.exec(url || '');
  return m ? m[1] : null;
}

function copyText(text: string) {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
  } catch {
    /* clipboard not available in this frame */
  }
}

/** Turns a failure into a sentence that says what to do. */
export function describe(err: any, prefix = 'Something went wrong.'): string {
  const message = String(err?.message || '');
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return `${prefix} The Design Engineer server isn't responding. Check your connection and try again.`;
  }
  return message && message !== prefix ? `${prefix} ${message}` : prefix;
}
