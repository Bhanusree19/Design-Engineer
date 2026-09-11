
// const DEFAULT_BASE_URL =
//   'http://localhost:4000';

// function getBaseUrl(): string {
//   return (
//     (window as any)
//       .__DESIGN_ENGINEER_API__ ||
//     DEFAULT_BASE_URL
//   );
// }

// async function request<T = any>(
//   path: string,
//   options: RequestInit = {}
// ): Promise<T> {
//   const res =
//     await fetch(
//       `${getBaseUrl()}${path}`,
//       {
//         ...options,

//         headers: {
//           'Content-Type':
//             'application/json',

//           ...(options.headers ||
//             {}),
//         },
//       }
//     );

//   if (!res.ok) {
//     const text =
//       await res
//         .text()
//         .catch(() => '');

//     throw new Error(
//       `Request to ${path} failed (${res.status}): ${
//         text ||
//         res.statusText
//       }`
//     );
//   }

//   return res.json();
// }

// /**
//  * Session.
//  */
// export interface Session {
//   sessionId: string;
// }

// /**
//  * Session status.
//  */
// export interface SessionStatus {
//   codexConnected?: boolean;

//   codexUser?: string | null;

//   githubConnected: boolean;

//   githubUser: string | null;
// }

// /**
//  * GitHub repository.
//  */
// export interface Repo {
//   fullName: string;

//   private: boolean;
// }

// /**
//  * GitHub branch.
//  */
// export interface Branch {
//   name: string;
// }

// /**
//  * Design Context upload response.
//  */
// export interface SubmitScreensResponse {
//   success: boolean;

//   saved: string[];

//   screenCount: number;

//   file?: string;
// }

// /**
//  * Create backend session.
//  */
// export function createSession(): Promise<Session> {
//   return request(
//     '/auth/session',
//     {
//       method: 'POST',
//     }
//   );
// }

// /**
//  * Get session status.
//  */
// export function getSessionStatus(
//   sessionId: string
// ): Promise<SessionStatus> {
//   return request(
//     `/auth/session/${sessionId}`
//   );
// }

// /**
//  * GitHub OAuth URL.
//  */
// export function githubAuthUrl(
//   sessionId: string
// ): string {
//   return `${getBaseUrl()}/auth/github?session=${sessionId}`;
// }

// /**
//  * Get repositories.
//  */
// export function listRepos(
//   sessionId: string
// ): Promise<{
//   repos: Repo[];
// }> {
//   return request(
//     `/api/repos?session=${sessionId}`
//   );
// }

// /**
//  * Get branches.
//  */
// export function listBranches(
//   sessionId: string,

//   owner: string,

//   repo: string
// ): Promise<{
//   branches: Branch[];
// }> {
//   return request(
//     `/api/repos/${owner}/${repo}/branches?session=${sessionId}`
//   );
// }

// /**
//  * Send extracted Design Context to backend.
//  */
// export function submitScreens(
//   sessionId: string,

//   repo: string,

//   branch: string,

//   screens: unknown[]
// ): Promise<SubmitScreensResponse> {
//   return request(
//     '/api/screens/fetch',
//     {
//       method: 'POST',

//       body: JSON.stringify({
//         session:
//           sessionId,

//         repo,

//         branch,

//         screens,
//       }),
//     }
//   );
// }

// /**
//  * Start Codex device authentication.
//  */
// export function startCodexDeviceAuth(
//   sessionId: string
// ) {
//   return request<{
//     device_code: string;

//     user_code: string;

//     verification_uri: string;

//     verification_uri_complete: string;

//     interval: number;
//   }>(
//     '/auth/codex/device',
//     {
//       method: 'POST',

//       body: JSON.stringify({
//         session:
//           sessionId,
//       }),
//     }
//   );
// }

// /**
//  * Check Codex authentication status.
//  */
// export function getCodexDeviceStatus(
//   deviceCode: string
// ) {
//   return request<{
//     status:
//       | 'pending'
//       | 'approved'
//       | 'expired';

//     codexUser:
//       | string
//       | null;
//   }>(
//     `/auth/codex/device/${deviceCode}/status`
//   );
// }


// src/api/client.ts

// -----------------------------------------------------------------------------
// Design Engineer Backend Client
// -----------------------------------------------------------------------------

const DEFAULT_BASE_URL =
  'http://localhost:4000';

function getBaseUrl(): string {
  return (
    (window as any)
      .__DESIGN_ENGINEER_API__ ||
    DEFAULT_BASE_URL
  );
}

async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(
    `${getBaseUrl()}${path}`,
    {
      ...options,

      headers: {
        'Content-Type':
          'application/json',

        ...(options.headers || {}),
      },
    }
  );

  if (!res.ok) {
    const text =
      await res
        .text()
        .catch(() => '');

    throw new Error(
      `Request to ${path} failed (${res.status}): ${
        text || res.statusText
      }`
    );
  }

  return res.json();
}

// -----------------------------------------------------------------------------
// SESSION
// -----------------------------------------------------------------------------

export interface Session {
  sessionId: string;
}

export interface SessionStatus {
  githubConnected: boolean;
  githubUser: string | null;

  codexConnected?: boolean;
  codexUser?: string | null;
}

export function createSession(): Promise<Session> {
  return request(
    '/auth/session',
    {
      method: 'POST',
    }
  );
}

export function getSessionStatus(
  sessionId: string
): Promise<SessionStatus> {
  return request(
    `/auth/session/${encodeURIComponent(
      sessionId
    )}`
  );
}

// -----------------------------------------------------------------------------
// CODEX AUTH
// -----------------------------------------------------------------------------

export interface CodexStatus {
  connected: boolean;
  codexUser: string | null;
}

/**
 * Checks whether Codex CLI is already authenticated.
 *
 * IMPORTANT:
 * This does NOT start a new login.
 *
 * Backend internally runs:
 *
 *   codex login status
 *
 * using the persistent CODEX_HOME.
 */
export function getCodexStatus(
  sessionId: string
): Promise<CodexStatus> {
  return request(
    `/auth/codex/status?session=${encodeURIComponent(
      sessionId
    )}`
  );
}

export function startCodexDeviceAuth(
  sessionId: string
) {
  return request<{
    device_code: string;

    user_code: string;

    verification_uri: string;

    verification_uri_complete: string;

    interval: number;
  }>(
    '/auth/codex/device',
    {
      method: 'POST',

      body: JSON.stringify({
        session:
          sessionId,
      }),
    }
  );
}

export function getCodexDeviceStatus(
  deviceCode: string
) {
  return request<{
    status:
      | 'pending'
      | 'approved'
      | 'expired';

    codexUser:
      | string
      | null;
  }>(
    `/auth/codex/device/${encodeURIComponent(
      deviceCode
    )}/status`
  );
}

// -----------------------------------------------------------------------------
// GITHUB AUTH
// -----------------------------------------------------------------------------

export function githubAuthUrl(
  sessionId: string
): string {
  return (
    `${getBaseUrl()}/auth/github` +
    `?session=${encodeURIComponent(
      sessionId
    )}`
  );
}

// -----------------------------------------------------------------------------
// REPOSITORIES
// -----------------------------------------------------------------------------

export interface Repo {
  fullName: string;
  private: boolean;
}

export function listRepos(
  sessionId: string
): Promise<{
  repos: Repo[];
}> {
  return request(
    `/api/repos?session=${encodeURIComponent(
      sessionId
    )}`
  );
}

// -----------------------------------------------------------------------------
// BRANCHES
// -----------------------------------------------------------------------------

export interface Branch {
  name: string;
}

export function listBranches(
  sessionId: string,
  owner: string,
  repo: string
): Promise<{
  branches: Branch[];
}> {
  return request(
    `/api/repos/${encodeURIComponent(
      owner
    )}/${encodeURIComponent(
      repo
    )}/branches?session=${encodeURIComponent(
      sessionId
    )}`
  );
}

// -----------------------------------------------------------------------------
// DESIGN CONTEXT
// -----------------------------------------------------------------------------

export function submitScreens(
  sessionId: string,
  repo: string,
  branch: string,
  screens: unknown[]
): Promise<{
  saved: string[];

  screenCount?: number;
}> {
  return request(
    '/api/screens/fetch',
    {
      method: 'POST',

      body: JSON.stringify({
        session:
          sessionId,

        repo,

        branch,

        screens,
      }),
    }
  );
}