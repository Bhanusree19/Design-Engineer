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
const os = require('os');
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
// CODEX ACCOUNT SWITCH
// -----------------------------------------------------------------------------

app.post(
  '/auth/codex/logout',
  async (req, res) => {
    const sessionId =
      req.body.session;

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
      if (
        fs.existsSync(
          CODEX_CLI_BIN
        )
      ) {
        await runProcess(
          process.execPath,
          [
            CODEX_CLI_BIN,
            'logout',
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
          }
        );
      }

      session.codexToken =
        null;

      session.codexUser =
        null;

      session.codexAuth =
        null;

      session.lastUsedAt =
        new Date().toISOString();

      persistSessions();

      res.json({
        success:
          true,
      });
    } catch (error) {
      console.error(
        '[Design Engineer] Codex logout failed:',
        error
      );

      res
        .status(500)
        .json({
          error:
            error.message ||
            'Codex logout failed.',
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

function clearGithubSession(
  session
) {
  session.githubToken =
    null;

  session.githubUser =
    null;

  session.lastUsedAt =
    new Date().toISOString();

  persistSessions();
}

function respondGithubReauth(
  res
) {
  return res
    .status(401)
    .json({
      error:
        'GitHub authorization expired or was revoked. Reconnect GitHub in the plugin.',
      code:
        'GITHUB_REAUTH_REQUIRED',
    });
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
        r.status === 401
      ) {
        clearGithubSession(
          session
        );

        return respondGithubReauth(
          res
        );
      }

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
        r.status === 401
      ) {
        clearGithubSession(
          session
        );

        return respondGithubReauth(
          res
        );
      }

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

function runProcess(
  command,
  args,
  options = {}
) {
  const logPrefix =
    options.logPrefix;

  return new Promise(
    (resolve, reject) => {
      const child =
        spawn(
          command,
          args,
          {
            ...options,
            stdio: [
              'ignore',
              'pipe',
              'pipe',
            ],
          }
        );

      let stdout = '';
      let stderr = '';

      child.stdout.on(
        'data',
        (chunk) => {
          const text =
            chunk.toString();

          stdout += text;

          if (
            logPrefix
          ) {
            text
              .split(/\r?\n/)
              .filter(Boolean)
              .forEach(
                (line) =>
                  console.log(
                    `${logPrefix} ${line}`
                  )
              );
          }
        }
      );

      child.stderr.on(
        'data',
        (chunk) => {
          const text =
            chunk.toString();

          stderr += text;

          if (
            logPrefix
          ) {
            text
              .split(/\r?\n/)
              .filter(Boolean)
              .forEach(
                (line) =>
                  console.log(
                    `${logPrefix} ${line}`
                  )
              );
          }
        }
      );

      child.on(
        'error',
        reject
      );

      child.on(
        'close',
        (code) => {
          if (code !== 0) {
            reject(
              new Error(
                `${command} ${args[0] || ''} failed (${code}): ${stderr || stdout}`
              )
            );

            return;
          }

          resolve({
            stdout,
            stderr,
          });
        }
      );
    }
  );
}

async function githubRequest(
  session,
  endpoint,
  options = {}
) {
  const response =
    await fetch(
      `https://api.github.com${endpoint}`,
      {
        ...options,
        headers: {
          Accept:
            'application/vnd.github+json',
          Authorization:
            `Bearer ${session.githubToken}`,
          'User-Agent':
            'design-engineer-plugin',
          ...(options.headers || {}),
        },
      }
    );

  const body =
    await response.json();

  if (!response.ok) {
    throw new Error(
      body.message ||
        `GitHub request failed (${response.status})`
    );
  }

  return body;
}

function getRepositoryParts(
  repository
) {
  const parts =
    String(repository)
      .split('/')
      .filter(Boolean);

  if (parts.length !== 2) {
    throw new Error(
      'repo must use the owner/name format.'
    );
  }

  return parts;
}

function buildImplementationPrompt(
  screens,
  contextDir,
  baseBranch,
  branchName
) {
  const screenList =
    screens
      .map(
        (screen) =>
          `- ${screen.name}: ${path.join(contextDir, screen.fileName)}`
      )
      .join('\n');

  return `You are implementing multiple Figma screens in an existing React Native repository.

Screens and design context files:
${screenList}

Base branch: ${baseBranch}
Working branch: ${branchName}

Instructions:
1. Read README.md first, then inspect the complete repository tree, package.json files, and existing source before changing anything.
2. The base branch may contain only README.md. If the app structure is missing, create a standard React Native project structure in this repository using the stack and package manager described by README.md. Keep the structure clear and production-ready, with an app entry point, src/screens, src/components, src/navigation, and src/theme or src/styles where appropriate.
3. Preserve any existing React Native stack, package manager, naming conventions, and folder structure when those files already exist. Do not create a second app beside an existing app.
4. Implement every supplied screen in the same branch and make the screens reachable through the app's navigation. Use the design context JSON files as the source of truth for layout, typography, spacing, colors, assets, and interactions.
5. Inspect each extracted JSON for navigation relationships, destination names, tap targets, links, or screen transition metadata. Recreate those routes and transitions in the navigation setup, including the initial route and back behavior where the data indicates them.
6. Share components, styles, theme tokens, and navigation configuration when screens have common structure. Do not duplicate whole screen implementations unnecessarily.
7. Do not modify lockfiles or dependencies unless the implementation genuinely requires it. If navigation requires a dependency and the repository has no package setup, add the minimum documented dependency and its configuration.
8. Do not commit the temporary .design-engineer/context files; they will be removed by the orchestrator.
9. Add or update focused tests when the repository has a test setup.
10. Run the repository's relevant validation commands from README and package scripts before finishing.

Leave the working tree containing all screen implementations and working navigation, not just placeholder files.`;
}

async function appendTestInstructions(
  worktree,
  screenNames,
  branchName
) {
  const readmePath =
    path.join(
      worktree,
      'README.md'
    );

  if (
    !fs.existsSync(
      readmePath
    )
  ) {
    return;
  }

  const marker =
    `<!-- design-engineer:${branchName} -->`;

  const current =
    await fs.promises.readFile(
      readmePath,
      'utf8'
    );

  if (
    current.includes(
      marker
    )
  ) {
    return;
  }

  const screenList =
    screenNames
      .map(
        (screenName) =>
          `- ${screenName}`
      )
      .join('\n');

  const section = `\n\n${marker}\n## Test implemented screens\n\nThis implementation was generated from the Figma design context for these screens on branch \`${branchName}\`:\n\n${screenList}\n\n1. Clone this branch and install dependencies using the repository's documented package manager.\n2. Start the React Native app using the existing README command.\n3. Open every implemented screen through the navigation flow and verify the initial route, links, transitions, and back behavior.\n4. Verify each screen's layout, typography, spacing, interactions, and responsive behavior against Figma.\n5. Run the repository's documented test and lint commands before accepting the pull request.\n`;

  await fs.promises.writeFile(
    readmePath,
    `${current.trimEnd()}${section}`,
    'utf8'
  );
}

async function implementScreensInBranch(
  session,
  repository,
  baseBranch,
  screens
) {
  const screenNames =
    screens.map(
      (screen) =>
        screen.name
    );

  const firstScreenName =
    screenNames[0] ||
    'screens';

  const safeScreenName =
    sanitizeFileName(
      firstScreenName
    ).toLowerCase();

  const branchName =
    `implement/${safeScreenName}-screens-${Date.now()}`;

  const tempRoot =
    await fs.promises.mkdtemp(
      path.join(
        os.tmpdir(),
        'design-engineer-'
      )
    );

  const worktree =
    path.join(
      tempRoot,
      'repository'
    );

  const contextDir =
    path.join(
      worktree,
      '.design-engineer',
      'context'
    );

  const encodedToken =
    encodeURIComponent(
      session.githubToken
    );

  const cloneUrl =
    `https://x-access-token:${encodedToken}@github.com/${repository}.git`;

  try {
    await runProcess(
      'git',
      [
        'clone',
        '--depth=1',
        '--branch',
        baseBranch,
        cloneUrl,
        worktree,
      ]
    );

    await runProcess(
      'git',
      [
        'checkout',
        '-b',
        branchName,
      ],
      {
        cwd: worktree,
      }
    );

    console.log(
      `[Design Engineer] Created implementation branch ${branchName}`
    );

    await fs.promises.mkdir(
      contextDir,
      {
        recursive: true,
      }
    );

    const contextScreens =
      [];

    for (
      let index = 0;
      index < screens.length;
      index++
    ) {
      const screen =
        screens[index];

      const screenFileName =
        `${sanitizeFileName(screen.name).toLowerCase()}-${index + 1}.json`;

      await fs.promises.writeFile(
        path.join(
          contextDir,
          screenFileName
        ),
        JSON.stringify(
          screen.context,
          null,
          2
        ),
        'utf8'
      );

      contextScreens.push({
        name:
          screen.name,
        fileName:
          screenFileName,
      });
    }

    await runProcess(
      process.execPath,
      [
        CODEX_CLI_BIN,
        'exec',
        '--dangerously-bypass-approvals-and-sandbox',
        '--cd',
        worktree,
        buildImplementationPrompt(
          contextScreens,
          contextDir,
          baseBranch,
          branchName
        ),
      ],
      {
        cwd: worktree,
        logPrefix:
          '[Codex]',
        env: {
          ...process.env,
          CODEX_HOME,
          HOME:
            CODEX_HOME,
        },
      }
    );

    console.log(
      `[Design Engineer] Codex finished for ${screenNames.join(', ')}`
    );

    await fs.promises.rm(
      path.join(
        worktree,
        '.design-engineer'
      ),
      {
        recursive: true,
        force: true,
      }
    );

    await appendTestInstructions(
      worktree,
      screenNames,
      branchName
    );

    await runProcess(
      'git',
      [
        'config',
        'user.name',
        'Design Engineer',
      ],
      {
        cwd: worktree,
      }
    );

    console.log(
      `[Design Engineer] Pushed branch ${branchName}`
    );

    await runProcess(
      'git',
      [
        'config',
        'user.email',
        'design-engineer[bot]@users.noreply.github.com',
      ],
      {
        cwd: worktree,
      }
    );

    await runProcess(
      'git',
      [
        'add',
        '-A',
      ],
      {
        cwd: worktree,
      }
    );

    await runProcess(
      'git',
      [
        'commit',
        '-m',
        `Implement ${screenNames.join(', ')}`,
      ],
      {
        cwd: worktree,
      }
    );

    await runProcess(
      'git',
      [
        'push',
        'origin',
        branchName,
      ],
      {
        cwd: worktree,
      }
    );

    const [owner, repo] =
      getRepositoryParts(
        repository
      );

    const pullRequest =
      await githubRequest(
        session,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            title:
              `Implement ${screenNames.join(', ')}`,
            head: branchName,
            base: baseBranch,
            body:
              `## Design Engineer implementation\n\nScreens:\n${screenNames.map((screenName) => `- ${screenName}`).join('\n')}\n\nCodex implemented all selected screens together from the saved Figma design contexts, including navigation. See the README test steps in this branch before merging.`,
          }),
        }
      );

    console.log(
      `[Design Engineer] Pull request created: ${pullRequest.html_url}`
    );

    return {
      screens: screenNames,
      branch: branchName,
      pullRequestUrl:
        pullRequest.html_url,
    };
  } finally {
    await fs.promises.rm(
      tempRoot,
      {
        recursive: true,
        force: true,
      }
    );
  }
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
// IMPLEMENT SCREENS WITH CODEX AND OPEN PULL REQUESTS
// -----------------------------------------------------------------------------

app.post(
  '/api/screens/implement',
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
      baseBranch,
      screens,
    } = req.body;

    if (
      !repo ||
      !baseBranch ||
      !Array.isArray(
        screens
      ) ||
      screens.length === 0
    ) {
      return res
        .status(400)
        .json({
          error:
            'repo, baseBranch and screens[] are required',
        });
    }

    if (
      !session.codexToken &&
      (await getCodexLoginStatus()) !==
        'connected'
    ) {
      return res
        .status(401)
        .json({
          error:
            'Codex is not authenticated in the backend container.',
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

      const safeBaseBranch =
        sanitizeFileName(
          baseBranch
        );

      const savedContextDir =
        path.join(
          __dirname,
          'data',
          safeUser,
          safeRepo,
          safeBaseBranch
        );

      const selectedScreens =
        await Promise.all(
          screens
            .filter(
              (screen) =>
                screen &&
                typeof screen ===
                  'object'
            )
            .map(
              async (screen, index) => {
                const name =
                  screen.screen ||
                  screen.name ||
                  `screen-${index + 1}`;

                const filePath =
                  path.join(
                    savedContextDir,
                    `design-context_${sanitizeFileName(name)}.json`
                  );

                let context;

                try {
                  context =
                    JSON.parse(
                      await fs.promises.readFile(
                        filePath,
                        'utf8'
                      )
                    );
                } catch (error) {
                  throw new Error(
                    `Saved Design Context not found for "${name}" at ${filePath}. Fetch the screens again before starting implementation.`
                  );
                }

                return {
                  name,
                  context,
                };
              }
            )
        );

      if (
        selectedScreens.length === 0
      ) {
        return res
          .status(400)
          .json({
            error:
              'No valid screens were supplied.',
          });
      }

      console.log(
        `[Design Engineer] Starting one implementation branch for ${selectedScreens.length} screen(s).`
      );

      const implementation =
        await implementScreensInBranch(
          session,
          repo,
          baseBranch,
          selectedScreens
        );

      res.json({
        success:
          true,
        implementations: [
          implementation,
        ],
      });
    } catch (error) {
      console.error(
        '[Design Engineer] Failed to implement screens:',
        error
      );

      res
        .status(500)
        .json({
          error:
            error.message ||
            'Failed to implement screens.',
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