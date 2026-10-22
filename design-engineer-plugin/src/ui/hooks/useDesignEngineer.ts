// src/ui/hooks/useDesignEngineer.ts
//
// All plugin behaviour lives here: account (email + Google), projects,
// GitHub and Codex connections, repo/branch/stack setup, screen fetch,
// implementation plan and implementation. Screens only render this state and
// call these actions, so the UI can change without touching the flow.

import { useEffect, useRef, useState } from 'react';

import { onPluginMessage, sendToPlugin } from '../figmaBridge';
import * as api from '../../api/client';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export type Step =
  | 'boot'
  | 'auth'
  | 'signup'
  | 'signin'
  | 'google'
  | 'dashboard'
  | 'create-project'
  | 'github'
  | 'repo'
  | 'branch'
  | 'stack'
  | 'screens'
  | 'done'
  | 'plan'
  | 'implementing'
  | 'implemented';

export interface SelectionItem {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
}

// What the user is waiting on. Drives spinners and disabled buttons.
export type Waiting =
  | null
  | 'restore'
  | 'auth'
  | 'google'
  | 'github'
  | 'codex'
  | 'dashboard'
  | 'project'
  | 'repos'
  | 'branches'
  | 'extracting'
  | 'saving'
  | 'planning'
  | 'implementing'
  | 'logout';

export interface FieldErrors {
  email?: string;
  password?: string;
  confirm?: string;
  name?: string;
}

export interface CodexDevice {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
}

type PendingGoal = 'dashboard' | 'create-project' | 'repo';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function stackLabel(stack: api.Stack | null | undefined) {
  if (stack === 'react-js') return 'React JS';
  if (stack === 'react-native') return 'React Native';
  return '';
}

// -----------------------------------------------------------------------------
// HOOK
// -----------------------------------------------------------------------------

export function useDesignEngineer() {
  const [step, setStepState] = useState<Step>('boot');
  const [waiting, setWaiting] = useState<Waiting>('restore');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // account
  const [session, setSession] = useState<api.AuthSession | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [prefillEmail, setPrefillEmail] = useState('');

  // connections
  const [github, setGithub] = useState<api.GithubStatus>({ connected: false, githubUser: null });
  const [codex, setCodex] = useState<api.CodexStatusInfo>({ connected: false, codexUser: null });
  const [codexDevice, setCodexDevice] = useState<CodexDevice | null>(null);

  // projects
  const [projects, setProjects] = useState<api.Project[]>([]);
  const [currentProject, setCurrentProject] = useState<api.Project | null>(null);

  // repo flow
  const [repos, setRepos] = useState<api.Repo[]>([]);
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [selectedStack, setSelectedStack] = useState<api.Stack | null>(null);

  // screens
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [fetchingItems, setFetchingItems] = useState<SelectionItem[]>([]);
  const [fetchedScreens, setFetchedScreens] = useState<any[]>([]);

  // build
  const [plan, setPlan] = useState<api.ScreenPlan | null>(null);
  const [implementations, setImplementations] = useState<api.ImplementationResult[]>([]);
  const [implementStartedAt, setImplementStartedAt] = useState<number | null>(null);

  // Refs mirror state for the message listener and polling callbacks,
  // which are created once and would otherwise see stale values.
  const sessionRef = useRef<api.AuthSession | null>(null);
  const pendingGoalRef = useRef<PendingGoal>('dashboard');
  const implementAfterCodexRef = useRef(false);
  const currentProjectRef = useRef<api.Project | null>(null);
  const selectedRepoRef = useRef<string | null>(null);
  const selectedBranchRef = useRef<string | null>(null);
  const fetchedScreensRef = useRef<any[]>([]);
  const pollRef = useRef<number | null>(null);
  const codexPollRef = useRef<number | null>(null);
  const googleUrlRef = useRef<string | null>(null);
  const githubUrlRef = useRef<string | null>(null);

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { currentProjectRef.current = currentProject; }, [currentProject]);
  useEffect(() => { selectedRepoRef.current = selectedRepo; }, [selectedRepo]);
  useEffect(() => { selectedBranchRef.current = selectedBranch; }, [selectedBranch]);
  useEffect(() => { fetchedScreensRef.current = fetchedScreens; }, [fetchedScreens]);

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  function go(next: Step) {
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setStepState(next);
  }

  function stopPolling() {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function stopCodexPolling() {
    if (codexPollRef.current !== null) {
      window.clearInterval(codexPollRef.current);
      codexPollRef.current = null;
    }
  }

  function fail(err: unknown, fallback: string) {
    console.error('[Design Engineer]', fallback, err);
    setWaiting(null);
    setError(describeError(err, fallback));
  }

  function applySession(s: api.AuthSession) {
    setSession(s);
    sessionRef.current = s;
    setUserEmail(s.user.email);
    api.setAccessToken(s.accessToken);
    sendToPlugin({
      type: 'save-session',
      session: { accessToken: s.accessToken, refreshToken: s.refreshToken, userEmail: s.user.email },
    });
  }

  function resetProjectState() {
    setCurrentProject(null);
    currentProjectRef.current = null;
    setRepos([]);
    setBranches([]);
    setSelectedRepo(null);
    selectedRepoRef.current = null;
    setSelectedBranch(null);
    selectedBranchRef.current = null;
    setSelectedStack(null);
    resetBuildState();
  }

  function resetBuildState() {
    setCheckedIds(new Set());
    setFetchingItems([]);
    setFetchedScreens([]);
    fetchedScreensRef.current = [];
    setPlan(null);
    setImplementations([]);
    setImplementStartedAt(null);
    implementAfterCodexRef.current = false;
  }

  function clearSessionLocally() {
    stopPolling();
    stopCodexPolling();
    api.setAccessToken(null);
    setSession(null);
    sessionRef.current = null;
    setUserEmail('');
    setProjects([]);
    setGithub({ connected: false, githubUser: null });
    setCodex({ connected: false, codexUser: null });
    setCodexDevice(null);
    resetProjectState();
    sendToPlugin({ type: 'clear-session' });
  }

  async function tryRefresh(): Promise<boolean> {
    const refreshToken = sessionRef.current?.refreshToken;
    if (!refreshToken) return false;
    try {
      applySession(await api.refreshSession(refreshToken));
      return true;
    } catch {
      return false;
    }
  }

  // Runs a backend call; on an expired access token it refreshes once and retries.
  async function authAware<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      const expired = e instanceof api.ApiError && (e.code === 'AUTH_EXPIRED' || e.status === 401);
      if (expired && (await tryRefresh())) return await fn();
      throw e;
    }
  }

  async function loadDashboard(): Promise<api.MeResponse> {
    const me = await authAware(() => api.getMe());
    setUserEmail(me.user.email);
    setProjects(me.projects || []);
    setGithub(me.github || { connected: false, githubUser: null });
    setCodex(me.codex || { connected: false, codexUser: null });
    return me;
  }

  // Applies canvas selection: frames that newly appear are ticked, frames
  // that leave the selection drop out, manual unticks are kept.
  function applySelection(next: SelectionItem[]) {
    setSelection((previous) => {
      const previousIds = new Set(previous.map((s) => s.id));
      setCheckedIds((checked) => {
        const result = new Set<string>();
        for (const item of next) {
          if (checked.has(item.id) || !previousIds.has(item.id)) result.add(item.id);
        }
        return result;
      });
      return next;
    });
  }

  // ===========================================================================
  // BOOT
  // ===========================================================================

  useEffect(() => {
    sendToPlugin({ type: 'get-saved-session' });
    sendToPlugin({ type: 'get-selection' });

    const cleanup = onPluginMessage((msg) => {
      if (msg.type === 'saved-session') restoreSavedSession(msg.session);
      if (msg.type === 'selection-changed') applySelection(msg.selection || []);
      if (msg.type === 'extract-started') setWaiting('extracting');
      if (msg.type === 'extraction-error') {
        setWaiting(null);
        setError(msg.error || 'Figma could not read the selected screens.');
      }
      if (msg.type === 'screens-extracted') handleExtracted(msg.results || []);
    });

    return () => {
      cleanup();
      stopPolling();
      stopCodexPolling();
    };
    // Listener intentionally registered once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restoreSavedSession(saved: any) {
    if (!saved || !saved.accessToken) {
      setWaiting(null);
      go('auth');
      return;
    }

    const restored: api.AuthSession = {
      accessToken: saved.accessToken,
      refreshToken: saved.refreshToken,
      user: saved.user || { id: '', email: saved.userEmail || '' },
    };
    api.setAccessToken(restored.accessToken);
    setSession(restored);
    sessionRef.current = restored;
    setWaiting('restore');

    try {
      await loadDashboard();
      setWaiting(null);
      go('dashboard');
    } catch (e: any) {
      console.error('[Design Engineer] Session restore failed:', e);
      setWaiting(null);
      if (e instanceof api.ApiError) {
        clearSessionLocally();
        go('auth');
        setNotice('Your session ended. Sign in again to continue.');
      } else {
        // Server unreachable: keep the session and let the user retry.
        go('dashboard');
        setError(describeError(e, "Couldn't load your projects."));
      }
    }
  }

  // ===========================================================================
  // ACCOUNT
  // ===========================================================================

  async function signUp(emailInput: string, password: string, confirm: string) {
    const email = emailInput.trim().toLowerCase();
    const errors: FieldErrors = {};
    if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
    if (password.length < 8) errors.password = 'Use at least 8 characters.';
    if (password !== confirm) errors.confirm = "Passwords don't match.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setError(null);
    setWaiting('auth');

    try {
      const result = await api.signup(email, password);

      if (result.confirmationRequired) {
        setWaiting(null);
        setPrefillEmail(email);
        go('signin');
        setNotice(`We sent a link to ${email}. Open it, then sign in here.`);
        return;
      }

      if (result.accessToken && result.refreshToken && result.user) {
        applySession({ accessToken: result.accessToken, refreshToken: result.refreshToken, user: result.user });
        await enterDashboard();
        return;
      }

      throw new Error('Account creation returned an unexpected response.');
    } catch (e) {
      fail(e, "Couldn't create your account.");
    }
  }

  async function signIn(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const errors: FieldErrors = {};
    if (!email) errors.email = 'Enter your email.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setError(null);
    setWaiting('auth');

    try {
      applySession(await api.signin(email, password));
      await enterDashboard();
    } catch (e) {
      fail(e, "Couldn't sign you in.");
    }
  }

  async function enterDashboard() {
    setWaiting('dashboard');
    try {
      await loadDashboard();
      setWaiting(null);
      go('dashboard');
    } catch (e) {
      go('dashboard');
      fail(e, "Couldn't load your projects.");
    }
  }

  async function continueWithGoogle() {
    setError(null);
    setWaiting('google');

    try {
      const { url, state } = await api.googleConnect();
      window.open(url, '_blank');
      googleUrlRef.current = url;
      go('google');
      setWaiting('google');

      stopPolling();
      let polls = 0;
      pollRef.current = window.setInterval(async () => {
        polls += 1;
        try {
          const status = await api.googleStatus(state);

          if (status.status === 'done' && status.session) {
            stopPolling();
            applySession(status.session);
            await enterDashboard();
            return;
          }

          const message =
            status.status === 'error' ? status.error || 'Google sign-in failed.'
            : status.status === 'expired' ? 'Google sign-in expired. Try again.'
            : polls > 300 ? 'Google sign-in timed out. Close the browser tab and try again.'
            : null;

          if (message) {
            stopPolling();
            setWaiting(null);
            go('auth');
            setError(message);
          }
        } catch (pollError) {
          console.error('[Design Engineer] Google polling error:', pollError);
        }
      }, 2000);
    } catch (e) {
      fail(e, "Couldn't start Google sign-in.");
    }
  }

  function reopenGoogle() {
    if (googleUrlRef.current) window.open(googleUrlRef.current, '_blank');
  }

  function cancelGoogle() {
    stopPolling();
    setWaiting(null);
    go('auth');
  }

  // Signs out on this device only, so a different account can sign in.
  function useAnotherAccount() {
    clearSessionLocally();
    setWaiting(null);
    go('auth');
  }

  // Revokes the session on the server as well.
  async function logOut() {
    setWaiting('logout');
    try {
      await authAware(() => api.logout());
    } catch (e) {
      console.warn('[Design Engineer] Backend logout call failed:', e);
    } finally {
      clearSessionLocally();
      setWaiting(null);
      go('auth');
    }
  }

  // ===========================================================================
  // GITHUB
  // ===========================================================================

  async function connectGithub(goal: PendingGoal = 'dashboard') {
    pendingGoalRef.current = goal;
    setError(null);
    setWaiting('github');
    if (goal === 'dashboard') go('github');

    try {
      const { url } = await authAware(() => api.githubConnect());
      githubUrlRef.current = url;
      window.open(url, '_blank');
      setWaiting('github');

      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const status = await authAware(() => api.githubStatus());
          if (!status.connected) return;

          stopPolling();
          setGithub(status);
          setWaiting(null);

          const goalNow = pendingGoalRef.current;
          if (goalNow === 'create-project') {
            go('create-project');
          } else if (goalNow === 'repo') {
            await loadRepos();
          } else {
            await loadDashboard().catch(() => {});
            go('dashboard');
          }
        } catch (pollError) {
          console.error('[Design Engineer] GitHub polling error:', pollError);
        }
      }, 2000);
    } catch (e) {
      fail(e, "Couldn't open GitHub authorization.");
    }
  }

  function reopenGithub() {
    if (githubUrlRef.current) window.open(githubUrlRef.current, '_blank');
  }

  function cancelGithub() {
    stopPolling();
    setWaiting(null);
    const goal = pendingGoalRef.current;
    if (goal === 'create-project') go('create-project');
    else if (goal === 'repo' && currentProjectRef.current) go('github');
    else go('dashboard');
  }

  async function disconnectGithub() {
    setError(null);
    try {
      await authAware(() => api.githubDisconnect());
      setGithub({ connected: false, githubUser: null });
    } catch (e) {
      fail(e, "Couldn't disconnect GitHub.");
    }
  }

  async function switchGithubAccount() {
    setError(null);
    try {
      await authAware(() => api.githubDisconnect());
      setGithub({ connected: false, githubUser: null });
      await connectGithub('dashboard');
    } catch (e) {
      fail(e, "Couldn't switch GitHub account.");
    }
  }

  function handleGithubError(e: any, fallback: string) {
    const expired = e instanceof api.ApiError && (e.code === 'GITHUB_REAUTH_REQUIRED' || e.status === 401);
    if (expired) {
      pendingGoalRef.current = 'repo';
      setWaiting(null);
      setGithub({ connected: false, githubUser: github.githubUser });
      go('github');
      setError('GitHub access expired. Reconnect to load your repositories. Your project and saved screens are kept.');
      return;
    }
    fail(e, fallback);
  }

  // ===========================================================================
  // CODEX
  // ===========================================================================

  async function connectCodex(thenImplement = false) {
    implementAfterCodexRef.current = thenImplement;
    setError(null);
    setWaiting('codex');

    try {
      const device = await authAware(() => api.startCodexDeviceAuth());

      if (device.alreadyAuthenticated) {
        setWaiting(null);
        await loadDashboard().catch(() => {});
        setCodex({ connected: true, codexUser: device.codexUser || null });
        afterCodexConnected();
        return;
      }

      const next: CodexDevice = {
        deviceCode: device.device_code,
        userCode: device.user_code,
        verificationUri: device.verification_uri_complete || device.verification_uri,
      };
      setCodexDevice(next);
      copyText(next.userCode);
      window.open(next.verificationUri, '_blank');

      stopCodexPolling();
      codexPollRef.current = window.setInterval(async () => {
        try {
          const status = await authAware(() => api.getCodexDeviceStatus(device.device_code));

          if (status.status === 'approved') {
            stopCodexPolling();
            setCodexDevice(null);
            setWaiting(null);
            setCodex({ connected: true, codexUser: status.codexUser });
            loadDashboard().catch(() => {});
            afterCodexConnected();
          }

          if (status.status === 'expired') {
            stopCodexPolling();
            setCodexDevice(null);
            setWaiting(null);
            setError('That Codex code expired. Connect Codex again to get a new one.');
          }
        } catch (pollError) {
          console.error('[Design Engineer] Codex polling error:', pollError);
        }
      }, (device.interval || 3) * 1000);
    } catch (e) {
      fail(e, "Couldn't start Codex sign-in.");
    }
  }

  function afterCodexConnected() {
    if (implementAfterCodexRef.current) {
      implementAfterCodexRef.current = false;
      implement(true);
    }
  }

  function openCodexPage() {
    if (!codexDevice) return;
    copyText(codexDevice.userCode);
    window.open(codexDevice.verificationUri, '_blank');
  }

  function copyCodexCode() {
    if (codexDevice) copyText(codexDevice.userCode);
  }

  function cancelCodex() {
    stopCodexPolling();
    setCodexDevice(null);
    implementAfterCodexRef.current = false;
    setWaiting(null);
  }

  async function switchCodexAccount() {
    setError(null);
    try {
      await authAware(() => api.logoutCodex());
      cancelCodex();
      setCodex({ connected: false, codexUser: null });
      await connectCodex(false);
    } catch (e) {
      fail(e, "Couldn't switch Codex account.");
    }
  }

  // ===========================================================================
  // PROJECTS
  // ===========================================================================

  function newProject() {
    resetProjectState();
    go('create-project');
  }

  async function createProject(nameInput: string, description: string) {
    const name = nameInput.trim();
    if (!name) {
      setFieldErrors({ name: 'Give your project a name.' });
      return;
    }

    setFieldErrors({});
    setError(null);
    setWaiting('project');

    try {
      const { project } = await authAware(() => api.createProject(name, description.trim()));
      setProjects((current) => [project, ...current]);
      setCurrentProject(project);
      currentProjectRef.current = project;
      await loadRepos();
    } catch (e) {
      fail(e, "Couldn't create the project.");
    }
  }

  async function deleteProject(id: string) {
    setError(null);
    try {
      await authAware(() => api.deleteProject(id));
      setProjects((current) => current.filter((p) => p.id !== id));
      if (currentProjectRef.current?.id === id) resetProjectState();
    } catch (e) {
      fail(e, "Couldn't delete the project.");
    }
  }

  // Opens a project where it left off: repo, stack or screens.
  async function openProject(project: api.Project, forceSetup = false) {
    resetProjectState();
    setCurrentProject(project);
    currentProjectRef.current = project;
    go(forceSetup || !project.repository || !project.base_branch ? 'repo' : project.stack ? 'screens' : 'stack');
    setWaiting('repos');

    try {
      const data = await authAware(() => api.listRepos());
      setRepos(data.repos || []);
      setWaiting(null);

      const repoExists = project.repository && (data.repos || []).some((r) => r.fullName === project.repository);

      if (!forceSetup && repoExists && project.base_branch) {
        setSelectedRepo(project.repository);
        selectedRepoRef.current = project.repository;
        setSelectedBranch(project.base_branch);
        selectedBranchRef.current = project.base_branch;
        setBranches([{ name: project.base_branch }]);
        if (project.stack) {
          setSelectedStack(project.stack);
          enterScreens();
        } else {
          go('stack');
        }
        return;
      }

      if (forceSetup && project.repository) {
        setSelectedRepo(project.repository);
        selectedRepoRef.current = project.repository;
      }
      go('repo');
    } catch (e) {
      handleGithubError(e, "Couldn't load repositories.");
    }
  }

  function backToProjects() {
    stopPolling();
    resetProjectState();
    go('dashboard');
    loadDashboard().catch(() => {});
  }

  // ===========================================================================
  // REPO / BRANCH / STACK
  // ===========================================================================

  async function loadRepos() {
    setError(null);
    setWaiting('repos');
    go('repo');
    try {
      const data = await authAware(() => api.listRepos());
      setRepos(data.repos || []);
      setWaiting(null);
    } catch (e) {
      handleGithubError(e, "Couldn't load repositories.");
    }
  }

  async function chooseRepo(fullName: string) {
    const parts = fullName.split('/');
    if (parts.length !== 2) {
      setError(`That isn't a valid repository name: ${fullName}`);
      return;
    }
    const [owner, repo] = parts;

    setSelectedRepo(fullName);
    selectedRepoRef.current = fullName;
    setSelectedBranch(null);
    selectedBranchRef.current = null;
    setBranches([]);
    go('branch');
    setWaiting('branches');

    try {
      const data = await authAware(() => api.listBranches(owner, repo));
      setBranches(data.branches || []);
      setWaiting(null);
      saveProject({ repository: fullName });
    } catch (e) {
      handleGithubError(e, "Couldn't load branches.");
    }
  }

  function chooseBranch(name: string) {
    setSelectedBranch(name);
    selectedBranchRef.current = name;
    saveProject({ repository: selectedRepoRef.current || undefined, base_branch: name });
    go('stack');
  }

  function chooseStack(stack: api.Stack) {
    setSelectedStack(stack);
    saveProject({ stack });
    enterScreens();
  }

  function changeRepo() {
    if (repos.length === 0) loadRepos();
    else go('repo');
  }

  function changeBranch() {
    if (selectedRepoRef.current) chooseRepo(selectedRepoRef.current);
    else changeRepo();
  }

  function changeSetup() {
    const project = currentProjectRef.current;
    if (project) openProject({ ...project, repository: selectedRepoRef.current || project.repository }, true);
  }

  // Saves setup choices on the project in the background, and keeps the
  // local copy in sync so Projects shows the latest repo, branch and stack.
  function saveProject(patch: Partial<Pick<api.Project, 'repository' | 'base_branch' | 'stack'>>) {
    const project = currentProjectRef.current;
    if (!project) return;
    const updated = { ...project, ...patch } as api.Project;
    currentProjectRef.current = updated;
    setCurrentProject(updated);
    setProjects((list) => list.map((p) => (p.id === updated.id ? updated : p)));
    authAware(() => api.updateProject(project.id, patch)).catch((e) =>
      console.warn('[Design Engineer] Project update failed:', e)
    );
  }

  // ===========================================================================
  // SCREENS
  // ===========================================================================

  // Entering Screens: tick everything currently selected on the canvas.
  function enterScreens() {
    setSelection((current) => {
      setCheckedIds(new Set(current.map((s) => s.id)));
      return current;
    });
    go('screens');
    sendToPlugin({ type: 'get-selection' });
  }

  function toggleChecked(id: string) {
    setCheckedIds((previous) => {
      const next = new Set(previous);
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

  function fetchScreens() {
    if (!currentProjectRef.current || !selectedRepoRef.current || !selectedBranchRef.current) {
      setError('Choose a repository and branch first.');
      return;
    }
    if (checkedIds.size === 0) {
      setError('Select at least one screen.');
      return;
    }

    setError(null);
    setFetchingItems(selection.filter((s) => checkedIds.has(s.id)));
    setWaiting('extracting');
    sendToPlugin({ type: 'extract-screens', nodeIds: Array.from(checkedIds) });
  }

  async function handleExtracted(results: any[]) {
    const project = currentProjectRef.current;
    const repo = selectedRepoRef.current;
    const branch = selectedBranchRef.current;

    if (!project || !repo || !branch) {
      setWaiting(null);
      setError('Choose a repository and branch first.');
      return;
    }
    if (!results || results.length === 0) {
      setWaiting(null);
      setError('Figma returned no Design Context for these screens.');
      return;
    }

    setWaiting('saving');

    try {
      await authAware(() => api.submitScreens(project.id, repo, branch, results));
      setFetchedScreens(results);
      fetchedScreensRef.current = results;
      setPlan(null);
      setImplementations([]);
      setCheckedIds(new Set());
      setWaiting(null);
      go('done');
    } catch (e) {
      fail(e, "Couldn't save the Design Context.");
    }
  }

  function addMoreScreens() {
    go('screens');
    sendToPlugin({ type: 'get-selection' });
  }

  // ===========================================================================
  // PLAN AND IMPLEMENT
  // ===========================================================================

  async function makePlan() {
    const project = currentProjectRef.current;
    const screens = fetchedScreensRef.current;
    if (!project || screens.length === 0) {
      setError('Fetch at least one screen first.');
      return;
    }

    go('plan');
    setWaiting('planning');

    try {
      const result = await authAware(() => api.planScreens(project.id, screens));
      setPlan(result);
      setWaiting(null);
    } catch (e) {
      fail(e, "Couldn't make the implementation plan.");
    }
  }

  async function implement(codexReady = codex.connected) {
    const project = currentProjectRef.current;
    const screens = fetchedScreensRef.current;
    if (!project || screens.length === 0) {
      setError('Fetch at least one screen first.');
      return;
    }

    if (!codexReady) {
      connectCodex(true);
      return;
    }

    go('implementing');
    setImplementStartedAt(Date.now());
    setWaiting('implementing');

    try {
      const result = await authAware(() => api.implementScreens(project.id, screens));
      setImplementations(result.implementations || []);
      setWaiting(null);
      go('implemented');
    } catch (e) {
      fail(e, 'Codex stopped with:');
    }
  }

  function backToPlan() {
    go('plan');
  }

  function buildMore() {
    resetBuildState();
    enterScreens();
  }

  // ===========================================================================
  // RETRY
  // ===========================================================================

  function retry() {
    setError(null);
    if (step === 'dashboard') enterDashboard();
    else if (step === 'repo') loadRepos();
    else if (step === 'branch') changeBranch();
    else if (step === 'plan') makePlan();
    else if (step === 'implementing') implement();
  }

  function dismissError() {
    setError(null);
  }

  // ===========================================================================
  // EXPORT
  // ===========================================================================

  const state = {
    step,
    waiting,
    error,
    notice,
    fieldErrors,
    userEmail: userEmail || session?.user.email || '',
    prefillEmail,
    github,
    codex,
    codexDevice,
    projects,
    currentProject,
    repos,
    branches,
    selectedRepo,
    selectedBranch,
    selectedStack,
    selection,
    checkedIds,
    fetchingItems,
    fetchedScreens,
    plan,
    implementations,
    implementStartedAt,
  };

  const actions = {
    go,
    signUp,
    signIn,
    continueWithGoogle,
    reopenGoogle,
    cancelGoogle,
    useAnotherAccount,
    logOut,
    connectGithub,
    reopenGithub,
    cancelGithub,
    disconnectGithub,
    switchGithubAccount,
    connectCodex: () => connectCodex(false),
    openCodexPage,
    copyCodexCode,
    cancelCodex,
    switchCodexAccount,
    newProject,
    createProject,
    deleteProject,
    openProject: (project: api.Project) => openProject(project),
    changeSetupFor: (project: api.Project) => openProject(project, true),
    backToProjects,
    loadRepos,
    chooseRepo,
    chooseBranch,
    chooseStack,
    changeRepo,
    changeBranch,
    changeSetup,
    toggleChecked,
    checkAll,
    clearChecked,
    fetchScreens,
    addMoreScreens,
    makePlan,
    implement: () => implement(),
    backToPlan,
    buildMore,
    retry,
    dismissError,
  };

  return { state, actions };
}

export type DesignEngineerState = ReturnType<typeof useDesignEngineer>['state'];
export type DesignEngineerActions = ReturnType<typeof useDesignEngineer>['actions'];

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

// Turns failures into a message that says what went wrong and what to do.
export function describeError(err: any, fallback: string): string {
  const message = String(err?.message || '');
  if (!(err instanceof api.ApiError) && /failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    const host = api.getBaseUrl().replace(/^https?:\/\//, '');
    return `${fallback} The server at ${host} isn't responding. It may be waking up, which can take up to a minute. Try again.`;
  }
  return message ? `${fallback} ${message}` : fallback;
}

// navigator.clipboard is often blocked inside the Figma plugin iframe,
// so this uses a hidden textarea and execCommand.
export function copyText(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
