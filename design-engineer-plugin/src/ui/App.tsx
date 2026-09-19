// src/ui/App.tsx
//
// Design Engineer plugin UI — new account flow.
//
//  boot   -> restore Supabase session from Figma client storage
//  auth   -> "Already have an account?" / "Create an account"
//  signup -> email + password (validated) -> stored in Supabase auth
//  signin -> email + password
//  dashboard -> projects, GitHub connection, Codex connection, switch account
//  create-project -> name + description (GitHub connect first if needed)
//  github -> GitHub OAuth (backend automates it, tokens stored in DB)
//  codex  -> device-code login (credentials stored in DB per user)
//  repo/branch/screens/done -> existing fetch + implement flow per project

import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import Chat, {
  ChatMessage,
} from './Chat';

import ContextChip from './ContextChip';

import ProgressCard from './ProgressCard';

import {
  onPluginMessage,
  sendToPlugin,
} from './figmaBridge';

import * as api from '../api/client';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

type Step =
  | 'boot'
  | 'auth'
  | 'signup'
  | 'signin'
  | 'dashboard'
  | 'create-project'
  | 'github'
  | 'repo'
  | 'branch'
  | 'screens'
  | 'done';

interface SelectionItem {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
}

type PendingGoal = 'dashboard' | 'create-project' | 'repo';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// -----------------------------------------------------------------------------
// APP
// -----------------------------------------------------------------------------

export default function App() {
  // ===========================================================================
  // STATE
  // ===========================================================================

  const [step, setStep] = useState<Step>('boot');

  const [session, setSession] = useState<api.AuthSession | null>(null);
  const [userEmail, setUserEmail] = useState('');

  const [projects, setProjects] = useState<api.Project[]>([]);
  const [currentProject, setCurrentProject] = useState<api.Project | null>(null);

  const [github, setGithub] = useState<api.GithubStatus>({
    connected: false,
    githubUser: null,
  });

  const [githubApp, setGithubApp] = useState<api.GithubOAuthAppInfo>({
    configured: false,
    clientId: null,
    appName: null,
    source: 'env',
  });
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');

  const [codex, setCodex] = useState<api.CodexStatusInfo>({
    connected: false,
    codexUser: null,
  });

  const [codexDevice, setCodexDevice] = useState<{
    device_code: string;
    user_code: string;
    verification_uri_complete: string;
    verification_uri: string;
    interval: number;
  } | null>(null);

  // forms
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const [signinEmail, setSigninEmail] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');

  // repo flow
  const [repos, setRepos] = useState<api.Repo[]>([]);
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  // screens
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [fetchedScreens, setFetchedScreens] = useState<any[]>([]);

  // busy / error / chat
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'system', text: 'Welcome to Design Engineer.' },
  ]);

  // ===========================================================================
  // REFS
  // ===========================================================================

  const sessionRef = useRef<api.AuthSession | null>(null);
  const stepRef = useRef<Step>('boot');
  const pendingGoalRef = useRef<PendingGoal>('dashboard');
  const currentProjectRef = useRef<api.Project | null>(null);
  const selectedRepoRef = useRef<string | null>(null);
  const selectedBranchRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { currentProjectRef.current = currentProject; }, [currentProject]);
  useEffect(() => { selectedRepoRef.current = selectedRepo; }, [selectedRepo]);
  useEffect(() => { selectedBranchRef.current = selectedBranch; }, [selectedBranch]);

  // ===========================================================================
  // CHAT
  // ===========================================================================

  function log(role: ChatMessage['role'], text: string) {
    setMessages((current) => [...current, { role, text }]);
  }

  function clearPoll() {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // ===========================================================================
  // SESSION HELPERS
  // ===========================================================================

  function applySession(s: api.AuthSession, saveToFigma = true) {
    setSession(s);
    sessionRef.current = s;
    api.setAccessToken(s.accessToken);
    if (saveToFigma) {
      sendToPlugin({
        type: 'save-session',
        session: {
          accessToken: s.accessToken,
          refreshToken: s.refreshToken,
          userEmail: s.user.email,
        },
      });
    }
  }

  function clearSessionLocally() {
    api.setAccessToken(null);
    setSession(null);
    sessionRef.current = null;
    setUserEmail('');
    setProjects([]);
    setCurrentProject(null);
    currentProjectRef.current = null;
    setGithub({ connected: false, githubUser: null });
    setGithubApp({ configured: false, clientId: null, appName: null, source: 'env' });
    setOauthClientId('');
    setOauthClientSecret('');
    setCodex({ connected: false, codexUser: null });
    setCodexDevice(null);
    sendToPlugin({ type: 'clear-session' });
  }

  async function tryRefresh(): Promise<boolean> {
    const refreshToken = sessionRef.current?.refreshToken;
    if (!refreshToken) return false;
    try {
      const refreshed = await api.refreshSession(refreshToken);
      applySession(refreshed);
      return true;
    } catch {
      return false;
    }
  }

  // Runs a backend call; on an expired access token it refreshes once and
  // retries.
  async function authAware<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      const expired =
        e instanceof api.ApiError &&
        (e.code === 'AUTH_EXPIRED' || e.status === 401);
      if (expired && (await tryRefresh())) {
        return await fn();
      }
      throw e;
    }
  }

  async function loadDashboard(): Promise<api.MeResponse> {
    const me = await api.getMe();
    setUserEmail(me.user.email);
    setProjects(me.projects || []);
    setGithub(me.github || { connected: false, githubUser: null });
    setCodex(me.codex || { connected: false, codexUser: null });
    setGithubApp(
      me.githubApp || { configured: false, clientId: null, appName: null, source: 'env' }
    );
    return me;
  }

  // ===========================================================================
  // BOOT
  // ===========================================================================

  useEffect(() => {
    sendToPlugin({ type: 'get-saved-session' });
    sendToPlugin({ type: 'get-selection' });

    const cleanup = onPluginMessage((msg) => {
      if (msg.type === 'saved-session') {
        restoreSavedSession(msg.session);
      }

      if (msg.type === 'session-saved') {
        console.log('[Design Engineer] Session saved.');
      }

      if (msg.type === 'selection-changed') {
        setSelection(msg.selection || []);
      }

      if (msg.type === 'extract-started') {
        setBusy(true);
        setBusyLabel(
          `Starting extraction of ${msg.total} screen${msg.total === 1 ? '' : 's'}...`
        );
      }

      if (msg.type === 'extraction-error') {
        setBusy(false);
        setBusyLabel('');
        const message = msg.error || 'Extraction failed.';
        setError(message);
        log('assistant', `❌ ${message}`);
      }

      if (msg.type === 'screens-extracted') {
        handleExtracted(msg.results || []);
      }
    });

    return () => {
      cleanup();
      clearPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restoreSavedSession(saved: api.AuthSession | null) {
    if (!saved || !saved.accessToken) {
      setStep('auth');
      setMessages([
        {
          role: 'system',
          text: 'Welcome to Design Engineer.\n\nCreate an account or sign in to get started. Your account, projects, GitHub and Codex connections are stored in your Supabase database.',
        },
      ]);
      return;
    }

    api.setAccessToken(saved.accessToken);
    setSession(saved);
    sessionRef.current = saved;

    setBusy(true);
    setBusyLabel('Restoring your account...');

    try {
      const me = await authAware(() => api.getMe());
      setUserEmail(me.user.email);
      setProjects(me.projects || []);
      setGithub(me.github || { connected: false, githubUser: null });
      setCodex(me.codex || { connected: false, codexUser: null });
      setGithubApp(
        me.githubApp || { configured: false, clientId: null, appName: null, source: 'env' }
      );
      setBusy(false);
      setBusyLabel('');
      setStep('dashboard');

      log(
        'assistant',
        `Welcome back${me.github.githubUser ? `, @${me.github.githubUser}` : ''}! You're signed in as ${me.user.email}.`
      );
    } catch (e: any) {
      console.error('[Design Engineer] Session restore failed:', e);
      setBusy(false);
      setBusyLabel('');
      clearSessionLocally();
      setStep('auth');
      setMessages([
        {
          role: 'system',
          text: 'Your previous session has expired. Please sign in again.',
        },
      ]);
    }
  }

  // ===========================================================================
  // SIGN UP
  // ===========================================================================

  async function handleSignup() {
    const email = signupEmail.trim().toLowerCase();
    const password = signupPassword;
    const confirm = signupConfirm;

    if (!EMAIL_RE.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setError(null);
    setBusy(true);
    setBusyLabel('Creating your account...');

    try {
      const result = await api.signup(email, password);

      if (result.confirmationRequired) {
        setBusy(false);
        setBusyLabel('');
        setSigninEmail(email);
        setSigninPassword('');
        setStep('signin');
        setError('Check your inbox to confirm your email, then sign in.');
        return;
      }

      if (result.accessToken && result.refreshToken && result.user) {
        applySession({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user,
        });

        log('user', `Create account: ${email}`);
        log('assistant', `Account created ✓. Welcome, ${email}!`);

        setBusy(false);
        setBusyLabel('');
        await goDashboardAfterAuth();
      } else {
        throw new Error('Account creation returned an unexpected response.');
      }
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      setError(e?.message || 'Could not create your account.');
    }
  }

  // ===========================================================================
  // SIGN IN
  // ===========================================================================

  async function handleSignin() {
    const email = signinEmail.trim().toLowerCase();
    const password = signinPassword;

    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }

    setError(null);
    setBusy(true);
    setBusyLabel('Signing in...');

    try {
      const result = await api.signin(email, password);
      applySession(result);

      log('user', `Sign in: ${email}`);

      setBusy(false);
      setBusyLabel('');
      await goDashboardAfterAuth();
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      setError(e?.message || 'Sign in failed.');
    }
  }

  async function goDashboardAfterAuth() {
    try {
      const me = await loadDashboard();
      setStep('dashboard');
      log(
        'assistant',
        `You're signed in as ${me.user.email}.\n\n` +
          (me.github.connected
            ? `GitHub is connected as @${me.github.githubUser}.`
            : 'Connect GitHub when you create a project.') +
          (me.codex.connected
            ? ' Codex is ready for implementation.'
            : ' Connect Codex when you are ready to implement screens.')
      );
    } catch (e: any) {
      console.error('[Design Engineer] Dashboard load failed:', e);
      setStep('dashboard');
    }
  }

  // ===========================================================================
  // SIGN OUT (switch app account)
  // ===========================================================================

  function handleSignOut() {
    clearPoll();
    clearSessionLocally();
    setCheckedIds(new Set());
    setFetchedScreens([]);
    setSelectedRepo(null);
    selectedRepoRef.current = null;
    setSelectedBranch(null);
    selectedBranchRef.current = null;
    setRepos([]);
    setBranches([]);
    setError(null);
    setStep('auth');
    log('assistant', 'Signed out. See you soon!');
  }

  // ===========================================================================
  // GITHUB
  // ===========================================================================

  async function handleConnectGithub(goal: PendingGoal = 'dashboard') {
    pendingGoalRef.current = goal;

    setError(null);
    setBusy(true);
    setBusyLabel('Opening GitHub authorization...');

    try {
      const { url } = await authAware(() => api.githubConnect());
      window.open(url, '_blank');

      log('user', 'Connect GitHub');
      log('assistant', 'GitHub authorization opened in your browser. Waiting for authorization...');

      clearPoll();

      pollRef.current = window.setInterval(async () => {
        try {
          const status = await authAware(() => api.githubStatus());

          if (status.connected) {
            clearPoll();
            setGithub(status);
            setBusy(false);
            setBusyLabel('');
            log('assistant', `Connected as @${status.githubUser}.`);

            const goalNow = pendingGoalRef.current;

            if (goalNow === 'create-project') {
              setStep('create-project');
            } else if (goalNow === 'repo') {
              setStep('dashboard');
              await loadDashboard();
              setStep('repo');
              try {
                await api.listRepos();
              } catch {
                // fall through
              }
              await loadRepos();
            } else {
              await loadDashboard();
              setStep('dashboard');
            }
          }
        } catch (pollError) {
          console.error('[Design Engineer] GitHub polling error:', pollError);
        }
      }, 2000);
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      setError(e?.message || 'Could not open GitHub authorization.');
    }
  }

  async function handleDisconnectGithub() {
    setError(null);
    setBusy(true);
    setBusyLabel('Disconnecting GitHub...');
    try {
      await authAware(() => api.githubDisconnect());
      setGithub({ connected: false, githubUser: null });
      log('assistant', 'GitHub disconnected. You can connect a different account anytime.');
      setBusy(false);
      setBusyLabel('');
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      setError(e?.message || 'Could not disconnect GitHub.');
    }
  }

  async function handleSaveGithubApp() {
    const clientId = oauthClientId.trim();
    const clientSecret = oauthClientSecret.trim();

    if (!clientId || !clientSecret) {
      setError('Enter both the Client ID and Client Secret of your GitHub OAuth App.');
      return;
    }

    setError(null);
    setBusy(true);
    setBusyLabel('Saving your GitHub OAuth App...');

    try {
      await authAware(() => api.saveGithubOAuthApp(clientId, clientSecret));
      setGithubApp({
        configured: true,
        clientId,
        appName: 'My GitHub OAuth App',
        source: 'db',
      });
      setOauthClientId('');
      setOauthClientSecret('');
      log(
        'assistant',
        'Your own GitHub OAuth App is saved in your database. It will be used for your GitHub login from now on.'
      );
      setBusy(false);
      setBusyLabel('');
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      setError(e?.message || 'Could not save your GitHub OAuth App.');
    }
  }

  async function handleClearGithubApp() {
    setError(null);
    setBusy(true);
    setBusyLabel('Removing your GitHub OAuth App...');
    try {
      await authAware(() => api.clearGithubOAuthApp());
      setGithubApp({
        configured: false,
        clientId: null,
        appName: null,
        source: 'env',
      });
      setOauthClientId('');
      setOauthClientSecret('');
      log('assistant', 'Your GitHub OAuth App was removed. The backend will use the built-in app.');
      setBusy(false);
      setBusyLabel('');
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      setError(e?.message || 'Could not remove your GitHub OAuth App.');
    }
  }

  // ===========================================================================
  // CODEX
  // ===========================================================================

  async function handleConnectCodex() {
    setError(null);
    setBusy(true);
    setBusyLabel('Starting Codex login...');

    try {
      const device = await authAware(() => api.startCodexDeviceAuth());

      if (device.alreadyAuthenticated) {
        setBusy(false);
        setBusyLabel('');
        log('assistant', 'Codex is already authenticated — no device code required.');
        await loadDashboard();
        return;
      }

      setCodexDevice({
        device_code: device.device_code,
        user_code: device.user_code,
        verification_uri_complete: device.verification_uri_complete || device.verification_uri,
        verification_uri: device.verification_uri,
        interval: device.interval || 3,
      });

      log(
        'assistant',
        `Enter the device code ${device.user_code} at ${device.verification_uri}.\n\nOpening the login page now...`
      );

      window.open(
        device.verification_uri_complete || device.verification_uri,
        '_blank'
      );

      setBusy(false);
      setBusyLabel('');

      clearPoll();

      pollRef.current = window.setInterval(async () => {
        try {
          const status = await authAware(() =>
            api.getCodexDeviceStatus(device.device_code)
          );

          if (status.status === 'approved') {
            clearPoll();
            setCodexDevice(null);
            log(
              'assistant',
              `Codex authenticated${status.codexUser ? ` as ${status.codexUser}` : ''}. Your connection is saved in your database.`
            );
            await loadDashboard();
          }

          if (status.status === 'expired') {
            clearPoll();
            setCodexDevice(null);
            setError('Codex login expired. Please try again.');
          }
        } catch (pollError) {
          console.error('[Design Engineer] Codex polling error:', pollError);
        }
      }, (device.interval || 3) * 1000);
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      setError(e?.message || 'Could not start Codex login.');
    }
  }

  async function handleSwitchCodexAccount() {
    setError(null);
    setBusy(true);
    setBusyLabel('Signing out of Codex...');
    try {
      await authAware(() => api.logoutCodex());
      setCodexDevice(null);
      clearPoll();
      log('assistant', 'Codex signed out. Connect a different account when you are ready.');
      await loadDashboard();
      setBusy(false);
      setBusyLabel('');
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      setError(e?.message || 'Could not switch Codex account.');
    }
  }

  // ===========================================================================
  // PROJECTS
  // ===========================================================================

  async function handleCreateProject() {
    const name = projectName.trim();
    if (!name) {
      setError('Give your project a name.');
      return;
    }

    setError(null);
    setBusy(true);
    setBusyLabel('Creating project...');

    try {
      const { project } = await authAware(() =>
        api.createProject(name, projectDescription.trim())
      );

      setProjectName('');
      setProjectDescription('');

      log('user', `Create project: ${name}`);
      log('assistant', `Project "${name}" created. Now connect it to a GitHub repository.`);

      setProjects((current) => [project, ...current]);

      setBusy(false);
      setBusyLabel('');

      // Straight into the repo picker for this project.
      setCurrentProject(project);
      currentProjectRef.current = project;
      await loadRepos();
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      setError(e?.message || 'Could not create the project.');
    }
  }

  async function handleDeleteProject(id: string) {
    if (!window.confirm('Delete this project? Its saved screens will be removed.')) {
      return;
    }
    setError(null);
    try {
      await authAware(() => api.deleteProject(id));
      setProjects((current) => current.filter((p) => p.id !== id));
      if (currentProjectRef.current?.id === id) {
        setCurrentProject(null);
        currentProjectRef.current = null;
      }
      log('assistant', 'Project deleted.');
    } catch (e: any) {
      setError(e?.message || 'Could not delete the project.');
    }
  }

  async function openProject(project: api.Project) {
    setCurrentProject(project);
    currentProjectRef.current = project;
    setFetchedScreens([]);
    setCheckedIds(new Set());
    setError(null);

    log('assistant', `Opening project "${project.name}".`);

    setBusy(true);
    setBusyLabel('Loading repositories...');

    try {
      const data = await authAware(() => api.listRepos());
      setRepos(data.repos || []);
      setBusy(false);
      setBusyLabel('');

      // If the project already has a repository + branch, go straight to screens.
      if (project.repository) {
        const existingRepo = data.repos.find((r) => r.fullName === project.repository);
        if (existingRepo) {
          setSelectedRepo(project.repository);
          selectedRepoRef.current = project.repository;

          if (project.base_branch) {
            setSelectedBranch(project.base_branch);
            selectedBranchRef.current = project.base_branch;
            setBranches([{ name: project.base_branch }]);
            setStep('screens');
            log(
              'assistant',
              `Using ${project.repository} @ ${project.base_branch}. Select screens on the canvas, then click Fetch.`
            );
            return;
          }
        }
      }

      setStep('repo');
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      handleGithubError(e);
    }
  }

  function handleGithubError(e: any) {
    const expired =
      e instanceof api.ApiError &&
      (e.code === 'GITHUB_REAUTH_REQUIRED' || e.status === 401);

    if (expired) {
      pendingGoalRef.current = 'repo';
      setStep('github');
      setError('Your GitHub authorization expired. Reconnect GitHub to continue.');
      log('assistant', 'GitHub authorization expired. Click Connect GitHub to reconnect.');
      return;
    }
    setError(e?.message || 'Request failed.');
  }

  // ===========================================================================
  // REPO / BRANCH / SCREENS
  // ===========================================================================

  async function loadRepos() {
    setBusy(true);
    setBusyLabel('Loading repositories...');
    try {
      const data = await authAware(() => api.listRepos());
      setRepos(data.repos || []);
      setBusy(false);
      setBusyLabel('');
      setStep('repo');
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      handleGithubError(e);
    }
  }

  async function handleSelectRepo(fullName: string) {
    const parts = fullName.split('/');
    if (parts.length !== 2) {
      setError(`Invalid repository name: ${fullName}`);
      return;
    }

    const [owner, repo] = parts;

    setSelectedRepo(fullName);
    selectedRepoRef.current = fullName;
    log('user', `Repo: ${fullName}`);

    setBusy(true);
    setBusyLabel('Loading branches...');

    try {
      const data = await authAware(() => api.listBranches(owner, repo));
      setBranches(data.branches || []);
      setBusy(false);
      setBusyLabel('');
      setStep('branch');
      log('assistant', 'Pick a branch to work from.');

      // Remember the repo on the project.
      const project = currentProjectRef.current;
      if (project) {
        authAware(() =>
          api.updateProject(project.id, { repository: fullName })
        ).catch(() => {});
      }
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      handleGithubError(e);
    }
  }

  function handleSelectBranch(name: string) {
    setSelectedBranch(name);
    selectedBranchRef.current = name;
    log('user', `Branch: ${name}`);

    const project = currentProjectRef.current;
    if (project) {
      authAware(() =>
        api.updateProject(project.id, {
          repository: selectedRepoRef.current || undefined,
          base_branch: name,
        })
      ).catch(() => {});
    }

    log(
      'assistant',
      'Select one or more screens on the Figma canvas, then click Fetch.'
    );
    setStep('screens');
  }

  function toggleChecked(id: string) {
    setCheckedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllScreens() {
    setCheckedIds(new Set(selection.map((screen) => screen.id)));
  }

  function clearScreenSelection() {
    setCheckedIds(new Set());
  }

  // ===========================================================================
  // FETCH
  // ===========================================================================

  function handleFetch() {
    const project = currentProjectRef.current;
    const repo = selectedRepoRef.current;
    const branch = selectedBranchRef.current;

    if (!project || !repo || !branch) {
      setError('Missing project, repository, or branch.');
      return;
    }

    if (checkedIds.size === 0) {
      setError('Please select at least one screen.');
      return;
    }

    setError(null);
    log('user', `Fetch ${checkedIds.size} screen${checkedIds.size > 1 ? 's' : ''}`);
    log('assistant', `I'll analyze ${checkedIds.size} selected screen${checkedIds.size > 1 ? 's' : ''} and create the Design Context.`);

    setBusy(true);
    setBusyLabel(`Extracting ${checkedIds.size} screen${checkedIds.size > 1 ? 's' : ''}...`);

    sendToPlugin({
      type: 'extract-screens',
      nodeIds: Array.from(checkedIds),
    });
  }

  async function handleExtracted(results: any[]) {
    const project = currentProjectRef.current;
    const repo = selectedRepoRef.current;
    const branch = selectedBranchRef.current;

    if (!project || !repo || !branch) {
      setBusy(false);
      setError('Missing project, repository, or branch.');
      return;
    }

    if (!results || results.length === 0) {
      setBusy(false);
      setBusyLabel('');
      setError('No Design Context was returned by Figma.');
      return;
    }

    setBusy(true);
    setBusyLabel(`Saving ${results.length} Design Context file${results.length > 1 ? 's' : ''}...`);

    try {
      const result = await authAware(() =>
        api.submitScreens(project.id, repo, branch, results)
      );

      const saved = result.saved || [];

      let message =
        `✅ Extracted ${results.length} screen${results.length > 1 ? 's' : ''}.\n\nDesign Context saved to your database:\n\n`;

      if (saved.length > 0) {
        message += saved.map((file) => `✓ ${file}`).join('\n');
      }

      log('assistant', message);

      setFetchedScreens(results);
      setCheckedIds(new Set());
      setBusy(false);
      setBusyLabel(`✓ ${results.length} screen${results.length > 1 ? 's' : ''} saved`);
      setStep('done');
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      setError(e?.message || 'Failed to save Design Context.');
    }
  }

  // ===========================================================================
  // IMPLEMENT
  // ===========================================================================

  async function handleImplement() {
    const project = currentProjectRef.current;

    if (!project || fetchedScreens.length === 0) {
      setError('Fetch at least one screen before starting implementation.');
      return;
    }

    if (!codex.connected) {
      setError('Connect Codex first so screens can be implemented.');
      return;
    }

    setError(null);
    setBusy(true);
    setBusyLabel(
      `Codex is implementing ${fetchedScreens.length} screen${fetchedScreens.length > 1 ? 's' : ''}... (this can take a while)`
    );

    try {
      const result = await authAware(() =>
        api.implementScreens(project.id, fetchedScreens)
      );

      log(
        'assistant',
        result.implementations
          .map(
            (implementation) =>
              `Implemented ${implementation.screens.join(', ')}\nBranch: ${implementation.branch}\nPull request: ${implementation.pullRequestUrl}`
          )
          .join('\n\n')
      );

      setBusy(false);
      setBusyLabel('Implementation complete. Pull request ready for testing.');
    } catch (e: any) {
      setBusy(false);
      setBusyLabel('');
      setError(e?.message || 'Failed to implement screens.');
    }
  }

  // ===========================================================================
  // RENDER
  // ===========================================================================

  function renderAuth() {
    return (
      <div className="auth-view">
        <div className="logo-mark">DE</div>
        <h2>Design Engineer</h2>
        <p className="muted">
          Create an account or sign in. Your projects, GitHub and Codex
          connections are stored securely in your database.
        </p>
        <button className="primary" onClick={() => { setError(null); setStep('signup'); }}>
          Create an account
        </button>
        <button onClick={() => { setError(null); setStep('signin'); }}>
          I already have an account
        </button>
      </div>
    );
  }

  function renderSignup() {
    return (
      <div className="auth-view">
        <h2>Create your account</h2>
        <label>
          Email
          <input
            type="email"
            value={signupEmail}
            placeholder="you@example.com"
            onChange={(e) => setSignupEmail(e.target.value)}
          />
        </label>
        <label>
          Password <span className="hint">(min 8 characters)</span>
          <input
            type="password"
            value={signupPassword}
            placeholder="••••••••"
            onChange={(e) => setSignupPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={signupConfirm}
            placeholder="••••••••"
            onChange={(e) => setSignupConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSignup(); }}
          />
        </label>
        <div className="row">
          <button className="primary" disabled={busy} onClick={handleSignup}>
            {busy ? 'Creating...' : 'Create account'}
          </button>
          <button disabled={busy} onClick={() => { setError(null); setStep('auth'); }}>
            Back
          </button>
        </div>
      </div>
    );
  }

  function renderSignin() {
    return (
      <div className="auth-view">
        <h2>Sign in</h2>
        <label>
          Email
          <input
            type="email"
            value={signinEmail}
            placeholder="you@example.com"
            onChange={(e) => setSigninEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={signinPassword}
            placeholder="••••••••"
            onChange={(e) => setSigninPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSignin(); }}
          />
        </label>
        <div className="row">
          <button className="primary" disabled={busy} onClick={handleSignin}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
          <button disabled={busy} onClick={() => { setError(null); setStep('auth'); }}>
            Back
          </button>
        </div>
      </div>
    );
  }

  function renderDashboard() {
    return (
      <div className="dashboard">
        <div className="card">
          <div className="card-title">Account</div>
          <div className="card-desc">{userEmail || session?.user.email}</div>
          <div className="card-actions">
            <button onClick={handleSignOut}>Log out</button>
          </div>
        </div>

        {/* GitHub */}
        <div className="card">
          <div className="card-title">GitHub</div>
          {github.connected ? (
            <>
              <div className="card-desc">
                Connected as <strong>@{github.githubUser}</strong>.
              </div>
              <div className="card-actions">
                <button onClick={handleDisconnectGithub}>Log out GitHub</button>
              </div>
            </>
          ) : (
            <>
              <div className="card-desc">Not connected.</div>
              <div className="card-actions">
                <button className="primary" onClick={() => handleConnectGithub('dashboard')}>
                  Connect GitHub
                </button>
              </div>
            </>
          )}
        </div>

        {/* GitHub OAuth app */}
        <div className="card">
          <div className="card-title">GitHub OAuth App</div>
          <div className="card-desc">
            {githubApp.source === 'db'
              ? `Using your own app (${githubApp.clientId}).`
              : 'Using the built-in app. The built-in app only powers the login flow — any GitHub account can connect to it.'}
          </div>
          <div className="card-desc muted">
            Optional: save your own GitHub OAuth App to use for your GitHub
            login (stored encrypted in your database, not in the backend .env).
            Register it at github.com/settings/developers with callback URL{' '}
            <code>http://localhost:4000/auth/github/callback</code>.
          </div>
          <label>
            Client ID
            <input
              type="text"
              value={oauthClientId}
              placeholder="Iv1.xxxxxxxx"
              onChange={(e) => setOauthClientId(e.target.value)}
            />
          </label>
          <label>
            Client Secret
            <input
              type="password"
              value={oauthClientSecret}
              placeholder="••••••••••••"
              onChange={(e) => setOauthClientSecret(e.target.value)}
            />
          </label>
          <div className="card-actions">
            <button className="primary" disabled={busy} onClick={handleSaveGithubApp}>
              Save my app
            </button>
            {githubApp.source === 'db' && (
              <button disabled={busy} onClick={handleClearGithubApp}>
                Use built-in app
              </button>
            )}
          </div>
        </div>

        {/* Codex */}
        <div className="card">
          <div className="card-title">Codex</div>
          {codex.connected ? (
            <>
              <div className="card-desc">
                Connected as <strong>{codex.codexUser || 'Codex CLI user'}</strong>.
              </div>
              <div className="card-actions">
                <button onClick={handleSwitchCodexAccount}>Switch Codex account</button>
              </div>
            </>
          ) : (
            <>
              <div className="card-desc">Not connected.</div>
              <div className="card-actions">
                <button className="primary" onClick={handleConnectCodex}>
                  Connect Codex
                </button>
              </div>
            </>
          )}

          {codexDevice && (
            <div className="device-box">
              <div>Enter this code:</div>
              <div className="device-code">{codexDevice.user_code}</div>
              <a
                href={codexDevice.verification_uri_complete}
                target="_blank"
                rel="noreferrer"
              >
                Open authorization page
              </a>
            </div>
          )}
        </div>

        {/* Projects */}
        <div className="card">
          <div className="card-title">
            Projects
            <button
              className="inline-btn"
              disabled={busy}
              onClick={() => { setError(null); setStep('create-project'); }}
            >
              + New project
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="card-desc">
              No projects yet. Create one — you'll connect it to GitHub while creating it.
            </div>
          ) : (
            <div className="project-list">
              {projects.map((project) => (
                <div className="project-item" key={project.id}>
                  <div className="project-info">
                    <div className="project-name">{project.name}</div>
                    <div className="project-meta">
                      {project.repository || 'No repository yet'}
                      {project.status === 'active' ? ' • active' : ` • ${project.status}`}
                    </div>
                  </div>
                  <div className="project-actions">
                    <button className="primary" onClick={() => openProject(project)}>
                      Open
                    </button>
                    <button onClick={() => handleDeleteProject(project.id)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderCreateProject() {
    return (
      <div className="auth-view">
        <h2>Create a project</h2>

        {!github.connected ? (
          <>
            <p className="muted">
              Projects are connected to a GitHub repository. Connect GitHub
              first — the login is automated and your connection is stored in
              your database.
            </p>
            <button className="primary" disabled={busy} onClick={() => handleConnectGithub('create-project')}>
              {busy ? 'Waiting for GitHub...' : 'Connect GitHub'}
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              GitHub is connected as <strong>@{github.githubUser}</strong>.
            </p>
            <label>
              Project name
              <input
                value={projectName}
                placeholder="My React Native app"
                onChange={(e) => setProjectName(e.target.value)}
              />
            </label>
            <label>
              Description <span className="hint">(optional)</span>
              <textarea
                value={projectDescription}
                placeholder="What is this app about?"
                onChange={(e) => setProjectDescription(e.target.value)}
              />
            </label>
            <div className="row">
              <button className="primary" disabled={busy} onClick={handleCreateProject}>
                {busy ? 'Creating...' : 'Create project'}
              </button>
              <button disabled={busy} onClick={() => { setError(null); setStep('dashboard'); }}>
                Back
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderGithub() {
    return (
      <div>
        <div className="card">
          <div className="card-title">Connect GitHub</div>
          <div className="card-desc">
            Sign in to GitHub in the browser tab that opened. Your connection,
            including tokens, will be stored securely in your database —
            nothing is kept on this machine.
          </div>
          <div className="card-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => handleConnectGithub(pendingGoalRef.current)}
            >
              {busy ? 'Waiting for authorization...' : 'Connect GitHub'}
            </button>
            <button disabled={busy} onClick={() => { setError(null); setStep('dashboard'); }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderBuildHeader() {
    const project = currentProject;
    const repo = selectedRepo;
    const branch = selectedBranch;

    return (
      <div className="subhead">
        {project ? project.name : 'Project'}
        {project?.repository
          ? ` — ${project.repository}${branch ? ` @ ${branch}` : ''}`
          : ''}
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>Design Engineer</h1>
        {renderBuildHeader()}
      </header>

      {/* =================================================================== */}
      {/* BOOT                                                              */}
      {/* =================================================================== */}

      {step === 'boot' && (
        <div style={{ padding: '16px' }}>
          <ProgressCard label="Restoring your account..." />
        </div>
      )}

      {/* =================================================================== */}
      {/* AUTH / ACCOUNT FLOW                                              */}
      {/* =================================================================== */}

      {step === 'auth' && renderAuth()}
      {step === 'signup' && renderSignup()}
      {step === 'signin' && renderSignin()}

      {/* =================================================================== */}
      {/* DASHBOARD                                                        */}
      {/* =================================================================== */}

      {step === 'dashboard' && renderDashboard()}

      {/* =================================================================== */}
      {/* CREATE PROJECT                                                    */}
      {/* =================================================================== */}

      {step === 'create-project' && renderCreateProject()}

      {/* =================================================================== */}
      {/* GITHUB RECONNECT                                                  */}
      {/* =================================================================== */}

      {step === 'github' && renderGithub()}

      {/* =================================================================== */}
      {/* SCREEN CHIPS                                                       */}
      {/* =================================================================== */}

      {(step === 'screens' || step === 'done') && selection.length > 0 && (
        <div className="chips">
          {selection.map((screen) => (
            <ContextChip
              key={screen.id}
              label={screen.name}
              checked={checkedIds.has(screen.id)}
              onToggle={() => toggleChecked(screen.id)}
            />
          ))}
        </div>
      )}

      {(step === 'screens' || step === 'done') && selection.length > 1 && (
        <div className="chips-actions">
          <button type="button" onClick={selectAllScreens} disabled={busy}>
            Select all
          </button>
          <button type="button" onClick={clearScreenSelection} disabled={busy}>
            Clear
          </button>
        </div>
      )}

      {/* =================================================================== */}
      {/* CHAT                                                               */}
      {/* =================================================================== */}

      {(step === 'screens' || step === 'done') && <Chat messages={messages} />}

      {/* =================================================================== */}
      {/* PROGRESS                                                          */}
      {/* =================================================================== */}

      {busy && busyLabel && (
        <div style={{ padding: '0 16px' }}>
          <ProgressCard label={busyLabel} />
        </div>
      )}

      {/* =================================================================== */}
      {/* ERROR                                                             */}
      {/* =================================================================== */}

      {error && <div className="error">{error}</div>}

      {/* =================================================================== */}
      {/* FOOTER ACTIONS                                                    */}
      {/* =================================================================== */}

      <footer>
        {step === 'repo' && currentProject && (
          <select
            disabled={busy}
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value;
              if (value) handleSelectRepo(value);
            }}
          >
            <option value="" disabled>
              Choose a repository...
            </option>
            {repos.map((repo) => (
              <option key={repo.fullName} value={repo.fullName}>
                {repo.fullName}
                {repo.private ? ' (private)' : ''}
              </option>
            ))}
          </select>
        )}

        {step === 'branch' && currentProject && (
          <select
            disabled={busy}
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value;
              if (value) handleSelectBranch(value);
            }}
          >
            <option value="" disabled>
              Choose a branch...
            </option>
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        )}

        {step === 'branch' && currentProject && (
          <button disabled={busy} onClick={() => setStep('repo')}>
            Back
          </button>
        )}

        {step === 'screens' && currentProject && (
          <button
            className="primary"
            disabled={busy || checkedIds.size === 0}
            onClick={handleFetch}
          >
            {checkedIds.size > 0 ? `Fetch (${checkedIds.size})` : 'Select screens'}
          </button>
        )}

        {step === 'screens' && currentProject && (
          <button disabled={busy} onClick={() => setStep('branch')}>
            Back
          </button>
        )}

        {(step === 'screens' || step === 'done') && currentProject && (
          <button
            disabled={busy}
            onClick={() => {
              setFetchedScreens([]);
              setCheckedIds(new Set());
              setSelectedRepo(null);
              selectedRepoRef.current = null;
              setSelectedBranch(null);
              selectedBranchRef.current = null;
              setStep('dashboard');
              loadDashboard().catch(() => {});
            }}
          >
            All projects
          </button>
        )}

        {step === 'done' && currentProject && (
          <button
            className="primary"
            disabled={busy}
            onClick={handleImplement}
          >
            Start implement
          </button>
        )}

        {step === 'done' && currentProject && (
          <button
            disabled={busy}
            onClick={() => {
              setStep('screens');
              setBusyLabel('');
              setError(null);
            }}
          >
            Select more screens
          </button>
        )}
      </footer>
    </div>
  );
}