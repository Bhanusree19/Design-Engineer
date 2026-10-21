// src/ui/hooks/useDesignEngineer.ts
//
// All plugin behaviour lives here: session restore, Codex device sign-in,
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
  | 'signin'
  | 'github'
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

export interface DeviceCode {
  userCode: string;
  verificationUri: string;
}

// What the user is waiting on, if anything. Drives the waiting screens.
export type Waiting =
  | null
  | 'codex'
  | 'github'
  | 'repos'
  | 'branches'
  | 'extracting'
  | 'saving';

export interface DesignEngineerState {
  step: Step;
  waiting: Waiting;
  error: string | null;
  codexUser: string | null;
  githubUser: string | null;
  deviceCode: DeviceCode | null;
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

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [codexUser, setCodexUser] = useState<string | null>(null);
  const [githubUser, setGithubUser] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null);

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
  const selectedRepoRef = useRef<string | null>(null);
  const selectedBranchRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
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
    sendToPlugin({ type: 'get-saved-session' });
    sendToPlugin({ type: 'get-selection' });

    const cleanup = onPluginMessage((msg) => {
      if (msg.type === 'saved-session') {
        restoreSavedSession(msg.sessionId, !!msg.codexAuthenticated);
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

  async function restoreSavedSession(savedSessionId: string | null, codexAuthenticated = false) {
    // No saved session, but Codex was signed in before: recreate a session
    // without forcing a new device login.
    if (!savedSessionId) {
      if (codexAuthenticated) {
        try {
          const session = await api.createSession();
          rememberSession(session.sessionId);
          sendToPlugin({ type: 'save-session', sessionId: session.sessionId });

          const codexStatus = await api.getCodexStatus(session.sessionId);
          if (codexStatus.connected) {
            sendToPlugin({ type: 'save-codex-auth' });
            setCodexUser(codexStatus.codexUser);
            setStep('github');
            return;
          }
        } catch (restoreError) {
          console.error('[Design Engineer] Failed to restore session from Codex marker:', restoreError);
        }
      }

      setStep('signin');
      return;
    }

    rememberSession(savedSessionId);

    try {
      const sessionStatus = await api.getSessionStatus(savedSessionId);
      const codexStatus = await api.getCodexStatus(savedSessionId);

      if (codexStatus.connected) {
        sendToPlugin({ type: 'save-codex-auth' });
        setCodexUser(codexStatus.codexUser);

        if (sessionStatus.githubConnected) {
          setGithubUser(sessionStatus.githubUser);
          await loadRepos(savedSessionId);
          return;
        }

        setStep('github');
        return;
      }

      setStep('signin');
    } catch (err: any) {
      console.error('[Design Engineer] Session restoration failed:', err);

      // Only drop the saved session when the backend says it doesn't exist.
      if (String(err?.message || '').includes('404')) {
        sendToPlugin({ type: 'clear-session' });
        rememberSession(null);
      } else {
        setError(serverError(err));
      }

      setStep('signin');
    }
  }

  // ===========================================================================
  // CODEX SIGN-IN
  // ===========================================================================

  async function signIn() {
    setError(null);
    setWaiting('codex');

    try {
      let currentSessionId = sessionIdRef.current;

      // Codex may already be signed in on the backend.
      if (currentSessionId) {
        const existing = await api.getCodexStatus(currentSessionId);
        if (existing.connected) {
          sendToPlugin({ type: 'save-codex-auth' });
          setCodexUser(existing.codexUser);
          setWaiting(null);
          setStep('github');
          return;
        }
      }

      if (!currentSessionId) {
        const session = await api.createSession();
        currentSessionId = session.sessionId;
        rememberSession(currentSessionId);
        sendToPlugin({ type: 'save-session', sessionId: currentSessionId });
      }

      const device = await api.startCodexDeviceAuth(currentSessionId);
      const code: DeviceCode = {
        userCode: device.user_code,
        verificationUri: device.verification_uri_complete || device.verification_uri,
      };
      setDeviceCode(code);
      openDevicePage(code);

      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const status = await api.getCodexDeviceStatus(device.device_code);

          if (status.status === 'approved') {
            stopPolling();
            sendToPlugin({ type: 'save-codex-auth' });
            setCodexUser(status.codexUser);
            setDeviceCode(null);
            setWaiting(null);
            setStep('github');
          }

          if (status.status === 'expired') {
            stopPolling();
            setDeviceCode(null);
            fail('That code expired. Get a new code to try again.');
          }
        } catch (pollingError) {
          console.error('[Design Engineer] Codex polling error:', pollingError);
        }
      }, (device.interval || 3) * 1000);
    } catch (err) {
      fail(serverError(err, 'Codex sign-in could not start.'), err);
    }
  }

  // Opens the sign-in page and puts the code on the clipboard so the user
  // can paste it instead of typing it.
  function openDevicePage(code: DeviceCode | null = deviceCode) {
    if (!code) return;
    copyText(code.userCode);
    window.open(code.verificationUri, '_blank');
  }

  function cancelWaiting() {
    stopPolling();
    setDeviceCode(null);
    setWaiting(null);
    setError(null);
  }

  // ===========================================================================
  // GITHUB
  // ===========================================================================

  function connectGithub() {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      setStep('signin');
      fail('Your session ended. Sign in to Codex again.');
      return;
    }

    setError(null);
    window.open(api.githubAuthUrl(currentSessionId), '_blank');
    setWaiting('github');

    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const status = await api.getSessionStatus(currentSessionId);
        if (status.githubConnected) {
          stopPolling();
          setGithubUser(status.githubUser);
          await loadRepos(currentSessionId);
        }
      } catch (pollingError) {
        console.error('[Design Engineer] GitHub polling error:', pollingError);
      }
    }, 2000);
  }

  function reopenGithub() {
    const currentSessionId = sessionIdRef.current;
    if (currentSessionId) window.open(api.githubAuthUrl(currentSessionId), '_blank');
  }

  // ===========================================================================
  // REPOSITORIES AND BRANCHES
  // ===========================================================================

  async function loadRepos(overrideSessionId?: string) {
    const currentSessionId = overrideSessionId || sessionIdRef.current;
    if (!currentSessionId) {
      fail('Your session ended. Sign in to Codex again.');
      setStep('signin');
      return;
    }

    setError(null);
    setWaiting('repos');
    setStep('repo');

    try {
      const data = await api.listRepos(currentSessionId);
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

    setSelectedRepo(fullName);
    selectedRepoRef.current = fullName;
    setSelectedBranch(null);
    selectedBranchRef.current = null;
    setBranches([]);
    setError(null);
    setWaiting('branches');
    setStep('branch');

    try {
      const [owner, repo] = fullName.split('/');
      const data = await api.listBranches(currentSessionId, owner, repo);
      setBranches(data.branches || []);
      setWaiting(null);
    } catch (err) {
      fail(serverError(err, "Couldn't load branches."), err);
    }
  }

  function chooseBranch(name: string) {
    setSelectedBranch(name);
    selectedBranchRef.current = name;
    setError(null);
    setStep('screens');
    sendToPlugin({ type: 'get-selection' });
  }

  function changeRepo() {
    setError(null);
    setStep('repo');
    if (repos.length === 0) loadRepos();
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
    if (!sessionIdRef.current || !selectedRepoRef.current || !selectedBranchRef.current) {
      fail('Choose a repository and branch first.');
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

    if (!currentSessionId || !currentRepo || !currentBranch) {
      fail('Choose a repository and branch first.');
      return;
    }
    if (!results || results.length === 0) {
      fail('Figma returned no Design Context for these screens.');
      return;
    }

    setWaiting('saving');

    try {
      const result = await api.submitScreens(currentSessionId, currentRepo, currentBranch, results);
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
    if (step === 'repo') loadRepos();
    else if (step === 'branch') changeBranch();
    else if (step === 'screens') fetchScreens();
    else if (step === 'signin') signIn();
    else if (step === 'github') connectGithub();
  }

  const state: DesignEngineerState = {
    step,
    waiting,
    error,
    codexUser,
    githubUser,
    deviceCode,
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
    signIn,
    openDevicePage: () => openDevicePage(),
    copyDeviceCode: () => deviceCode && copyText(deviceCode.userCode),
    cancelWaiting,
    connectGithub,
    reopenGithub,
    loadRepos: () => loadRepos(),
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

// navigator.clipboard is often blocked inside the Figma plugin iframe,
// so fall back to a hidden textarea and execCommand.
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
