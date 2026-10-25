// src/ui/hooks/useDesignEngineer.ts
//
// All plugin behaviour lives here: session restore, Codex browser sign-in,
// GitHub OAuth polling, repo/branch loading and screen extraction.
// Screens only read this state and call these actions, so the UI can be
// redesigned without touching the auth or extraction flow.

import { useEffect, useRef, useState } from 'react';

import { onPluginMessage, sendToPlugin } from '../figmaBridge';
import * as api from '../../api/client';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export type Step =
  | 'restoring'
  | 'account'
  | 'signin'
  | 'github'
  | 'project'
  | 'repo'
  | 'branch'
  | 'screens'
  | 'done';

export interface SelectionItem {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
}

export interface CodexBrowserAuth {
  browserAuth: true;
}

export interface CodexDeviceAuth {
  verificationUrl: string;
  userCode: string;
}

// What the user is waiting on, if anything. Drives the waiting screens.
export type Waiting =
  | null
  | 'account'
  | 'codex'
  | 'github'
  | 'projects'
  | 'create-project'
  | 'repos'
  | 'branches'
  | 'extracting'
  | 'saving';

export interface DesignEngineerState {
  step: Step;
  waiting: Waiting;
  error: string | null;
  notice: string | null;
  accountSignedIn: boolean;
  codexUser: string | null;
  githubUser: string | null;
  codexBrowserAuth: CodexBrowserAuth | null;
  codexDeviceAuth: CodexDeviceAuth | null;
  projects: api.Project[];
  selectedProject: api.Project | null;
  repos: api.Repo[];
  branches: api.Branch[];
  selectedRepo: string | null;
  selectedBranch: string | null;
  selection: SelectionItem[];
  checkedIds: Set<string>;
  extractingCount: number;
  savedFiles: string[];
}

// -----------------------------------------------------------------------------
// HOOK
// -----------------------------------------------------------------------------

export function useDesignEngineer() {
  const [step, setStep] = useState<Step>('restoring');
  const [waiting, setWaiting] = useState<Waiting>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [codexUser, setCodexUser] = useState<string | null>(null);
  const [githubUser, setGithubUser] = useState<string | null>(null);
  const [codexBrowserAuth, setCodexBrowserAuth] = useState<CodexBrowserAuth | null>(null);
  const [codexDeviceAuth, setCodexDeviceAuth] = useState<CodexDeviceAuth | null>(null);

  const [projects, setProjects] = useState<api.Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<api.Project | null>(null);
  const [repos, setRepos] = useState<api.Repo[]>([]);
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [extractingCount, setExtractingCount] = useState(0);
  const [savedFiles, setSavedFiles] = useState<string[]>([]);

  // Refs mirror state for use inside the message listener and polling
  // callbacks, which are created once and would otherwise see stale values.
  const sessionIdRef = useRef<string | null>(null);
  const selectedProjectRef = useRef<api.Project | null>(null);
  const selectedRepoRef = useRef<string | null>(null);
  const selectedBranchRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { selectedProjectRef.current = selectedProject; }, [selectedProject]);
  useEffect(() => { selectedRepoRef.current = selectedRepo; }, [selectedRepo]);
  useEffect(() => { selectedBranchRef.current = selectedBranch; }, [selectedBranch]);

  function rememberSession(id: string | null) {
    setSessionId(id);
    sessionIdRef.current = id;
  }

  function stopPolling() {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function fail(message: string, err?: unknown) {
    if (err) console.error('[Design Engineer]', message, err);
    setWaiting(null);
    setError(message);
  }

  // When a newly selected frame appears on the canvas, tick it by default.
  // Frames that leave the canvas selection are unticked.
  function applySelection(next: SelectionItem[]) {
    setSelection((previous) => {
      const previousIds = new Set(previous.map((s) => s.id));
      setCheckedIds((checked) => {
        const result = new Set<string>();
        for (const item of next) {
          if (checked.has(item.id) || !previousIds.has(item.id)) {
            result.add(item.id);
          }
        }
        return result;
      });
      return next;
    });
  }

  // ===========================================================================
  // INITIALIZE
  // ===========================================================================

  useEffect(() => {
    const cleanup = onPluginMessage((msg) => {
      if (msg.type === 'saved-session') {
        restoreSavedSession(msg.session || null);
      }

      if (msg.type === 'selection-changed') {
        applySelection(msg.selection || []);
      }

      if (msg.type === 'extract-started') {
        setWaiting('extracting');
        setExtractingCount(msg.total || 0);
      }

      if (msg.type === 'extraction-error') {
        fail(msg.error || 'Figma could not read the selected screens.');
      }

      if (msg.type === 'screens-extracted') {
        handleExtracted(msg.results || []);
      }
    });

    sendToPlugin({ type: 'get-saved-session' });
    sendToPlugin({ type: 'get-selection' });

    return () => {
      cleanup();
      stopPolling();
    };
    // Listener intentionally registered once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===========================================================================
  // RESTORE SESSION
  // ===========================================================================

  async function restoreSavedSession(savedSession: api.AuthSession | null) {
    if (!savedSession?.accessToken || !savedSession.refreshToken) {
      api.setAccessToken(null);
      rememberSession(null);
      setStep('account');
      return;
    }

    api.setAccessToken(savedSession.accessToken);
    rememberSession(savedSession.user?.id || null);

    try {
      let me: api.MeResponse;
      try {
        me = await api.getMe();
      } catch (error) {
        if (!(error instanceof api.ApiError) || error.status !== 401) throw error;

        const refreshed = await api.refreshSession(savedSession.refreshToken);
        api.setAccessToken(refreshed.accessToken);
        rememberSession(refreshed.user.id);
        sendToPlugin({ type: 'save-session', session: refreshed });
        me = await api.getMe();
      }

      rememberSession(me.user.id);
      setCodexUser(me.codex.codexUser);
      if (me.codex.connected) {
        if (me.github.connected) {
          setGithubUser(me.github.githubUser);
          await loadProjects();
          return;
        }
        setStep('github');
        return;
      }

      setStep('signin');
    } catch (err) {
      console.error('[Design Engineer] Session restoration failed:', err);
      if (err instanceof api.ApiError && err.status === 401) {
        api.setAccessToken(null);
        rememberSession(null);
        sendToPlugin({ type: 'clear-session' });
      }
      setError(serverError(err, 'Your saved account session could not be restored.'));
      setStep('account');
    }
  }

  // ===========================================================================
  // CODEX SIGN-IN
  // ===========================================================================

  function acceptAccountSession(session: api.AuthSession) {
    api.setAccessToken(session.accessToken);
    rememberSession(session.user.id);
    sendToPlugin({ type: 'save-session', session });
    setError(null);
    setNotice(null);
    setWaiting(null);
    setStep('signin');
  }

  async function signInWithEmail(email: string, password: string) {
    setError(null);
    setNotice(null);
    setWaiting('account');

    try {
      acceptAccountSession(await api.signin(email, password));
    } catch (err) {
      fail(serverError(err, 'Account sign-in failed.'), err);
    }
  }

  async function signUpWithEmail(email: string, password: string) {
    setError(null);
    setNotice(null);
    setWaiting('account');

    try {
      const result = await api.signup(email, password);
      if (result.accessToken && result.refreshToken && result.user) {
        acceptAccountSession({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user,
        });
        return;
      }

      setWaiting(null);
      setNotice(
        result.confirmationRequired
          ? `Check ${result.email || email} for a confirmation link, then sign in.`
          : 'Account created. Sign in to continue.'
      );
    } catch (err) {
      fail(serverError(err, 'Account creation failed.'), err);
    }
  }

  async function connectGoogle() {
    setError(null);
    setNotice(null);
    setWaiting('account');

    try {
      const { url, state: oauthState } = await api.googleConnect();
      window.open(url, '_blank');

      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const result = await api.googleStatus(oauthState);
          if (result.status === 'done' && result.session) {
            stopPolling();
            acceptAccountSession(result.session);
          } else if (result.status === 'error' || result.status === 'expired') {
            stopPolling();
            fail(result.error || 'Google sign-in expired. Please try again.');
          }
        } catch (err) {
          stopPolling();
          fail(serverError(err, 'Google sign-in could not be completed.'), err);
        }
      }, 2000);
    } catch (err) {
      fail(serverError(err, 'Google sign-in could not start.'), err);
    }
  }

  async function continueAfterCodex(user: string | null) {
    setCodexUser(user);
    setWaiting(null);
    setStep('github');

    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      return;
    }

    try {
      const github = await api.getSessionStatus(currentSessionId);
      if (github.githubConnected) {
        setGithubUser(github.githubUser);
        await loadProjects();
        return;
      }
      setStep('github');
    } catch (err) {
      fail(serverError(err, "Codex is connected, but GitHub status couldn't be checked."), err);
      setStep('github');
    }
  }

  async function signIn() {
    setError(null);
    setNotice(null);
    if (!api.getAccessToken()) {
      setStep('account');
      fail('Sign in to your Design Engineer account before connecting Codex.');
      return;
    }
    setWaiting('codex');

    try {
      let currentSessionId = sessionIdRef.current;

      // Codex may already be signed in on the backend.
      if (currentSessionId) {
        const existing = await api.getCodexStatus(currentSessionId);
        if (existing.connected) {
          await continueAfterCodex(existing.codexUser);
          return;
        }
      }

      const device = await api.startCodexAuth();
      if (device.alreadyAuthenticated) {
        await continueAfterCodex(device.codexUser || null);
        return;
      }

      if (device.deviceAuth && device.verificationUrl && device.userCode) {
        setCodexDeviceAuth({
          verificationUrl: device.verificationUrl,
          userCode: device.userCode,
        });
        window.open(device.verificationUrl, '_blank');
      } else if (device.browserAuth) {
        setCodexBrowserAuth({ browserAuth: true });
      } else {
        fail('Codex sign-in could not start. Try again in a moment.');
        return;
      }

      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const status = await api.getCodexAuthStatus(device.device_code);

          if (status.status === 'approved') {
            stopPolling();
            setCodexBrowserAuth(null);
            setCodexDeviceAuth(null);
            await continueAfterCodex(status.codexUser);
          }

          if (status.status === 'expired') {
            stopPolling();
            setCodexBrowserAuth(null);
            setCodexDeviceAuth(null);
            fail(status.error || 'Codex sign-in did not complete. Try again.');
          }
        } catch (pollingError) {
          console.error('[Design Engineer] Codex polling error:', pollingError);
        }
      }, (device.interval || 3) * 1000);
    } catch (err) {
      fail(serverError(err, 'Codex sign-in could not start.'), err);
    }
  }

  function cancelWaiting() {
    stopPolling();
    setCodexBrowserAuth(null);
    setCodexDeviceAuth(null);
    setWaiting(null);
    setError(null);
  }

  // ===========================================================================
  // GITHUB
  // ===========================================================================

  async function connectGithub() {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      setStep('signin');
      fail('Your session ended. Sign in to Codex again.');
      return;
    }

    setError(null);

    try {
      const { url } = await api.githubConnect();
      window.open(url, '_blank');
      setWaiting('github');

      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const status = await api.getSessionStatus(currentSessionId);
          if (status.githubConnected) {
            stopPolling();
            setGithubUser(status.githubUser);
            await loadProjects();
          }
        } catch (pollingError) {
          console.error('[Design Engineer] GitHub polling error:', pollingError);
        }
      }, 2000);
    } catch (err) {
      fail(serverError(err, "Couldn't start GitHub sign-in."), err);
    }
  }

  async function reopenGithub() {
    try {
      const { url } = await api.githubConnect();
      window.open(url, '_blank');
    } catch (err) {
      console.error('[Design Engineer] Failed to reopen GitHub auth:', err);
    }
  }

  async function switchCodexAccount() {
    stopPolling();
    setError(null);
    setWaiting('codex');

    try {
      await api.logoutCodex();
      setCodexUser(null);
      setCodexBrowserAuth(null);
      setCodexDeviceAuth(null);
      setSelectedRepo(null);
      setSelectedBranch(null);
      selectedRepoRef.current = null;
      selectedBranchRef.current = null;
      setWaiting(null);
      setStep('signin');
    } catch (err) {
      fail(serverError(err, "Couldn't switch Codex accounts."), err);
    }
  }

  async function switchGithubAccount() {
    setError(null);

    try {
      await api.githubDisconnect();
      setGithubUser(null);
      setRepos([]);
      setBranches([]);
      setProjects([]);
      setSelectedProject(null);
      selectedProjectRef.current = null;
      setSelectedRepo(null);
      setSelectedBranch(null);
      selectedRepoRef.current = null;
      selectedBranchRef.current = null;
      setStep('github');
    } catch (err) {
      fail(serverError(err, "Couldn't switch GitHub accounts."), err);
    }
  }

  async function logoutAccount() {
    stopPolling();
    setError(null);
    setWaiting('account');

    try {
      await api.logout();
      api.setAccessToken(null);
      rememberSession(null);
      sendToPlugin({ type: 'clear-session' });
      setCodexUser(null);
      setGithubUser(null);
      setRepos([]);
      setBranches([]);
      setProjects([]);
      setSelectedProject(null);
      selectedProjectRef.current = null;
      setSelectedRepo(null);
      setSelectedBranch(null);
      selectedRepoRef.current = null;
      selectedBranchRef.current = null;
      setCodexBrowserAuth(null);
      setCodexDeviceAuth(null);
      setWaiting(null);
      setStep('account');
    } catch (err) {
      fail(serverError(err, "Couldn't log out."), err);
    }
  }

  function goBack() {
    if (waiting === 'github' || waiting === 'codex') {
      stopPolling();
      setWaiting(null);
      setCodexBrowserAuth(null);
      setCodexDeviceAuth(null);
    }
    setError(null);
    if (step === 'github') setStep('signin');
    else if (step === 'project') setStep('github');
    else if (step === 'repo') setStep('project');
    else if (step === 'branch') setStep('repo');
    else if (step === 'screens') setStep('branch');
    else if (step === 'done') setStep('screens');
  }

  function continueToGithub() {
    if (codexUser) {
      void continueAfterCodex(codexUser);
    } else {
      setStep('github');
    }
  }

  // ===========================================================================
  // REPOSITORIES AND BRANCHES
  // ===========================================================================

  async function loadProjects() {
    if (!sessionIdRef.current) {
      fail('Your session ended. Sign in to Codex again.');
      setStep('signin');
      return;
    }

    setError(null);
    setWaiting('projects');
    setStep('project');

    try {
      const data = await api.listProjects();
      setProjects(data.projects || []);
      setWaiting(null);
    } catch (err) {
      fail(serverError(err, "Couldn't load projects."), err);
    }
  }

  async function createProject(name: string) {
    setError(null);
    setWaiting('create-project');

    try {
      const result = await api.createProject(name);
      setProjects((previous) => [result.project, ...previous]);
      await activateProject(result.project);
    } catch (err) {
      fail(serverError(err, "Couldn't create the project."), err);
    }
  }

  async function chooseProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      fail('Choose a valid project.');
      return;
    }

    await activateProject(project);
  }

  async function activateProject(project: api.Project) {
    setSelectedProject(project);
    selectedProjectRef.current = project;
    setSelectedRepo(project.repository);
    selectedRepoRef.current = project.repository;
    setSelectedBranch(project.base_branch);
    selectedBranchRef.current = project.base_branch;
    setBranches([]);
    await loadRepos();
  }

  async function loadRepos() {
    if (!sessionIdRef.current) {
      fail('Your session ended. Sign in to Codex again.');
      setStep('signin');
      return;
    }

    setError(null);
    setWaiting('repos');
    setStep('repo');

    try {
      const data = await api.listRepos();
      setRepos(data.repos || []);
      setWaiting(null);
    } catch (err) {
      fail(serverError(err, "Couldn't load repositories."), err);
    }
  }

  async function chooseRepo(fullName: string) {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      fail('Your session ended. Sign in to Codex again.');
      setStep('signin');
      return;
    }

    const keepBranch = selectedRepoRef.current === fullName;
    setSelectedRepo(fullName);
    selectedRepoRef.current = fullName;
    if (!keepBranch) {
      setSelectedBranch(null);
      selectedBranchRef.current = null;
    }
    setBranches([]);
    setError(null);
    setWaiting('branches');
    setStep('branch');

    try {
      const [owner, repo] = fullName.split('/');
      const data = await api.listBranches(owner, repo);
      setBranches(data.branches || []);
      setWaiting(null);
    } catch (err) {
      fail(serverError(err, "Couldn't load branches."), err);
    }
  }

  async function chooseBranch(name: string) {
    const project = selectedProjectRef.current;
    const repo = selectedRepoRef.current;
    if (!project || !repo) {
      fail('Choose a project and repository first.');
      return;
    }

    setError(null);
    setWaiting('saving');
    try {
      const result = await api.updateProject(project.id, {
        repository: repo,
        base_branch: name,
      });
      setSelectedProject(result.project);
      selectedProjectRef.current = result.project;
    } catch (err) {
      fail(serverError(err, "Couldn't save the repository and branch to this project."), err);
      return;
    }

    setSelectedBranch(name);
    selectedBranchRef.current = name;
    setWaiting(null);
    setError(null);
    setStep('screens');
    sendToPlugin({ type: 'get-selection' });
  }

  function changeRepo() {
    setError(null);
    setStep('repo');
    if (repos.length === 0) void loadRepos();
  }

  function changeBranch() {
    const repo = selectedRepoRef.current;
    if (repo) {
      chooseRepo(repo);
    } else {
      changeRepo();
    }
  }

  // ===========================================================================
  // SCREENS
  // ===========================================================================

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
    if (!sessionIdRef.current || !selectedProjectRef.current || !selectedRepoRef.current || !selectedBranchRef.current) {
      fail('Choose a project, repository and branch first.');
      return;
    }
    if (checkedIds.size === 0) {
      fail('Select at least one screen.');
      return;
    }

    setError(null);
    setExtractingCount(checkedIds.size);
    setWaiting('extracting');
    sendToPlugin({ type: 'extract-screens', nodeIds: Array.from(checkedIds) });
  }

  async function handleExtracted(results: any[]) {
    const currentSessionId = sessionIdRef.current;
    const currentRepo = selectedRepoRef.current;
    const currentBranch = selectedBranchRef.current;

    const currentProject = selectedProjectRef.current;
    if (!currentSessionId || !currentProject || !currentRepo || !currentBranch) {
      fail('Choose a project, repository and branch first.');
      return;
    }
    if (!results || results.length === 0) {
      fail('Figma returned no Design Context for these screens.');
      return;
    }

    setWaiting('saving');

    try {
      const result = await api.submitScreens(currentProject.id, currentRepo, currentBranch, results);
      setSavedFiles(result.saved || []);
      setCheckedIds(new Set());
      setWaiting(null);
      setStep('done');
    } catch (err) {
      fail(serverError(err, "Couldn't save the Design Context."), err);
    }
  }

  function fetchMore() {
    setError(null);
    setSavedFiles([]);
    setStep('screens');
    sendToPlugin({ type: 'get-selection' });
  }

  function retry() {
    setError(null);
    if (step === 'project') loadProjects();
    else if (step === 'repo') loadRepos();
    else if (step === 'branch') changeBranch();
    else if (step === 'screens') fetchScreens();
    else if (step === 'account') connectGoogle();
    else if (step === 'signin') signIn();
    else if (step === 'github') connectGithub();
  }

  const state: DesignEngineerState = {
    step,
    waiting,
    error,
    notice,
    accountSignedIn: !!api.getAccessToken(),
    codexUser,
    githubUser,
    codexBrowserAuth,
    codexDeviceAuth,
    projects,
    selectedProject,
    repos,
    branches,
    selectedRepo,
    selectedBranch,
    selection,
    checkedIds,
    extractingCount,
    savedFiles,
  };

  const actions = {
    signInWithEmail,
    signUpWithEmail,
    connectGoogle,
    signIn,
    switchCodexAccount,
    switchGithubAccount,
    logoutAccount,
    goBack,
    continueToGithub,
    cancelWaiting,
    connectGithub,
    reopenGithub,
    loadRepos: () => loadRepos(),
    loadProjects,
    chooseProject,
    createProject,
    chooseRepo,
    chooseBranch,
    changeRepo,
    changeBranch,
    toggleChecked,
    checkAll,
    clearChecked,
    fetchScreens,
    fetchMore,
    retry,
    dismissError: () => setError(null),
  };

  return { state, actions };
}

export type DesignEngineerActions = ReturnType<typeof useDesignEngineer>['actions'];

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

// Turns fetch failures into a message that says where the problem is.
function serverError(err: any, prefix = 'Something went wrong.'): string {
  const message = String(err?.message || '');
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return `${prefix} The Design Engineer server at ${api.getBaseUrl()} isn't responding. Check that it's running, then try again.`;
  }
  return message ? `${prefix} ${message}` : prefix;
}
