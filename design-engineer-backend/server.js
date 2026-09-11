// // server.js

// require('dotenv').config();

// const express = require('express');
// const cors = require('cors');
// const crypto = require('crypto');
// const fs = require('fs');
// const path = require('path');
// const { spawn } = require('child_process');

// const app = express();

// app.use(cors());

// app.use(
//   express.json({
//     limit: '25mb',
//   })
// );

// app.use(
//   express.urlencoded({
//     extended: true,
//   })
// );

// const PORT =
//   process.env.PORT || 4000;

// const GITHUB_CLIENT_ID =
//   process.env.GITHUB_CLIENT_ID;

// const GITHUB_CLIENT_SECRET =
//   process.env.GITHUB_CLIENT_SECRET;

// const BACKEND_URL =
//   process.env.BACKEND_URL ||
//   `http://localhost:${PORT}`;

// // -----------------------------------------------------------------------------
// // SESSION STORE
// // -----------------------------------------------------------------------------

// const sessions =
//   new Map();

// const SESSIONS_FILE =
//   path.join(
//     __dirname,
//     'data',
//     'sessions.json'
//   );

// const CODEX_HOME =
//   path.join(
//     __dirname,
//     '.codex'
//   );

// const CODEX_CLI_BIN =
//   path.join(
//     __dirname,
//     'node_modules',
//     '@openai',
//     'codex',
//     'bin',
//     'codex.js'
//   );

// fs.mkdirSync(
//   CODEX_HOME,
//   {
//     recursive: true,
//   }
// );

// // -----------------------------------------------------------------------------
// // SESSION PERSISTENCE
// // -----------------------------------------------------------------------------

// function persistSessions() {
//   fs.mkdirSync(
//     path.dirname(
//       SESSIONS_FILE
//     ),
//     {
//       recursive: true,
//     }
//   );

//   fs.writeFileSync(
//     SESSIONS_FILE,
//     JSON.stringify(
//       Object.fromEntries(
//         sessions
//       ),
//       null,
//       2
//     ),
//     'utf8'
//   );
// }

// function loadSessions() {
//   if (
//     !fs.existsSync(
//       SESSIONS_FILE
//     )
//   ) {
//     return;
//   }

//   try {
//     const obj =
//       JSON.parse(
//         fs.readFileSync(
//           SESSIONS_FILE,
//           'utf8'
//         )
//       );

//     Object.entries(
//       obj
//     ).forEach(
//       ([id, value]) => {
//         sessions.set(
//           id,
//           value
//         );
//       }
//     );

//     console.log(
//       `[Design Engineer] Restored ${sessions.size} session(s) from sessions.json`
//     );
//   } catch (error) {
//     console.error(
//       '[Design Engineer] Failed to load sessions.json:',
//       error
//     );
//   }
// }

// loadSessions();

// function newId() {
//   return crypto
//     .randomBytes(16)
//     .toString('hex');
// }

// // -----------------------------------------------------------------------------
// // CREATE SESSION
// // -----------------------------------------------------------------------------

// app.post(
//   '/auth/session',
//   (req, res) => {
//     const sessionId =
//       newId();

//     sessions.set(
//       sessionId,
//       {
//         codexToken:
//           null,

//         codexUser:
//           null,

//         codexAuth:
//           null,

//         githubToken:
//           null,

//         githubUser:
//           null,

//         createdAt:
//           new Date().toISOString(),

//         lastUsedAt:
//           new Date().toISOString(),
//       }
//     );

//     persistSessions();

//     console.log(
//       `[Design Engineer] Created session ${sessionId}`
//     );

//     res.json({
//       sessionId,
//     });
//   }
// );

// // -----------------------------------------------------------------------------
// // SESSION STATUS
// // -----------------------------------------------------------------------------

// app.get(
//   '/auth/session/:id',
//   (req, res) => {
//     const session =
//       sessions.get(
//         req.params.id
//       );

//     if (!session) {
//       return res
//         .status(404)
//         .json({
//           error:
//             'Unknown session',
//         });
//     }

//     session.lastUsedAt =
//       new Date().toISOString();

//     persistSessions();

//     res.json({
//       codexConnected:
//         !!session.codexToken,

//       codexUser:
//         session.codexUser,

//       githubConnected:
//         !!session.githubToken,

//       githubUser:
//         session.githubUser,
//     });
//   }
// );

// // -----------------------------------------------------------------------------
// // CODEX DEVICE AUTH
// // -----------------------------------------------------------------------------

// const deviceSessions =
//   new Map();

// function randomUserCode() {
//   const chars =
//     'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

//   const part = () =>
//     Array.from(
//       {
//         length: 4,
//       },
//       () =>
//         chars[
//           Math.floor(
//             Math.random() *
//               chars.length
//           )
//         ]
//     ).join('');

//   return `${part()}-${part()}`;
// }

// function markCodexSessionConnected(
//   sessionId,
//   entry
// ) {
//   const session =
//     sessions.get(
//       sessionId
//     );

//   if (!session) {
//     return;
//   }

//   session.codexToken =
//     session.codexToken ||
//     `codex-cli:${entry.deviceCode}`;

//   session.codexUser =
//     entry.codexUser ||
//     session.codexUser ||
//     'Codex CLI user';

//   session.codexAuth = {
//     source:
//       'codex-cli-device-auth',

//     authenticatedAt:
//       new Date().toISOString(),

//     cliHome:
//       CODEX_HOME,

//     cliBinary:
//       CODEX_CLI_BIN,
//   };

//   session.lastUsedAt =
//     new Date().toISOString();

//   persistSessions();

//   console.log(
//     `[Design Engineer] Codex session persisted for ${sessionId}`
//   );
// }

// function getCodexLoginStatus() {
//   return new Promise(
//     (resolve) => {
//       const statusChild =
//         spawn(
//           process.execPath,
//           [
//             CODEX_CLI_BIN,
//             'login',
//             'status',
//           ],
//           {
//             cwd: __dirname,

//             env: {
//               ...process.env,

//               CODEX_HOME,

//               HOME:
//                 CODEX_HOME,
//             },

//             stdio: [
//               'ignore',
//               'pipe',
//               'pipe',
//             ],
//           }
//         );

//       let stdout = '';

//       let stderr = '';

//       statusChild.stdout.on(
//         'data',
//         (chunk) => {
//           stdout +=
//             chunk.toString();
//         }
//       );

//       statusChild.stderr.on(
//         'data',
//         (chunk) => {
//           stderr +=
//             chunk.toString();
//         }
//       );

//       statusChild.on(
//         'close',
//         () => {
//           const combined =
//             `${stdout}\n${stderr}`;

//           const loggedIn =
//             /logged in/i.test(
//               combined
//             ) ||
//             /authenticated/i.test(
//               combined
//             ) ||
//             /signed in/i.test(
//               combined
//             );

//           resolve(
//             loggedIn
//               ? 'connected'
//               : 'pending'
//           );
//         }
//       );

//       statusChild.on(
//         'error',
//         () =>
//           resolve(
//             'pending'
//           )
//       );
//     }
//   );
// }

// function waitForCodexDeviceAuth(
//   deviceCode,
//   sessionId
// ) {
//   return new Promise(
//     (resolve, reject) => {
//       const entry =
//         deviceSessions.get(
//           deviceCode
//         );

//       if (!entry) {
//         reject(
//           new Error(
//             'Session expired before Codex CLI auth started.'
//           )
//         );

//         return;
//       }

//       if (
//         !fs.existsSync(
//           CODEX_CLI_BIN
//         )
//       ) {
//         reject(
//           new Error(
//             'Codex CLI is not installed in this backend. Install @openai/codex or rebuild the Docker image.'
//           )
//         );

//         return;
//       }

//       const child =
//         spawn(
//           process.execPath,
//           [
//             CODEX_CLI_BIN,
//             'login',
//             '--device-auth',
//           ],
//           {
//             cwd: __dirname,

//             env: {
//               ...process.env,

//               CODEX_HOME,

//               HOME:
//                 CODEX_HOME,
//             },

//             stdio: [
//               'pipe',
//               'pipe',
//               'pipe',
//             ],
//           }
//         );

//       entry.process =
//         child;

//       let buffer = '';

//       let promptAccepted =
//         false;

//       const parseOutput =
//         (chunk) => {
//           buffer +=
//             chunk.toString();

//           const cleanBuffer =
//             buffer.replace(
//               /\u001b\[[0-9;]*m/g,
//               ''
//             );

//           const urlMatch =
//             cleanBuffer.match(
//               /https?:\/\/[^\s]+/g
//             );

//           const codeMatch =
//             cleanBuffer.match(
//               /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/
//             );

//           const authUrl =
//             urlMatch &&
//             urlMatch.find(
//               (value) =>
//                 value.includes(
//                   'auth.openai.com'
//                 )
//             );

//           if (
//             authUrl &&
//             codeMatch
//           ) {
//             entry.verificationUri =
//               authUrl.trim();

//             entry.verificationUriComplete =
//               authUrl.trim();

//             entry.userCode =
//               codeMatch[0].trim();

//             entry.status =
//               'pending';

//             resolve();
//           }

//           if (
//             !promptAccepted &&
//             cleanBuffer.includes(
//               'Continue only if you started this login in Codex'
//             )
//           ) {
//             child.stdin.write(
//               '\n'
//             );

//             promptAccepted =
//               true;
//           }
//         };

//       child.stdout.on(
//         'data',
//         parseOutput
//       );

//       child.stderr.on(
//         'data',
//         parseOutput
//       );

//       child.on(
//         'error',
//         (error) => {
//           entry.status =
//             'expired';

//           reject(error);
//         }
//       );

//       child.on(
//         'exit',
//         async (code) => {
//           if (
//             entry.status !==
//             'approved'
//           ) {
//             entry.status =
//               code === 0
//                 ? 'approved'
//                 : 'expired';
//           }

//           if (
//             entry.status ===
//             'approved'
//           ) {
//             const loginStatus =
//               await getCodexLoginStatus();

//             if (
//               loginStatus ===
//               'connected'
//             ) {
//               entry.codexUser =
//                 entry.codexUser ||
//                 'Codex CLI user';

//               markCodexSessionConnected(
//                 sessionId,
//                 entry
//               );
//             }
//           }
//         }
//       );
//     }
//   );
// }

// app.post(
//   '/auth/codex/device',
//   async (req, res) => {
//     const {
//       session,
//     } = req.body;

//     if (
//       !session ||
//       !sessions.has(
//         session
//       )
//     ) {
//       return res
//         .status(400)
//         .json({
//           error:
//             'Unknown session',
//         });
//     }

//     const deviceCode =
//       newId();

//     const entry = {
//       deviceCode,

//       sessionId:
//         session,

//       status:
//         'pending',

//       codexUser:
//         null,

//       process:
//         null,

//       verificationUri:
//         'https://auth.openai.com/codex/device',

//       verificationUriComplete:
//         'https://auth.openai.com/codex/device',

//       userCode:
//         null,
//     };

//     deviceSessions.set(
//       deviceCode,
//       entry
//     );

//     try {
//       await waitForCodexDeviceAuth(
//         deviceCode,
//         session
//       );

//       res.json({
//         device_code:
//           deviceCode,

//         user_code:
//           entry.userCode,

//         verification_uri:
//           entry.verificationUri,

//         verification_uri_complete:
//           entry.verificationUriComplete,

//         expires_in:
//           900,

//         interval:
//           3,
//       });
//     } catch (error) {
//       deviceSessions.delete(
//         deviceCode
//       );

//       res
//         .status(500)
//         .json({
//           error:
//             error.message ||
//             'Codex CLI authentication failed.',
//         });
//     }
//   }
// );

// app.get(
//   '/auth/codex/device/:deviceCode/status',
//   async (req, res) => {
//     const entry =
//       deviceSessions.get(
//         req.params.deviceCode
//       );

//     if (!entry) {
//       return res
//         .status(404)
//         .json({
//           status:
//             'expired',
//         });
//     }

//     if (
//       entry.status ===
//       'pending'
//     ) {
//       const loginStatus =
//         await getCodexLoginStatus();

//       if (
//         loginStatus ===
//         'connected'
//       ) {
//         entry.status =
//           'approved';

//         markCodexSessionConnected(
//           entry.sessionId,
//           entry
//         );
//       }
//     }

//     const session =
//       sessions.get(
//         entry.sessionId
//       );

//     res.json({
//       status:
//         entry.status,

//       codexUser:
//         session?.codexUser ||
//         entry.codexUser ||
//         null,
//     });
//   }
// );

// // -----------------------------------------------------------------------------
// // GITHUB OAUTH
// // -----------------------------------------------------------------------------

// app.get(
//   '/auth/github',
//   (req, res) => {
//     const {
//       session,
//     } = req.query;

//     if (
//       !session ||
//       !sessions.has(
//         session
//       )
//     ) {
//       return res
//         .status(400)
//         .send(
//           'Unknown session. Close this tab, reopen the plugin, and try again.'
//         );
//     }

//     if (
//       !GITHUB_CLIENT_ID
//     ) {
//       return res
//         .status(500)
//         .send(
//           'GITHUB_CLIENT_ID is not configured on the backend.'
//         );
//     }

//     const redirectUri =
//       `${BACKEND_URL}/auth/github/callback`;

//     const url =
//       `https://github.com/login/oauth/authorize` +
//       `?client_id=${GITHUB_CLIENT_ID}` +
//       `&scope=${encodeURIComponent(
//         'repo read:user'
//       )}` +
//       `&state=${session}` +
//       `&redirect_uri=${encodeURIComponent(
//         redirectUri
//       )}`;

//     res.redirect(url);
//   }
// );

// app.get(
//   '/auth/github/callback',
//   async (req, res) => {
//     const {
//       code,
//       state,
//     } = req.query;

//     const session =
//       sessions.get(
//         state
//       );

//     if (!session) {
//       return res
//         .status(400)
//         .send(
//           'Session expired. Close this tab and try again from the plugin.'
//         );
//     }

//     try {
//       const tokenRes =
//         await fetch(
//           'https://github.com/login/oauth/access_token',
//           {
//             method:
//               'POST',

//             headers: {
//               'Content-Type':
//                 'application/json',

//               Accept:
//                 'application/json',
//             },

//             body:
//               JSON.stringify({
//                 client_id:
//                   GITHUB_CLIENT_ID,

//                 client_secret:
//                   GITHUB_CLIENT_SECRET,

//                 code,

//                 redirect_uri:
//                   `${BACKEND_URL}/auth/github/callback`,
//               }),
//           }
//         );

//       const tokenData =
//         await tokenRes.json();

//       if (
//         !tokenData.access_token
//       ) {
//         throw new Error(
//           tokenData.error_description ||
//             'No access token returned by GitHub'
//         );
//       }

//       const userRes =
//         await fetch(
//           'https://api.github.com/user',
//           {
//             headers: {
//               Authorization:
//                 `Bearer ${tokenData.access_token}`,
//             },
//           }
//         );

//       const userData =
//         await userRes.json();

//       session.githubToken =
//         tokenData.access_token;

//       session.githubUser =
//         userData.login;

//       session.lastUsedAt =
//         new Date().toISOString();

//       persistSessions();

//       res.send(`
//         <html>
//           <body style="font-family:sans-serif;padding:40px">
//             <h2>GitHub connected ✅</h2>
//             <p>
//               Signed in as
//               <strong>${userData.login}</strong>.
//               You can close this tab and return to Figma.
//             </p>
//           </body>
//         </html>
//       `);
//     } catch (e) {
//       res
//         .status(500)
//         .send(
//           `GitHub auth failed: ${e.message}`
//         );
//     }
//   }
// );

// // -----------------------------------------------------------------------------
// // GITHUB SESSION VALIDATION
// // -----------------------------------------------------------------------------

// function requireGithubSession(
//   req,
//   res
// ) {
//   const sessionId =
//     req.query.session ||
//     req.body.session;

//   const session =
//     sessions.get(
//       sessionId
//     );

//   if (
//     !session ||
//     !session.githubToken
//   ) {
//     res
//       .status(401)
//       .json({
//         error:
//           'Not authenticated with GitHub for this session',
//       });

//     return null;
//   }

//   session.lastUsedAt =
//     new Date().toISOString();

//   persistSessions();

//   return session;
// }

// // -----------------------------------------------------------------------------
// // REPOSITORIES
// // -----------------------------------------------------------------------------

// app.get(
//   '/api/repos',
//   async (req, res) => {
//     const session =
//       requireGithubSession(
//         req,
//         res
//       );

//     if (!session) {
//       return;
//     }

//     try {
//       const r =
//         await fetch(
//           'https://api.github.com/user/repos?per_page=100&sort=updated',
//           {
//             headers: {
//               Authorization:
//                 `Bearer ${session.githubToken}`,
//             },
//           }
//         );

//       const data =
//         await r.json();

//       if (
//         !Array.isArray(data)
//       ) {
//         return res
//           .status(502)
//           .json({
//             error:
//               'Unexpected GitHub response',

//             detail:
//               data,
//           });
//       }

//       res.json({
//         repos:
//           data.map(
//             (repo) => ({
//               fullName:
//                 repo.full_name,

//               private:
//                 repo.private,
//             })
//           ),
//       });
//     } catch (error) {
//       res
//         .status(500)
//         .json({
//           error:
//             error.message,
//         });
//     }
//   }
// );

// // -----------------------------------------------------------------------------
// // BRANCHES
// // -----------------------------------------------------------------------------

// app.get(
//   '/api/repos/:owner/:repo/branches',
//   async (req, res) => {
//     const session =
//       requireGithubSession(
//         req,
//         res
//       );

//     if (!session) {
//       return;
//     }

//     try {
//       const {
//         owner,
//         repo,
//       } = req.params;

//       const r =
//         await fetch(
//           `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
//           {
//             headers: {
//               Authorization:
//                 `Bearer ${session.githubToken}`,
//             },
//           }
//         );

//       const data =
//         await r.json();

//       if (
//         !Array.isArray(data)
//       ) {
//         return res
//           .status(502)
//           .json({
//             error:
//               'Unexpected GitHub response',

//             detail:
//               data,
//           });
//       }

//       res.json({
//         branches:
//           data.map(
//             (branch) => ({
//               name:
//                 branch.name,
//             })
//           ),
//       });
//     } catch (error) {
//       res
//         .status(500)
//         .json({
//           error:
//             error.message,
//         });
//     }
//   }
// );

// // -----------------------------------------------------------------------------
// // SAVE DESIGN CONTEXT
// // -----------------------------------------------------------------------------
// //
// // NEW BEHAVIOR:
// //
// // If the user fetches:
// //
// //   Frame 1
// //   Frame 2
// //   Frame 3
// //
// // backend creates:
// //
// //   design-context_Frame_1.json
// //   design-context_Frame_2.json
// //   design-context_Frame_3.json
// //
// // If Frame 1 is fetched again:
// //
// //   design-context_Frame_1.json
// //
// // is overwritten.
// //
// // No screenshots are stored.
// // -----------------------------------------------------------------------------

// function sanitizeFileName(
//   value
// ) {
//   return String(
//     value || 'screen'
//   )
//     .trim()
//     .replace(
//       /[<>:"/\\|?*\x00-\x1F]/g,
//       '_'
//     )
//     .replace(
//       /\s+/g,
//       '_'
//     )
//     .replace(
//       /_+/g,
//       '_'
//     )
//     .replace(
//       /^\.+/,
//       ''
//     )
//     .slice(
//       0,
//       150
//     ) || 'screen';
// }

// app.post(
//   '/api/screens/fetch',
//   async (req, res) => {
//     const session =
//       requireGithubSession(
//         req,
//         res
//       );

//     if (!session) {
//       return;
//     }

//     const {
//       repo,
//       branch,
//       screens,
//     } = req.body;

//     if (
//       !repo ||
//       !branch ||
//       !Array.isArray(
//         screens
//       )
//     ) {
//       return res
//         .status(400)
//         .json({
//           error:
//             'repo, branch and screens[] are required',
//         });
//     }

//     if (
//       screens.length === 0
//     ) {
//       return res
//         .status(400)
//         .json({
//           error:
//             'At least one screen is required',
//         });
//     }

//     try {
//       // -------------------------------------------------------------------
//       // SAFE DIRECTORY NAMES
//       // -------------------------------------------------------------------

//       const safeUser =
//         sanitizeFileName(
//           session.githubUser
//         );

//       const safeRepo =
//         sanitizeFileName(
//           repo
//         );

//       const safeBranch =
//         sanitizeFileName(
//           branch
//         );

//       // -------------------------------------------------------------------
//       // DIRECTORY
//       // -------------------------------------------------------------------

//       const dir =
//         path.join(
//           __dirname,
//           'data',
//           safeUser,
//           safeRepo,
//           safeBranch
//         );

//       await fs.promises.mkdir(
//         dir,
//         {
//           recursive:
//             true,
//         }
//       );

//       const savedFiles =
//         [];

//       // -------------------------------------------------------------------
//       // SAVE EACH SCREEN SEPARATELY
//       // -------------------------------------------------------------------

//       for (
//         let index = 0;
//         index <
//         screens.length;
//         index++
//       ) {
//         const screen =
//           screens[index];

//         if (
//           !screen ||
//           typeof screen !==
//             'object'
//         ) {
//           continue;
//         }

//         // ---------------------------------------------------------------
//         // SCREEN NAME
//         // ---------------------------------------------------------------

//         const screenName =
//           screen.screen ||
//           screen.name ||
//           `frame-${index + 1}`;

//         const safeScreenName =
//           sanitizeFileName(
//             screenName
//           );

//         // ---------------------------------------------------------------
//         // FILE NAME
//         // ---------------------------------------------------------------

//         const fileName =
//           `design-context_${safeScreenName}.json`;

//         const filePath =
//           path.join(
//             dir,
//             fileName
//           );

//         // ---------------------------------------------------------------
//         // REMOVE OLD SCREENSHOT FIELD
//         // ---------------------------------------------------------------

//         const {
//           screenshotBase64:
//             _screenshotBase64,

//           ...designContext
//         } = screen;

//         // ---------------------------------------------------------------
//         // ADD BACKEND METADATA
//         // ---------------------------------------------------------------

//         const payload = {
//           contextVersion:
//             '2.0',

//           savedAt:
//             new Date().toISOString(),

//           githubUser:
//             session.githubUser,

//           repository:
//             repo,

//           branch,

//           screen:
//             designContext,
//         };

//         // ---------------------------------------------------------------
//         // WRITE / OVERWRITE FILE
//         // ---------------------------------------------------------------

//         console.log(
//           '[Design Engineer] Saving screen:',
//           screenName
//         );

//         console.log(
//           '[Design Engineer] File:',
//           filePath
//         );

//         await fs.promises.writeFile(
//           filePath,

//           JSON.stringify(
//             payload,
//             null,
//             2
//           ),

//           'utf8'
//         );

//         savedFiles.push(
//           path.relative(
//             __dirname,
//             filePath
//           )
//         );

//         console.log(
//           `[Design Engineer] Saved ${fileName}`
//         );
//       }

//       // -------------------------------------------------------------------
//       // RESPONSE
//       // -------------------------------------------------------------------

//       console.log(
//         `[Design Engineer] Saved ${savedFiles.length}/${screens.length} screen JSON file(s).`
//       );

//       res.json({
//         success:
//           true,

//         saved:
//           savedFiles,

//         screenCount:
//           savedFiles.length,
//       });
//     } catch (error) {
//       console.error(
//         '[Design Engineer] Failed to save Design Context:',
//         error
//       );

//       res
//         .status(500)
//         .json({
//           error:
//             error.message ||
//             'Failed to save Design Context',
//         });
//     }
//   }
// );

// // -----------------------------------------------------------------------------
// // START SERVER
// // -----------------------------------------------------------------------------

// app.listen(
//   PORT,
//   () => {
//     console.log(
//       `Design Engineer backend listening on ${BACKEND_URL}`
//     );

//     console.log(
//       `[Design Engineer] Session storage: ${SESSIONS_FILE}`
//     );

//     console.log(
//       `[Design Engineer] Codex home: ${CODEX_HOME}`
//     );
//   }
// );


// server.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: '25mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

const PORT =
  process.env.PORT || 4000;

const GITHUB_CLIENT_ID =
  process.env.GITHUB_CLIENT_ID;

const GITHUB_CLIENT_SECRET =
  process.env.GITHUB_CLIENT_SECRET;

const BACKEND_URL =
  process.env.BACKEND_URL ||
  `http://localhost:${PORT}`;

// -----------------------------------------------------------------------------
// SESSION STORE
// -----------------------------------------------------------------------------

const sessions =
  new Map();

const SESSIONS_FILE =
  path.join(
    __dirname,
    'data',
    'sessions.json'
  );

/**
 * Persistent Codex authentication directory.
 *
 * IMPORTANT:
 * Do not delete this directory.
 *
 * Codex CLI stores its authentication here.
 */
const CODEX_HOME =
  path.join(
    __dirname,
    '.codex'
  );

const CODEX_CLI_BIN =
  path.join(
    __dirname,
    'node_modules',
    '@openai',
    'codex',
    'bin',
    'codex.js'
  );

fs.mkdirSync(
  CODEX_HOME,
  {
    recursive: true,
  }
);

// -----------------------------------------------------------------------------
// SESSION PERSISTENCE
// -----------------------------------------------------------------------------

function persistSessions() {
  fs.mkdirSync(
    path.dirname(
      SESSIONS_FILE
    ),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    SESSIONS_FILE,
    JSON.stringify(
      Object.fromEntries(
        sessions
      ),
      null,
      2
    ),
    'utf8'
  );
}

function loadSessions() {
  if (
    !fs.existsSync(
      SESSIONS_FILE
    )
  ) {
    return;
  }

  try {
    const obj =
      JSON.parse(
        fs.readFileSync(
          SESSIONS_FILE,
          'utf8'
        )
      );

    Object.entries(
      obj
    ).forEach(
      ([id, value]) => {
        sessions.set(
          id,
          value
        );
      }
    );

    console.log(
      `[Design Engineer] Restored ${sessions.size} session(s) from sessions.json`
    );
  } catch (error) {
    console.error(
      '[Design Engineer] Failed to load sessions.json:',
      error
    );
  }
}

loadSessions();

function newId() {
  return crypto
    .randomBytes(16)
    .toString('hex');
}

// -----------------------------------------------------------------------------
// CREATE SESSION
// -----------------------------------------------------------------------------

app.post(
  '/auth/session',
  (req, res) => {
    const sessionId =
      newId();

    sessions.set(
      sessionId,
      {
        codexToken:
          null,

        codexUser:
          null,

        codexAuth:
          null,

        githubToken:
          null,

        githubUser:
          null,

        createdAt:
          new Date().toISOString(),

        lastUsedAt:
          new Date().toISOString(),
      }
    );

    persistSessions();

    console.log(
      `[Design Engineer] Created session ${sessionId}`
    );

    res.json({
      sessionId,
    });
  }
);

// -----------------------------------------------------------------------------
// SESSION STATUS
// -----------------------------------------------------------------------------

app.get(
  '/auth/session/:id',
  (req, res) => {
    const session =
      sessions.get(
        req.params.id
      );

    if (!session) {
      return res
        .status(404)
        .json({
          error:
            'Unknown session',
        });
    }

    session.lastUsedAt =
      new Date().toISOString();

    persistSessions();

    res.json({
      codexConnected:
        !!session.codexToken,

      codexUser:
        session.codexUser,

      githubConnected:
        !!session.githubToken,

      githubUser:
        session.githubUser,
    });
  }
);

// -----------------------------------------------------------------------------
// CODEX DEVICE AUTH
// -----------------------------------------------------------------------------

const deviceSessions =
  new Map();

function randomUserCode() {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const part = () =>
    Array.from(
      {
        length: 4,
      },
      () =>
        chars[
          Math.floor(
            Math.random() *
              chars.length
          )
        ]
    ).join('');

  return `${part()}-${part()}`;
}

// -----------------------------------------------------------------------------
// MARK CODEX SESSION CONNECTED
// -----------------------------------------------------------------------------

function markCodexSessionConnected(
  sessionId,
  entry
) {
  const session =
    sessions.get(
      sessionId
    );

  if (!session) {
    return;
  }

  session.codexToken =
    session.codexToken ||
    `codex-cli:${entry.deviceCode}`;

  session.codexUser =
    entry.codexUser ||
    session.codexUser ||
    'Codex CLI user';

  session.codexAuth = {
    source:
      'codex-cli-device-auth',

    authenticatedAt:
      session.codexAuth
        ?.authenticatedAt ||
      new Date().toISOString(),

    cliHome:
      CODEX_HOME,

    cliBinary:
      CODEX_CLI_BIN,
  };

  session.lastUsedAt =
    new Date().toISOString();

  persistSessions();

  console.log(
    `[Design Engineer] Codex session persisted for ${sessionId}`
  );
}

// -----------------------------------------------------------------------------
// CHECK CODEX LOGIN STATUS
// -----------------------------------------------------------------------------

/**
 * Runs:
 *
 *   codex login status
 *
 * using the persistent CODEX_HOME.
 *
 * This is the key function that allows the plugin
 * to remember the Codex login.
 */
function getCodexLoginStatus() {
  return new Promise(
    (resolve) => {
      if (
        !fs.existsSync(
          CODEX_CLI_BIN
        )
      ) {
        console.error(
          '[Design Engineer] Codex CLI not found:',
          CODEX_CLI_BIN
        );

        resolve(
          'pending'
        );

        return;
      }

      const statusChild =
        spawn(
          process.execPath,
          [
            CODEX_CLI_BIN,
            'login',
            'status',
          ],
          {
            cwd:
              __dirname,

            env: {
              ...process.env,

              CODEX_HOME,

              HOME:
                CODEX_HOME,
            },

            stdio: [
              'ignore',
              'pipe',
              'pipe',
            ],
          }
        );

      let stdout = '';

      let stderr = '';

      statusChild.stdout.on(
        'data',
        (chunk) => {
          stdout +=
            chunk.toString();
        }
      );

      statusChild.stderr.on(
        'data',
        (chunk) => {
          stderr +=
            chunk.toString();
        }
      );

      statusChild.on(
        'close',
        (code) => {
          const combined =
            `${stdout}\n${stderr}`;

          console.log(
            '[Design Engineer] Codex login status:',
            combined.trim()
          );

          const loggedIn =
            code === 0 &&
            (
              /logged in/i.test(
                combined
              ) ||
              /authenticated/i.test(
                combined
              ) ||
              /signed in/i.test(
                combined
              )
            ) &&
            !/not logged in/i.test(
              combined
            );

          resolve(
            loggedIn
              ? 'connected'
              : 'pending'
          );
        }
      );

      statusChild.on(
        'error',
        (error) => {
          console.error(
            '[Design Engineer] Codex status process error:',
            error
          );

          resolve(
            'pending'
          );
        }
      );
    }
  );
}

// -----------------------------------------------------------------------------
// NEW: PERSISTENT CODEX STATUS ENDPOINT
// -----------------------------------------------------------------------------
//
// Figma calls this when the plugin opens.
//
// If Codex is already authenticated in CODEX_HOME,
// the plugin skips the device-code login.
//
// -----------------------------------------------------------------------------

app.get(
  '/auth/codex/status',
  async (req, res) => {
    const sessionId =
      req.query.session;

    if (!sessionId) {
      return res
        .status(400)
        .json({
          error:
            'session is required',
        });
    }

    const session =
      sessions.get(
        sessionId
      );

    if (!session) {
      return res
        .status(404)
        .json({
          error:
            'Unknown session',
        });
    }

    try {
      const loginStatus =
        await getCodexLoginStatus();

      if (
        loginStatus ===
        'connected'
      ) {
        session.codexToken =
          session.codexToken ||
          'codex-cli-authenticated';

        session.codexUser =
          session.codexUser ||
          'Codex CLI user';

        session.codexAuth =
          session.codexAuth ||
          {
            source:
              'codex-cli-device-auth',

            authenticatedAt:
              new Date().toISOString(),

            cliHome:
              CODEX_HOME,

            cliBinary:
              CODEX_CLI_BIN,
          };

        session.lastUsedAt =
          new Date().toISOString();

        persistSessions();

        console.log(
          `[Design Engineer] Existing Codex login restored for session ${sessionId}`
        );

        return res.json({
          connected:
            true,

          codexUser:
            session.codexUser,
        });
      }

      return res.json({
        connected:
          false,

        codexUser:
          null,
      });
    } catch (error) {
      console.error(
        '[Design Engineer] Codex status check failed:',
        error
      );

      return res.json({
        connected:
          false,

        codexUser:
          null,
      });
    }
  }
);

// -----------------------------------------------------------------------------
// WAIT FOR CODEX DEVICE AUTH
// -----------------------------------------------------------------------------

function waitForCodexDeviceAuth(
  deviceCode,
  sessionId
) {
  return new Promise(
    (resolve, reject) => {
      const entry =
        deviceSessions.get(
          deviceCode
        );

      if (!entry) {
        reject(
          new Error(
            'Session expired before Codex CLI auth started.'
          )
        );

        return;
      }

      if (
        !fs.existsSync(
          CODEX_CLI_BIN
        )
      ) {
        reject(
          new Error(
            'Codex CLI is not installed in this backend. Install @openai/codex or rebuild the Docker image.'
          )
        );

        return;
      }

      const child =
        spawn(
          process.execPath,
          [
            CODEX_CLI_BIN,
            'login',
            '--device-auth',
          ],
          {
            cwd:
              __dirname,

            env: {
              ...process.env,

              CODEX_HOME,

              HOME:
                CODEX_HOME,
            },

            stdio: [
              'pipe',
              'pipe',
              'pipe',
            ],
          }
        );

      entry.process =
        child;

      let buffer = '';

      let promptAccepted =
        false;

      const parseOutput =
        (chunk) => {
          buffer +=
            chunk.toString();

          const cleanBuffer =
            buffer.replace(
              /\u001b\[[0-9;]*m/g,
              ''
            );

          console.log(
            '[Design Engineer] Codex auth output:',
            cleanBuffer
          );

          const urlMatch =
            cleanBuffer.match(
              /https?:\/\/[^\s]+/g
            );

          const codeMatch =
            cleanBuffer.match(
              /\b[A-Z0-9]{4}-[A-Z0-9]{5}\b/
            );

          const authUrl =
            urlMatch &&
            urlMatch.find(
              (value) =>
                value.includes(
                  'auth.openai.com'
                )
            );

          if (
            authUrl &&
            codeMatch
          ) {
            entry.verificationUri =
              authUrl.trim();

            entry.verificationUriComplete =
              authUrl.trim();

            entry.userCode =
              codeMatch[0].trim();

            entry.status =
              'pending';

            resolve();
          }

          if (
            !promptAccepted &&
            cleanBuffer.includes(
              'Continue only if you started this login in Codex'
            )
          ) {
            child.stdin.write(
              '\n'
            );

            promptAccepted =
              true;
          }
        };

      child.stdout.on(
        'data',
        parseOutput
      );

      child.stderr.on(
        'data',
        parseOutput
      );

      child.on(
        'error',
        (error) => {
          entry.status =
            'expired';

          reject(error);
        }
      );

      child.on(
        'exit',
        async (code) => {
          if (
            entry.status !==
            'approved'
          ) {
            entry.status =
              code === 0
                ? 'approved'
                : 'expired';
          }

          if (
            entry.status ===
            'approved'
          ) {
            const loginStatus =
              await getCodexLoginStatus();

            if (
              loginStatus ===
              'connected'
            ) {
              entry.codexUser =
                entry.codexUser ||
                'Codex CLI user';

              markCodexSessionConnected(
                sessionId,
                entry
              );
            }
          }
        }
      );
    }
  );
}

// -----------------------------------------------------------------------------
// START CODEX DEVICE AUTH
// -----------------------------------------------------------------------------

app.post(
  '/auth/codex/device',
  async (req, res) => {
    const {
      session,
    } = req.body;

    if (
      !session ||
      !sessions.has(
        session
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            'Unknown session',
        });
    }

    // -------------------------------------------------------------------------
    // IMPORTANT:
    //
    // BEFORE creating a new device login, check whether Codex is already
    // authenticated.
    // -------------------------------------------------------------------------

    const existingLogin =
      await getCodexLoginStatus();

    if (
      existingLogin ===
      'connected'
    ) {
      const existingSession =
        sessions.get(
          session
        );

      existingSession.codexToken =
        existingSession.codexToken ||
        'codex-cli-authenticated';

      existingSession.codexUser =
        existingSession.codexUser ||
        'Codex CLI user';

      existingSession.codexAuth =
        existingSession.codexAuth ||
        {
          source:
            'codex-cli-device-auth',

          authenticatedAt:
            new Date().toISOString(),

          cliHome:
            CODEX_HOME,

          cliBinary:
            CODEX_CLI_BIN,
        };

      existingSession.lastUsedAt =
        new Date().toISOString();

      persistSessions();

      console.log(
        `[Design Engineer] Codex already authenticated for session ${session}`
      );

      // Return a successful response.
      //
      // This protects the existing frontend even if it accidentally calls
      // /auth/codex/device after Codex is already authenticated.

      return res.json({
        device_code:
          '',

        user_code:
          '',

        verification_uri:
          '',

        verification_uri_complete:
          '',

        expires_in:
          0,

        interval:
          3,

        alreadyAuthenticated:
          true,

        codexUser:
          existingSession.codexUser,
      });
    }

    // -------------------------------------------------------------------------
    // NORMAL FIRST-TIME DEVICE LOGIN
    // -------------------------------------------------------------------------

    const deviceCode =
      newId();

    const entry = {
      deviceCode,

      sessionId:
        session,

      status:
        'pending',

      codexUser:
        null,

      process:
        null,

      verificationUri:
        'https://auth.openai.com/codex/device',

      verificationUriComplete:
        'https://auth.openai.com/codex/device',

      userCode:
        null,
    };

    deviceSessions.set(
      deviceCode,
      entry
    );

    try {
      await waitForCodexDeviceAuth(
        deviceCode,
        session
      );

      res.json({
        device_code:
          deviceCode,

        user_code:
          entry.userCode,

        verification_uri:
          entry.verificationUri,

        verification_uri_complete:
          entry.verificationUriComplete,

        expires_in:
          900,

        interval:
          3,
      });
    } catch (error) {
      deviceSessions.delete(
        deviceCode
      );

      res
        .status(500)
        .json({
          error:
            error.message ||
            'Codex CLI authentication failed.',
        });
    }
  }
);

// -----------------------------------------------------------------------------
// CODEX DEVICE STATUS
// -----------------------------------------------------------------------------

app.get(
  '/auth/codex/device/:deviceCode/status',
  async (req, res) => {
    const entry =
      deviceSessions.get(
        req.params.deviceCode
      );

    if (!entry) {
      return res
        .status(404)
        .json({
          status:
            'expired',

          codexUser:
            null,
        });
    }

    // -------------------------------------------------------------------------
    // IF STILL PENDING, CHECK ACTUAL CODEX CLI LOGIN
    // -------------------------------------------------------------------------

    if (
      entry.status ===
      'pending'
    ) {
      const loginStatus =
        await getCodexLoginStatus();

      if (
        loginStatus ===
        'connected'
      ) {
        entry.status =
          'approved';

        entry.codexUser =
          entry.codexUser ||
          'Codex CLI user';

        markCodexSessionConnected(
          entry.sessionId,
          entry
        );
      }
    }

    const session =
      sessions.get(
        entry.sessionId
      );

    res.json({
      status:
        entry.status,

      codexUser:
        session?.codexUser ||
        entry.codexUser ||
        null,
    });
  }
);

// -----------------------------------------------------------------------------
// GITHUB OAUTH
// -----------------------------------------------------------------------------

app.get(
  '/auth/github',
  (req, res) => {
    const {
      session,
    } = req.query;

    if (
      !session ||
      !sessions.has(
        session
      )
    ) {
      return res
        .status(400)
        .send(
          'Unknown session. Close this tab, reopen the plugin, and try again.'
        );
    }

    if (
      !GITHUB_CLIENT_ID
    ) {
      return res
        .status(500)
        .send(
          'GITHUB_CLIENT_ID is not configured on the backend.'
        );
    }

    const redirectUri =
      `${BACKEND_URL}/auth/github/callback`;

    const url =
      `https://github.com/login/oauth/authorize` +
      `?client_id=${GITHUB_CLIENT_ID}` +
      `&scope=${encodeURIComponent(
        'repo read:user'
      )}` +
      `&state=${encodeURIComponent(
        session
      )}` +
      `&redirect_uri=${encodeURIComponent(
        redirectUri
      )}`;

    res.redirect(
      url
    );
  }
);

// -----------------------------------------------------------------------------
// GITHUB CALLBACK
// -----------------------------------------------------------------------------

app.get(
  '/auth/github/callback',
  async (req, res) => {
    const {
      code,
      state,
    } = req.query;

    const session =
      sessions.get(
        state
      );

    if (!session) {
      return res
        .status(400)
        .send(
          'Session expired. Close this tab and try again from the plugin.'
        );
    }

    try {
      const tokenRes =
        await fetch(
          'https://github.com/login/oauth/access_token',
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json',

              Accept:
                'application/json',
            },

            body:
              JSON.stringify({
                client_id:
                  GITHUB_CLIENT_ID,

                client_secret:
                  GITHUB_CLIENT_SECRET,

                code,

                redirect_uri:
                  `${BACKEND_URL}/auth/github/callback`,
              }),
          }
        );

      const tokenData =
        await tokenRes.json();

      if (
        !tokenData.access_token
      ) {
        throw new Error(
          tokenData.error_description ||
            'No access token returned by GitHub'
        );
      }

      const userRes =
        await fetch(
          'https://api.github.com/user',
          {
            headers: {
              Authorization:
                `Bearer ${tokenData.access_token}`,
            },
          }
        );

      const userData =
        await userRes.json();

      session.githubToken =
        tokenData.access_token;

      session.githubUser =
        userData.login;

      session.lastUsedAt =
        new Date().toISOString();

      persistSessions();

      res.send(`
        <html>
          <body style="font-family:sans-serif;padding:40px">
            <h2>GitHub connected ✅</h2>

            <p>
              Signed in as
              <strong>${userData.login}</strong>.
              You can close this tab and return to Figma.
            </p>
          </body>
        </html>
      `);
    } catch (e) {
      console.error(
        '[Design Engineer] GitHub authentication failed:',
        e
      );

      res
        .status(500)
        .send(
          `GitHub auth failed: ${e.message}`
        );
    }
  }
);

// -----------------------------------------------------------------------------
// GITHUB SESSION VALIDATION
// -----------------------------------------------------------------------------

function requireGithubSession(
  req,
  res
) {
  const sessionId =
    req.query.session ||
    req.body.session;

  const session =
    sessions.get(
      sessionId
    );

  if (
    !session ||
    !session.githubToken
  ) {
    res
      .status(401)
      .json({
        error:
          'Not authenticated with GitHub for this session',
      });

    return null;
  }

  session.lastUsedAt =
    new Date().toISOString();

  persistSessions();

  return session;
}

// -----------------------------------------------------------------------------
// REPOSITORIES
// -----------------------------------------------------------------------------

app.get(
  '/api/repos',
  async (req, res) => {
    const session =
      requireGithubSession(
        req,
        res
      );

    if (!session) {
      return;
    }

    try {
      const r =
        await fetch(
          'https://api.github.com/user/repos?per_page=100&sort=updated',
          {
            headers: {
              Authorization:
                `Bearer ${session.githubToken}`,
            },
          }
        );

      const data =
        await r.json();

      if (
        !Array.isArray(data)
      ) {
        return res
          .status(502)
          .json({
            error:
              'Unexpected GitHub response',

            detail:
              data,
          });
      }

      res.json({
        repos:
          data.map(
            (repo) => ({
              fullName:
                repo.full_name,

              private:
                repo.private,
            })
          ),
      });
    } catch (error) {
      console.error(
        '[Design Engineer] Failed to load repositories:',
        error
      );

      res
        .status(500)
        .json({
          error:
            error.message,
        });
    }
  }
);

// -----------------------------------------------------------------------------
// BRANCHES
// -----------------------------------------------------------------------------

app.get(
  '/api/repos/:owner/:repo/branches',
  async (req, res) => {
    const session =
      requireGithubSession(
        req,
        res
      );

    if (!session) {
      return;
    }

    try {
      const {
        owner,
        repo,
      } = req.params;

      const r =
        await fetch(
          `https://api.github.com/repos/${encodeURIComponent(
            owner
          )}/${encodeURIComponent(
            repo
          )}/branches?per_page=100`,
          {
            headers: {
              Authorization:
                `Bearer ${session.githubToken}`,
            },
          }
        );

      const data =
        await r.json();

      if (
        !Array.isArray(data)
      ) {
        return res
          .status(502)
          .json({
            error:
              'Unexpected GitHub response',

            detail:
              data,
          });
      }

      res.json({
        branches:
          data.map(
            (branch) => ({
              name:
                branch.name,
            })
          ),
      });
    } catch (error) {
      console.error(
        '[Design Engineer] Failed to load branches:',
        error
      );

      res
        .status(500)
        .json({
          error:
            error.message,
        });
    }
  }
);

// -----------------------------------------------------------------------------
// SANITIZE FILE NAME
// -----------------------------------------------------------------------------

function sanitizeFileName(
  value
) {
  return String(
    value || 'screen'
  )
    .trim()
    .replace(
      /[<>:"/\\|?*\x00-\x1F]/g,
      '_'
    )
    .replace(
      /\s+/g,
      '_'
    )
    .replace(
      /_+/g,
      '_'
    )
    .replace(
      /^\.+/,
      ''
    )
    .slice(
      0,
      150
    ) || 'screen';
}

// -----------------------------------------------------------------------------
// SAVE DESIGN CONTEXT
// -----------------------------------------------------------------------------

app.post(
  '/api/screens/fetch',
  async (req, res) => {
    const session =
      requireGithubSession(
        req,
        res
      );

    if (!session) {
      return;
    }

    const {
      repo,
      branch,
      screens,
    } = req.body;

    if (
      !repo ||
      !branch ||
      !Array.isArray(
        screens
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            'repo, branch and screens[] are required',
        });
    }

    if (
      screens.length === 0
    ) {
      return res
        .status(400)
        .json({
          error:
            'At least one screen is required',
        });
    }

    try {
      const safeUser =
        sanitizeFileName(
          session.githubUser
        );

      const safeRepo =
        sanitizeFileName(
          repo
        );

      const safeBranch =
        sanitizeFileName(
          branch
        );

      const dir =
        path.join(
          __dirname,
          'data',
          safeUser,
          safeRepo,
          safeBranch
        );

      await fs.promises.mkdir(
        dir,
        {
          recursive:
            true,
        }
      );

      const savedFiles =
        [];

      for (
        let index = 0;
        index <
        screens.length;
        index++
      ) {
        const screen =
          screens[index];

        if (
          !screen ||
          typeof screen !==
            'object'
        ) {
          continue;
        }

        const screenName =
          screen.screen ||
          screen.name ||
          `frame-${index + 1}`;

        const safeScreenName =
          sanitizeFileName(
            screenName
          );

        const fileName =
          `design-context_${safeScreenName}.json`;

        const filePath =
          path.join(
            dir,
            fileName
          );

        // Do not store screenshots if one is accidentally supplied.
        const {
          screenshotBase64:
            _screenshotBase64,

          ...designContext
        } = screen;

        const payload = {
          contextVersion:
            '2.0',

          savedAt:
            new Date().toISOString(),

          githubUser:
            session.githubUser,

          repository:
            repo,

          branch,

          screen:
            designContext,
        };

        console.log(
          '[Design Engineer] Saving screen:',
          screenName
        );

        console.log(
          '[Design Engineer] File:',
          filePath
        );

        // This automatically OVERWRITES the same file
        // when the same screen is fetched again.
        await fs.promises.writeFile(
          filePath,

          JSON.stringify(
            payload,
            null,
            2
          ),

          'utf8'
        );

        savedFiles.push(
          path.relative(
            __dirname,
            filePath
          )
        );

        console.log(
          `[Design Engineer] Saved ${fileName}`
        );
      }

      console.log(
        `[Design Engineer] Saved ${savedFiles.length}/${screens.length} screen JSON file(s).`
      );

      res.json({
        success:
          true,

        saved:
          savedFiles,

        screenCount:
          savedFiles.length,
      });
    } catch (error) {
      console.error(
        '[Design Engineer] Failed to save Design Context:',
        error
      );

      res
        .status(500)
        .json({
          error:
            error.message ||
            'Failed to save Design Context',
        });
    }
  }
);

// -----------------------------------------------------------------------------
// START SERVER
// -----------------------------------------------------------------------------

app.listen(
  PORT,
  () => {
    console.log(
      `Design Engineer backend listening on ${BACKEND_URL}`
    );

    console.log(
      `[Design Engineer] Session storage: ${SESSIONS_FILE}`
    );

    console.log(
      `[Design Engineer] Codex home: ${CODEX_HOME}`
    );

    console.log(
      `[Design Engineer] Codex CLI: ${CODEX_CLI_BIN}`
    );
  }
);