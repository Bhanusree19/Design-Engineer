// // src/ui/App.tsx

// import React, {
//   useEffect,
//   useRef,
//   useState,
// } from 'react';

// import Chat, {
//   ChatMessage,
// } from './Chat';

// import ContextChip from './ContextChip';

// import ProgressCard from './ProgressCard';

// import Composer from './Composer';

// import {
//   onPluginMessage,
//   sendToPlugin,
// } from './figmaBridge';

// import * as api from '../api/client';

// type Step =
//   | 'restoring'
//   | 'signin'
//   | 'github'
//   | 'repo'
//   | 'branch'
//   | 'screens'
//   | 'done';

// interface SelectionItem {
//   id: string;
//   name: string;
//   type: string;
//   width: number;
//   height: number;
// }

// export default function App() {
//   // -------------------------------------------------------------------------
//   // STATE
//   // -------------------------------------------------------------------------

//   const [step, setStep] =
//     useState<Step>('restoring');

//   const [sessionId, setSessionId] =
//     useState<string | null>(null);

//   const [selectedRepo, setSelectedRepo] =
//     useState<string | null>(null);

//   const [selectedBranch, setSelectedBranch] =
//     useState<string | null>(null);

//   const [repos, setRepos] =
//     useState<api.Repo[]>([]);

//   const [branches, setBranches] =
//     useState<api.Branch[]>([]);

//   const [selection, setSelection] =
//     useState<SelectionItem[]>([]);

//   const [checkedIds, setCheckedIds] =
//     useState<Set<string>>(
//       new Set()
//     );

//   const [busy, setBusy] =
//     useState(false);

//   const [busyLabel, setBusyLabel] =
//     useState('');

//   const [error, setError] =
//     useState<string | null>(null);

//   const [messages, setMessages] =
//     useState<ChatMessage[]>([
//       {
//         role: 'system',

//         text:
//           'Welcome to Design Engineer.',
//       },
//     ]);

//   // -------------------------------------------------------------------------
//   // IMPORTANT REFS
//   // -------------------------------------------------------------------------
//   //
//   // The Figma message listener is registered once.
//   //
//   // React state can become stale inside that listener.
//   //
//   // These refs always contain the latest values.
//   // -------------------------------------------------------------------------

//   const sessionIdRef =
//     useRef<string | null>(null);

//   const selectedRepoRef =
//     useRef<string | null>(null);

//   const selectedBranchRef =
//     useRef<string | null>(null);

//   const pollRef =
//     useRef<number | null>(null);

//   // -------------------------------------------------------------------------
//   // KEEP REFS SYNCHRONIZED
//   // -------------------------------------------------------------------------

//   useEffect(() => {
//     sessionIdRef.current =
//       sessionId;
//   }, [sessionId]);

//   useEffect(() => {
//     selectedRepoRef.current =
//       selectedRepo;
//   }, [selectedRepo]);

//   useEffect(() => {
//     selectedBranchRef.current =
//       selectedBranch;
//   }, [selectedBranch]);

//   // -------------------------------------------------------------------------
//   // CHAT LOG
//   // -------------------------------------------------------------------------

//   function log(
//     role: ChatMessage['role'],
//     text: string
//   ) {
//     setMessages(
//       (current) => [
//         ...current,
//         {
//           role,
//           text,
//         },
//       ]
//     );
//   }

//   // -------------------------------------------------------------------------
//   // RESTORE SESSION WHEN PLUGIN OPENS
//   // -------------------------------------------------------------------------

//   useEffect(() => {
//     // Ask Figma main thread for saved session.
//     sendToPlugin({
//       type: 'get-saved-session',
//     });

//     // Also get current Figma selection.
//     sendToPlugin({
//       type: 'get-selection',
//     });

//     const cleanup =
//       onPluginMessage(
//         (msg) => {
//           // ---------------------------------------------------------------
//           // SAVED SESSION
//           // ---------------------------------------------------------------

//           if (
//             msg.type ===
//             'saved-session'
//           ) {
//             restoreSavedSession(
//               msg.sessionId
//             );
//           }

//           // ---------------------------------------------------------------
//           // SESSION SAVED
//           // ---------------------------------------------------------------

//           if (
//             msg.type ===
//             'session-saved'
//           ) {
//             console.log(
//               '[Design Engineer] Session saved successfully.'
//             );
//           }

//           // ---------------------------------------------------------------
//           // SESSION CLEARED
//           // ---------------------------------------------------------------

//           if (
//             msg.type ===
//             'session-cleared'
//           ) {
//             console.log(
//               '[Design Engineer] Session cleared.'
//             );
//           }

//           // ---------------------------------------------------------------
//           // FIGMA SELECTION
//           // ---------------------------------------------------------------

//           if (
//             msg.type ===
//             'selection-changed'
//           ) {
//             setSelection(
//               msg.selection || []
//             );
//           }

//           // ---------------------------------------------------------------
//           // EXTRACTION START
//           // ---------------------------------------------------------------

//           if (
//             msg.type ===
//             'extract-started'
//           ) {
//             setBusy(true);

//             setBusyLabel(
//               `Starting extraction of ${
//                 msg.total || 0
//               } screen${
//                 msg.total === 1
//                   ? ''
//                   : 's'
//               }...`
//             );
//           }

//           // ---------------------------------------------------------------
//           // EXTRACTION PROGRESS
//           // ---------------------------------------------------------------

//           if (
//             msg.type ===
//             'extract-progress'
//           ) {
//             if (
//               msg.step ===
//               'metadata'
//             ) {
//               setBusy(true);

//               setBusyLabel(
//                 `Extracting "${msg.screen}" (${msg.current}/${msg.total})...`
//               );
//             }

//             if (
//               msg.step ===
//               'complete'
//             ) {
//               const nodeCount =
//                 msg.summary
//                   ?.nodeCount ??
//                 0;

//               const extractionTime =
//                 msg.extractionTimeMs ??
//                 0;

//               setBusyLabel(
//                 `✓ Extracted "${msg.screen}" — ${nodeCount} nodes in ${extractionTime}ms`
//               );
//             }
//           }

//           // ---------------------------------------------------------------
//           // EXTRACTION ERROR
//           // ---------------------------------------------------------------

//           if (
//             msg.type ===
//             'extraction-error'
//           ) {
//             setBusy(false);

//             setBusyLabel('');

//             const message =
//               msg.error ||
//               'Figma extraction failed.';

//             setError(message);

//             log(
//               'assistant',
//               `❌ Extraction failed:\n${message}`
//             );
//           }

//           // ---------------------------------------------------------------
//           // EXTRACTION COMPLETE
//           // ---------------------------------------------------------------

//           if (
//             msg.type ===
//             'screens-extracted'
//           ) {
//             console.log(
//               '[Design Engineer] Received screens-extracted.'
//             );

//             console.log(
//               '[Design Engineer] Screen count:',
//               msg.results?.length ||
//                 0
//             );

//             handleExtracted(
//               msg.results || []
//             );
//           }
//         }
//       );

//     return cleanup;

//     // The message listener intentionally runs once.
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   // -------------------------------------------------------------------------
//   // RESTORE SAVED SESSION
//   // -------------------------------------------------------------------------

//   async function restoreSavedSession(
//     savedSessionId:
//       | string
//       | null
//   ) {
//     // No previous session.
//     if (
//       !savedSessionId
//     ) {
//       console.log(
//         '[Design Engineer] No saved session found.'
//       );

//       setStep('signin');

//       setMessages([
//         {
//           role: 'system',

//           text:
//             'Sign in to start. Your session will be remembered the next time you open the plugin.',
//         },
//       ]);

//       return;
//     }

//     console.log(
//       '[Design Engineer] Found saved session:',
//       savedSessionId
//     );

//     // Put it into state and ref immediately.
//     setSessionId(
//       savedSessionId
//     );

//     sessionIdRef.current =
//       savedSessionId;

//     setBusy(true);

//     setBusyLabel(
//       'Restoring your previous session...'
//     );

//     try {
//       const status =
//         await api.getSessionStatus(
//           savedSessionId
//         );

//       console.log(
//         '[Design Engineer] Restored session status:',
//         status
//       );

//       // ---------------------------------------------------------------
//       // BOTH CODEX AND GITHUB ARE CONNECTED
//       // ---------------------------------------------------------------

//       if (
//         status.githubConnected
//       ) {
//         log(
//           'assistant',
//           `Welcome back${
//             status.githubUser
//               ? `, @${status.githubUser}`
//               : ''
//           }! Your previous session has been restored.`
//         );

//         await loadRepos(
//           savedSessionId
//         );

//         return;
//       }

//       // ---------------------------------------------------------------
//       // CODEX CONNECTED, GITHUB NOT CONNECTED
//       // ---------------------------------------------------------------

//       if (
//         status.codexConnected
//       ) {
//         log(
//           'assistant',
//           `Welcome back${
//             status.codexUser
//               ? `, ${status.codexUser}`
//               : ''
//           }! Your Codex session has been restored.\n\nNow connect GitHub.`
//         );

//         setBusy(false);

//         setBusyLabel('');

//         setStep(
//           'github'
//         );

//         return;
//       }

//       // ---------------------------------------------------------------
//       // SESSION EXISTS BUT CODEX IS NOT CONNECTED
//       // ---------------------------------------------------------------

//       setBusy(false);

//       setBusyLabel('');

//       setStep(
//         'signin'
//       );
//     } catch (e: any) {
//       console.warn(
//         '[Design Engineer] Saved session could not be restored:',
//         e
//       );

//       // Session no longer exists on backend.
//       // Remove it from Figma storage.
//       sendToPlugin({
//         type: 'clear-session',
//       });

//       setSessionId(null);

//       sessionIdRef.current =
//         null;

//       setSelectedRepo(null);

//       selectedRepoRef.current =
//         null;

//       setSelectedBranch(null);

//       selectedBranchRef.current =
//         null;

//       setBusy(false);

//       setBusyLabel('');

//       setStep(
//         'signin'
//       );

//       setMessages([
//         {
//           role: 'system',

//           text:
//             'Your previous session has expired. Please sign in again.',
//         },
//       ]);
//     }
//   }

//   // -------------------------------------------------------------------------
//   // CLEANUP POLLING
//   // -------------------------------------------------------------------------

//   useEffect(() => {
//     return () => {
//       if (
//         pollRef.current !==
//         null
//       ) {
//         window.clearInterval(
//           pollRef.current
//         );

//         pollRef.current =
//           null;
//       }
//     };
//   }, []);

//   // -------------------------------------------------------------------------
//   // CODEX SIGN IN
//   // -------------------------------------------------------------------------

//   async function handleSignIn() {
//     setBusy(true);

//     setBusyLabel(
//       'Starting Codex sign in...'
//     );

//     setError(null);

//     try {
//       const {
//         sessionId:
//           newSessionId,
//       } =
//         await api.createSession();

//       // Save to React.
//       setSessionId(
//         newSessionId
//       );

//       // Save immediately to ref.
//       sessionIdRef.current =
//         newSessionId;

//       // IMPORTANT:
//       // Persist session ID in Figma.
//       sendToPlugin({
//         type: 'save-session',

//         sessionId:
//           newSessionId,
//       });

//       log(
//         'user',
//         'Sign in'
//       );

//       const device =
//         await api.startCodexDeviceAuth(
//           newSessionId
//         );

//       log(
//         'assistant',
//         `Go to ${device.verification_uri} and enter this code: ${device.user_code}\n\nOpening the login page now...`
//       );

//       setBusyLabel(
//         `Waiting for Codex login: ${device.user_code}...`
//       );

//       window.open(
//         device.verification_uri_complete,
//         '_blank'
//       );

//       if (
//         pollRef.current !==
//         null
//       ) {
//         window.clearInterval(
//           pollRef.current
//         );
//       }

//       pollRef.current =
//         window.setInterval(
//           async () => {
//             try {
//               const status =
//                 await api.getCodexDeviceStatus(
//                   device.device_code
//                 );

//               if (
//                 status.status ===
//                 'approved'
//               ) {
//                 if (
//                   pollRef.current !==
//                   null
//                 ) {
//                   window.clearInterval(
//                     pollRef.current
//                   );

//                   pollRef.current =
//                     null;
//                 }

//                 log(
//                   'assistant',
//                   `Signed in as ${
//                     status.codexUser ||
//                     'Codex user'
//                   }.\n\nYour login will now be remembered for this plugin.`
//                 );

//                 setBusy(false);

//                 setBusyLabel('');

//                 setStep(
//                   'github'
//                 );
//               }

//               if (
//                 status.status ===
//                 'expired'
//               ) {
//                 if (
//                   pollRef.current !==
//                   null
//                 ) {
//                   window.clearInterval(
//                     pollRef.current
//                   );

//                   pollRef.current =
//                     null;
//                 }

//                 setBusy(false);

//                 setBusyLabel('');

//                 setError(
//                   'Codex login expired. Please try again.'
//                 );
//               }
//             } catch (
//               pollError
//             ) {
//               console.error(
//                 '[Design Engineer] Codex polling error:',
//                 pollError
//               );
//             }
//           },
//           (device.interval ||
//             3) *
//             1000
//         );
//     } catch (e: any) {
//       console.error(
//         '[Design Engineer] Codex sign-in failed:',
//         e
//       );

//       setError(
//         e?.message ||
//           'Codex sign in failed.'
//       );

//       setBusy(false);

//       setBusyLabel('');
//     }
//   }

//   // -------------------------------------------------------------------------
//   // GITHUB AUTH
//   // -------------------------------------------------------------------------

//   function handleConnectGithub() {
//     const currentSessionId =
//       sessionIdRef.current;

//     if (
//       !currentSessionId
//     ) {
//       setError(
//         'No active session. Please sign in again.'
//       );

//       return;
//     }

//     window.open(
//       api.githubAuthUrl(
//         currentSessionId
//       ),
//       '_blank'
//     );

//     log(
//       'user',
//       'Connect GitHub'
//     );

//     log(
//       'assistant',
//       'Opened GitHub authorization in your browser. Waiting for authorization to finish...'
//     );

//     setBusy(true);

//     setBusyLabel(
//       'Waiting for GitHub authorization...'
//     );

//     if (
//       pollRef.current !==
//       null
//     ) {
//       window.clearInterval(
//         pollRef.current
//       );
//     }

//     pollRef.current =
//       window.setInterval(
//         async () => {
//           try {
//             const status =
//               await api.getSessionStatus(
//                 currentSessionId
//               );

//             if (
//               status.githubConnected
//             ) {
//               if (
//                 pollRef.current !==
//                 null
//               ) {
//                 window.clearInterval(
//                   pollRef.current
//                 );

//                 pollRef.current =
//                   null;
//               }

//               log(
//                 'assistant',
//                 `Connected as @${status.githubUser}. Loading your repositories...`
//               );

//               await loadRepos(
//                 currentSessionId
//               );
//             }
//           } catch (
//             pollError
//           ) {
//             console.error(
//               '[Design Engineer] GitHub polling error:',
//               pollError
//             );
//           }
//         },
//         2000
//       );
//   }

//   // -------------------------------------------------------------------------
//   // LOAD REPOSITORIES
//   // -------------------------------------------------------------------------

//   async function loadRepos(
//     overrideSessionId?: string
//   ) {
//     const currentSessionId =
//       overrideSessionId ||
//       sessionIdRef.current;

//     if (
//       !currentSessionId
//     ) {
//       setError(
//         'No active session. Please sign in again.'
//       );

//       setBusy(false);

//       return;
//     }

//     setBusy(true);

//     setBusyLabel(
//       'Loading repositories...'
//     );

//     try {
//       const data =
//         await api.listRepos(
//           currentSessionId
//         );

//       setRepos(
//         data.repos || []
//       );

//       setStep('repo');
//     } catch (e: any) {
//       console.error(
//         '[Design Engineer] Failed to load repositories:',
//         e
//       );

//       setError(
//         e?.message ||
//           'Failed to load repositories.'
//       );
//     } finally {
//       setBusy(false);

//       setBusyLabel('');
//     }
//   }

//   // -------------------------------------------------------------------------
//   // SELECT REPOSITORY
//   // -------------------------------------------------------------------------

//   async function handleSelectRepo(
//     fullName: string
//   ) {
//     const currentSessionId =
//       sessionIdRef.current;

//     if (
//       !currentSessionId
//     ) {
//       setError(
//         'No active session. Please sign in again.'
//       );

//       return;
//     }

//     setSelectedRepo(
//       fullName
//     );

//     // IMPORTANT: update ref immediately.
//     selectedRepoRef.current =
//       fullName;

//     log(
//       'user',
//       `Repo: ${fullName}`
//     );

//     setBusy(true);

//     setBusyLabel(
//       'Loading branches...'
//     );

//     try {
//       const [
//         owner,
//         repo,
//       ] =
//         fullName.split('/');

//       if (
//         !owner ||
//         !repo
//       ) {
//         throw new Error(
//           `Invalid repository name: ${fullName}`
//         );
//       }

//       const data =
//         await api.listBranches(
//           currentSessionId,
//           owner,
//           repo
//         );

//       setBranches(
//         data.branches || []
//       );

//       log(
//         'assistant',
//         'Pick a branch to work from.'
//       );

//       setStep(
//         'branch'
//       );
//     } catch (e: any) {
//       console.error(
//         '[Design Engineer] Failed to load branches:',
//         e
//       );

//       setError(
//         e?.message ||
//           'Failed to load branches.'
//       );
//     } finally {
//       setBusy(false);

//       setBusyLabel('');
//     }
//   }

//   // -------------------------------------------------------------------------
//   // SELECT BRANCH
//   // -------------------------------------------------------------------------

//   function handleSelectBranch(
//     name: string
//   ) {
//     setSelectedBranch(
//       name
//     );

//     // IMPORTANT: update ref immediately.
//     selectedBranchRef.current =
//       name;

//     log(
//       'user',
//       `Branch: ${name}`
//     );

//     log(
//       'assistant',
//       'Now select one or more screens on the Figma canvas. You can select multiple frames at the same time and then click Fetch.'
//     );

//     setStep(
//       'screens'
//     );
//   }

//   // -------------------------------------------------------------------------
//   // SELECT / UNSELECT SCREEN
//   // -------------------------------------------------------------------------

//   function toggleChecked(
//     id: string
//   ) {
//     setCheckedIds(
//       (previous) => {
//         const next =
//           new Set(
//             previous
//           );

//         if (
//           next.has(id)
//         ) {
//           next.delete(id);
//         } else {
//           next.add(id);
//         }

//         return next;
//       }
//     );
//   }

//   // -------------------------------------------------------------------------
//   // SELECT ALL CURRENT FIGMA SCREENS
//   // -------------------------------------------------------------------------

//   function selectAllScreens() {
//     setCheckedIds(
//       new Set(
//         selection.map(
//           (screen) =>
//             screen.id
//         )
//       )
//     );
//   }

//   // -------------------------------------------------------------------------
//   // CLEAR SCREEN SELECTION
//   // -------------------------------------------------------------------------

//   function clearScreenSelection() {
//     setCheckedIds(
//       new Set()
//     );
//   }

//   // -------------------------------------------------------------------------
//   // FETCH
//   // -------------------------------------------------------------------------

//   function handleFetch() {
//     const currentSessionId =
//       sessionIdRef.current;

//     const currentRepo =
//       selectedRepoRef.current;

//     const currentBranch =
//       selectedBranchRef.current;

//     console.log(
//       '[Design Engineer] Fetch validation:',
//       {
//         sessionId:
//           currentSessionId,

//         repo:
//           currentRepo,

//         branch:
//           currentBranch,

//         screenCount:
//           checkedIds.size,
//       }
//     );

//     if (
//       !currentSessionId ||
//       !currentRepo ||
//       !currentBranch
//     ) {
//       setError(
//         'Session, repository, or branch is missing.'
//       );

//       console.error(
//         '[Design Engineer] Missing fetch information:',
//         {
//           sessionId:
//             currentSessionId,

//           repo:
//             currentRepo,

//           branch:
//             currentBranch,
//         }
//       );

//       return;
//     }

//     if (
//       checkedIds.size === 0
//     ) {
//       setError(
//         'Please select at least one screen.'
//       );

//       return;
//     }

//     setError(null);

//     log(
//       'user',
//       `Fetch ${
//         checkedIds.size
//       } screen${
//         checkedIds.size > 1
//           ? 's'
//           : ''
//       }`
//     );

//     log(
//       'assistant',
//       `I'll analyze ${
//         checkedIds.size
//       } selected Figma screen${
//         checkedIds.size > 1
//           ? 's'
//           : ''
//       } and create a separate Design Context JSON file for each screen.`
//     );

//     setBusy(true);

//     setBusyLabel(
//       `Starting extraction of ${checkedIds.size} screen${
//         checkedIds.size > 1
//           ? 's'
//           : ''
//       }...`
//     );

//     // Send ALL checked node IDs.
//     sendToPlugin({
//       type: 'extract-screens',

//       nodeIds:
//         Array.from(
//           checkedIds
//         ),
//     });
//   }

//   // -------------------------------------------------------------------------
//   // HANDLE EXTRACTED SCREENS
//   // -------------------------------------------------------------------------

//   async function handleExtracted(
//     results: any[]
//   ) {
//     console.log(
//       '[Design Engineer] handleExtracted called'
//     );

//     // IMPORTANT:
//     // Always read current values from refs.
//     const currentSessionId =
//       sessionIdRef.current;

//     const currentRepo =
//       selectedRepoRef.current;

//     const currentBranch =
//       selectedBranchRef.current;

//     console.log(
//       '[Design Engineer] Current session:',
//       currentSessionId
//     );

//     console.log(
//       '[Design Engineer] Current repo:',
//       currentRepo
//     );

//     console.log(
//       '[Design Engineer] Current branch:',
//       currentBranch
//     );

//     console.log(
//       '[Design Engineer] Extracted screen count:',
//       results?.length || 0
//     );

//     if (
//       !currentSessionId ||
//       !currentRepo ||
//       !currentBranch
//     ) {
//       setBusy(false);

//       setBusyLabel('');

//       setError(
//         'Session, repository, or branch is missing.'
//       );

//       return;
//     }

//     if (
//       !Array.isArray(
//         results
//       ) ||
//       results.length === 0
//     ) {
//       setBusy(false);

//       setBusyLabel('');

//       setError(
//         'Figma returned no Design Context.'
//       );

//       return;
//     }

//     setBusy(true);

//     setBusyLabel(
//       `Saving ${
//         results.length
//       } Design Context file${
//         results.length > 1
//           ? 's'
//           : ''
//       }...`
//     );

//     setError(null);

//     try {
//       console.log(
//         '[Design Engineer] Sending Design Context to backend...'
//       );

//       const result =
//         await api.submitScreens(
//           currentSessionId,
//           currentRepo,
//           currentBranch,
//           results
//         );

//       console.log(
//         '[Design Engineer] Backend response:',
//         result
//       );

//       const savedFiles =
//         result.saved || [];

//       // ---------------------------------------------------------------
//       // SUCCESS MESSAGE
//       // ---------------------------------------------------------------

//       let successMessage =
//         `✓ Successfully extracted ${
//           results.length
//         } screen${
//           results.length > 1
//             ? 's'
//             : ''
//         }.\n\n`;

//       successMessage +=
//         '✓ Design Context JSON files saved successfully.\n\n';

//       if (
//         savedFiles.length >
//         0
//       ) {
//         successMessage +=
//           savedFiles
//             .map(
//               (file) =>
//                 `✓ ${file}`
//             )
//             .join('\n');
//       }

//       log(
//         'assistant',
//         successMessage
//       );

//       // Clear current checked state.
//       setCheckedIds(
//         new Set()
//       );

//       setBusyLabel(
//         `✓ ${
//           results.length
//         } Design Context file${
//           results.length > 1
//             ? 's'
//             : ''
//         } saved successfully`
//       );

//       setStep('done');

//       console.log(
//         '[Design Engineer] All Design Context files saved successfully.'
//       );
//     } catch (e: any) {
//       console.error(
//         '[Design Engineer] Upload failed:',
//         e
//       );

//       const message =
//         e?.message ||
//         'Failed to save Design Context.';

//       setError(message);

//       log(
//         'assistant',
//         `❌ Failed to save Design Context.\n\n${message}`
//       );
//     } finally {
//       setBusy(false);
//     }
//   }

//   // -------------------------------------------------------------------------
//   // RENDER
//   // -------------------------------------------------------------------------

//   return (
//     <div className="app">
//       <header>
//         <h1>
//           Design Engineer
//         </h1>

//         {selectedRepo && (
//           <div className="subhead">
//             {selectedRepo}

//             {selectedBranch
//               ? ` @ ${selectedBranch}`
//               : ''}
//           </div>
//         )}
//       </header>

//       {/* ----------------------------------------------------------------- */}
//       {/* RESTORING SESSION                                                 */}
//       {/* ----------------------------------------------------------------- */}

//       {step ===
//         'restoring' && (
//         <div
//           style={{
//             padding:
//               '16px',
//           }}
//         >
//           <ProgressCard
//             label="Restoring your previous session..."
//           />
//         </div>
//       )}

//       {/* ----------------------------------------------------------------- */}
//       {/* SELECTED FIGMA SCREENS                                            */}
//       {/* ----------------------------------------------------------------- */}

//       {step ===
//         'screens' &&
//         selection.length >
//           0 && (
//           <div className="chips">
//             {selection.map(
//               (screen) => (
//                 <ContextChip
//                   key={
//                     screen.id
//                   }
//                   label={
//                     screen.name
//                   }
//                   checked={checkedIds.has(
//                     screen.id
//                   )}
//                   onToggle={() =>
//                     toggleChecked(
//                       screen.id
//                     )
//                   }
//                 />
//               )
//             )}
//           </div>
//         )}

//       {/* ----------------------------------------------------------------- */}
//       {/* MULTI SELECT CONTROLS                                             */}
//       {/* ----------------------------------------------------------------- */}

//       {step ===
//         'screens' &&
//         selection.length >
//           1 && (
//           <div
//             style={{
//               display:
//                 'flex',

//               gap:
//                 '8px',

//               padding:
//                 '8px 16px',
//             }}
//           >
//             <button
//               type="button"
//               onClick={
//                 selectAllScreens
//               }
//               disabled={
//                 busy
//               }
//             >
//               Select all
//             </button>

//             <button
//               type="button"
//               onClick={
//                 clearScreenSelection
//               }
//               disabled={
//                 busy
//               }
//             >
//               Clear
//             </button>
//           </div>
//         )}

//       {/* ----------------------------------------------------------------- */}
//       {/* CHAT                                                              */}
//       {/* ----------------------------------------------------------------- */}

//       <Chat
//         messages={
//           messages
//         }
//       />

//       {/* ----------------------------------------------------------------- */}
//       {/* PROGRESS                                                          */}
//       {/* ----------------------------------------------------------------- */}

//       {busy &&
//         busyLabel &&
//         step !==
//           'restoring' && (
//           <div
//             style={{
//               padding:
//                 '0 16px',
//             }}
//           >
//             <ProgressCard
//               label={
//                 busyLabel
//               }
//             />
//           </div>
//         )}

//       {/* ----------------------------------------------------------------- */}
//       {/* ERROR                                                             */}
//       {/* ----------------------------------------------------------------- */}

//       {error && (
//         <div className="error">
//           {error}
//         </div>
//       )}

//       {/* ----------------------------------------------------------------- */}
//       {/* FOOTER                                                            */}
//       {/* ----------------------------------------------------------------- */}

//       <footer>
//         {/* ------------------------------------------------------------- */}
//         {/* SIGN IN                                                       */}
//         {/* ------------------------------------------------------------- */}

//         {step ===
//           'signin' && (
//           <button
//             className="primary"
//             disabled={
//               busy
//             }
//             onClick={
//               handleSignIn
//             }
//           >
//             Sign in to Design
//             Engineer
//           </button>
//         )}

//         {/* ------------------------------------------------------------- */}
//         {/* GITHUB                                                        */}
//         {/* ------------------------------------------------------------- */}

//         {step ===
//           'github' && (
//           <button
//             className="primary"
//             disabled={
//               busy
//             }
//             onClick={
//               handleConnectGithub
//             }
//           >
//             Continue with GitHub
//           </button>
//         )}

//         {/* ------------------------------------------------------------- */}
//         {/* REPOSITORY                                                    */}
//         {/* ------------------------------------------------------------- */}

//         {step ===
//           'repo' && (
//           <select
//             disabled={
//               busy
//             }
//             defaultValue=""
//             onChange={(
//               event
//             ) => {
//               const value =
//                 event.target
//                   .value;

//               if (value) {
//                 handleSelectRepo(
//                   value
//                 );
//               }
//             }}
//           >
//             <option
//               value=""
//               disabled
//             >
//               Choose a repository...
//             </option>

//             {repos.map(
//               (repo) => (
//                 <option
//                   key={
//                     repo.fullName
//                   }
//                   value={
//                     repo.fullName
//                   }
//                 >
//                   {
//                     repo.fullName
//                   }

//                   {repo.private
//                     ? ' (private)'
//                     : ''}
//                 </option>
//               )
//             )}
//           </select>
//         )}

//         {/* ------------------------------------------------------------- */}
//         {/* BRANCH                                                        */}
//         {/* ------------------------------------------------------------- */}

//         {step ===
//           'branch' && (
//           <select
//             disabled={
//               busy
//             }
//             defaultValue=""
//             onChange={(
//               event
//             ) => {
//               const value =
//                 event.target
//                   .value;

//               if (value) {
//                 handleSelectBranch(
//                   value
//                 );
//               }
//             }}
//           >
//             <option
//               value=""
//               disabled
//             >
//               Choose a branch...
//             </option>

//             {branches.map(
//               (branch) => (
//                 <option
//                   key={
//                     branch.name
//                   }
//                   value={
//                     branch.name
//                   }
//                 >
//                   {
//                     branch.name
//                   }
//                 </option>
//               )
//             )}
//           </select>
//         )}

//         {/* ------------------------------------------------------------- */}
//         {/* FETCH                                                         */}
//         {/* ------------------------------------------------------------- */}

//         {step ===
//           'screens' && (
//           <button
//             className="primary"
//             disabled={
//               busy ||
//               checkedIds.size ===
//                 0
//             }
//             onClick={
//               handleFetch
//             }
//           >
//             {checkedIds.size >
//             0
//               ? `Fetch (${checkedIds.size})`
//               : 'Select screens'}
//           </button>
//         )}

//         {/* ------------------------------------------------------------- */}
//         {/* DONE                                                          */}
//         {/* ------------------------------------------------------------- */}

//         {step ===
//           'done' && (
//           <button
//             className="primary"
//             onClick={() => {
//               setStep(
//                 'screens'
//               );

//               setBusyLabel(
//                 ''
//               );

//               setError(
//                 null
//               );
//             }}
//           >
//             Select more screens
//           </button>
//         )}
//       </footer>

//       {step ===
//         'done' && (
//         <Composer
//           onSend={() => {}}
//           disabled
//         />
//       )}
//     </div>
//   );
// }



// src/ui/App.tsx

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

import Composer from './Composer';

import {
  onPluginMessage,
  sendToPlugin,
} from './figmaBridge';

import * as api from '../api/client';

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

type Step =
  | 'restoring'
  | 'signin'
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

// -----------------------------------------------------------------------------
// APP
// -----------------------------------------------------------------------------

export default function App() {
  // ===========================================================================
  // STATE
  // ===========================================================================

  const [step, setStep] =
    useState<Step>(
      'restoring'
    );

  const [sessionId, setSessionId] =
    useState<
      string | null
    >(null);

  const [selectedRepo, setSelectedRepo] =
    useState<
      string | null
    >(null);

  const [selectedBranch, setSelectedBranch] =
    useState<
      string | null
    >(null);

  const [repos, setRepos] =
    useState<api.Repo[]>(
      []
    );

  const [branches, setBranches] =
    useState<api.Branch[]>(
      []
    );

  const [selection, setSelection] =
    useState<
      SelectionItem[]
    >([]);

  const [checkedIds, setCheckedIds] =
    useState<
      Set<string>
    >(
      new Set()
    );

  const [busy, setBusy] =
    useState(false);

  const [busyLabel, setBusyLabel] =
    useState('');

  const [error, setError] =
    useState<
      string | null
    >(null);

  const [messages, setMessages] =
    useState<
      ChatMessage[]
    >([
      {
        role:
          'system',

        text:
          'Welcome to Design Engineer.',
      },
    ]);

  // ===========================================================================
  // REFS
  // ===========================================================================

  const sessionIdRef =
    useRef<
      string | null
    >(null);

  const selectedRepoRef =
    useRef<
      string | null
    >(null);

  const selectedBranchRef =
    useRef<
      string | null
    >(null);

  const pollRef =
    useRef<
      number | null
    >(null);

  // ===========================================================================
  // SYNC REFS
  // ===========================================================================

  useEffect(() => {
    sessionIdRef.current =
      sessionId;
  }, [sessionId]);

  useEffect(() => {
    selectedRepoRef.current =
      selectedRepo;
  }, [selectedRepo]);

  useEffect(() => {
    selectedBranchRef.current =
      selectedBranch;
  }, [selectedBranch]);

  // ===========================================================================
  // CHAT
  // ===========================================================================

  function log(
    role: ChatMessage['role'],
    text: string
  ) {
    setMessages(
      (current) => [
        ...current,

        {
          role,

          text,
        },
      ]
    );
  }

  // ===========================================================================
  // INITIALIZE
  // ===========================================================================

  useEffect(() => {
    // Ask Figma main thread for
    // previously saved session.
    sendToPlugin({
      type:
        'get-saved-session',
    });

    // Ask for current selection.
    sendToPlugin({
      type:
        'get-selection',
    });

    const cleanup =
      onPluginMessage(
        (msg) => {
          // -----------------------------------------------------------------
          // SAVED SESSION
          // -----------------------------------------------------------------

          if (
            msg.type ===
            'saved-session'
          ) {
            restoreSavedSession(
              msg.sessionId,
              !!msg.codexAuthenticated
            );
          }

          // -----------------------------------------------------------------
          // SELECTION
          // -----------------------------------------------------------------

          if (
            msg.type ===
            'selection-changed'
          ) {
            setSelection(
              msg.selection ||
                []
            );
          }

          // -----------------------------------------------------------------
          // EXTRACTION START
          // -----------------------------------------------------------------

          if (
            msg.type ===
            'extract-started'
          ) {
            setBusy(true);

            setBusyLabel(
              `Starting extraction of ${
                msg.total
              } screen${
                msg.total ===
                1
                  ? ''
                  : 's'
              }...`
            );
          }

          // -----------------------------------------------------------------
          // EXTRACTION ERROR
          // -----------------------------------------------------------------

          if (
            msg.type ===
            'extraction-error'
          ) {
            setBusy(false);

            setBusyLabel('');

            setError(
              msg.error ||
                'Extraction failed.'
            );

            log(
              'assistant',
              `❌ ${
                msg.error ||
                'Extraction failed.'
              }`
            );
          }

          // -----------------------------------------------------------------
          // EXTRACTION COMPLETE
          // -----------------------------------------------------------------

          if (
            msg.type ===
            'screens-extracted'
          ) {
            handleExtracted(
              msg.results ||
                []
            );
          }
        }
      );

    return cleanup;

    // Listener intentionally registered once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===========================================================================
  // RESTORE SESSION
  // ===========================================================================

  async function restoreSavedSession(
    savedSessionId:
      | string
      | null,
    codexAuthenticated =
      false
  ) {
    // -------------------------------------------------------------------------
    // FIRST TIME
    // -------------------------------------------------------------------------

    if (
      !savedSessionId
    ) {
      if (
        codexAuthenticated
      ) {
        console.log(
          '[Design Engineer] Codex auth marker found. Recreating a session without forcing a new Codex device login.'
        );

        try {
          const session =
            await api.createSession();

          const restoredSessionId =
            session.sessionId;

          setSessionId(
            restoredSessionId
          );

          sessionIdRef.current =
            restoredSessionId;

          sendToPlugin({
            type:
              'save-session',

            sessionId:
              restoredSessionId,
          });

          const codexStatus =
            await api.getCodexStatus(
              restoredSessionId
            );

          console.log(
            '[Design Engineer] Restored Codex session status after rehydrating session:',
            codexStatus
          );

          if (
            codexStatus.connected
          ) {
            sendToPlugin({
              type:
                'save-codex-auth',
            });

            setBusy(false);

            setBusyLabel('');

            setStep(
              'github'
            );

            return;
          }
        } catch (
          restoreError
        ) {
          console.error(
            '[Design Engineer] Failed to restore session from Codex marker:',
            restoreError
          );
        }
      }

      console.log(
        '[Design Engineer] No saved session. First launch.'
      );

      setBusy(false);

      setBusyLabel('');

      setStep(
        'signin'
      );

      setMessages([
        {
          role:
            'system',

          text:
            'This is your first login. Sign in to Codex once; the login will be remembered.',
        },
      ]);

      return;
    }

    // -------------------------------------------------------------------------
    // WE HAVE PREVIOUS SESSION
    // -------------------------------------------------------------------------

    console.log(
      '[Design Engineer] Restoring saved session:',
      savedSessionId
    );

    setSessionId(
      savedSessionId
    );

    sessionIdRef.current =
      savedSessionId;

    setBusy(true);

    setBusyLabel(
      'Checking your previous Codex login...'
    );

    try {
      // -----------------------------------------------------------------------
      // CHECK DESIGN ENGINEER SESSION
      // -----------------------------------------------------------------------

      const sessionStatus =
        await api.getSessionStatus(
          savedSessionId
        );

      console.log(
        '[Design Engineer] Session status:',
        sessionStatus
      );

      // -----------------------------------------------------------------------
      // CHECK CODEX CLI AUTH
      // -----------------------------------------------------------------------

      const codexStatus =
        await api.getCodexStatus(
          savedSessionId
        );

      console.log(
        '[Design Engineer] Codex status:',
        codexStatus
      );

      // -----------------------------------------------------------------------
      // CODEX IS ALREADY AUTHENTICATED
      // -----------------------------------------------------------------------

      if (
        codexStatus.connected
      ) {
        sendToPlugin({
          type:
            'save-codex-auth',
        });

        log(
          'assistant',
          `Welcome back${
            codexStatus.codexUser
              ? `, ${codexStatus.codexUser}`
              : ''
          }! Codex is already authenticated.`
        );

        // ---------------------------------------------------------------------
        // GITHUB ALSO CONNECTED
        // ---------------------------------------------------------------------

        if (
          sessionStatus.githubConnected
        ) {
          log(
            'assistant',
            `GitHub is already connected${
              sessionStatus.githubUser
                ? ` as @${sessionStatus.githubUser}`
                : ''
            }. Loading repositories...`
          );

          await loadRepos(
            savedSessionId
          );

          return;
        }

        // ---------------------------------------------------------------------
        // CODEX YES, GITHUB NO
        // ---------------------------------------------------------------------

        setBusy(false);

        setBusyLabel('');

        setStep(
          'github'
        );

        return;
      }

      // -----------------------------------------------------------------------
      // CODEX NOT AUTHENTICATED
      // -----------------------------------------------------------------------

      console.log(
        '[Design Engineer] Codex login is not available.'
      );

      setBusy(false);

      setBusyLabel('');

      setStep(
        'signin'
      );

      setMessages([
        {
          role:
            'system',

          text:
            'Your Design Engineer session exists, but Codex is not authenticated. Please sign in to Codex.',
        },
      ]);
    } catch (error: any) {
      console.error(
        '[Design Engineer] Session restoration failed:',
        error
      );

      setBusy(false);

      setBusyLabel('');

      // -----------------------------------------------------------------------
      // IMPORTANT
      //
      // Do NOT automatically delete the session for every error.
      // -----------------------------------------------------------------------

      if (
        String(
          error?.message ||
            ''
        ).includes(
          '404'
        )
      ) {
        sendToPlugin({
          type:
            'clear-session',
        });

        setSessionId(
          null
        );

        sessionIdRef.current =
          null;
      }

      setStep(
        'signin'
      );
    }
  }

  // ===========================================================================
  // SIGN IN
  // ===========================================================================

  async function handleSignIn() {
    setBusy(true);

    setBusyLabel(
      'Checking Codex authentication...'
    );

    setError(null);

    try {
      // -----------------------------------------------------------------------
      // CHECK EXISTING SESSION FIRST
      // -----------------------------------------------------------------------

      let currentSessionId =
        sessionIdRef.current;

      // -----------------------------------------------------------------------
      // IF SESSION EXISTS, CHECK CODEX BEFORE CREATING LOGIN
      // -----------------------------------------------------------------------

      if (
        currentSessionId
      ) {
        const existingCodex =
          await api.getCodexStatus(
            currentSessionId
          );

        if (
          existingCodex.connected
        ) {
          sendToPlugin({
            type:
              'save-codex-auth',
          });

          log(
            'assistant',
            'Codex is already authenticated. No device code is required.'
          );

          setBusy(false);

          setBusyLabel('');

          setStep(
            'github'
          );

          return;
        }
      }

      // -----------------------------------------------------------------------
      // FIRST EVER LOGIN
      // -----------------------------------------------------------------------

      if (
        !currentSessionId
      ) {
        const session =
          await api.createSession();

        currentSessionId =
          session.sessionId;

        setSessionId(
          currentSessionId
        );

        sessionIdRef.current =
          currentSessionId;

        // Save Design Engineer session
        // inside Figma clientStorage.
        sendToPlugin({
          type:
            'save-session',

          sessionId:
            currentSessionId,
        });
      }

      // -----------------------------------------------------------------------
      // START CODEX DEVICE LOGIN
      // -----------------------------------------------------------------------

      log(
        'user',
        'Sign in to Codex'
      );

      setBusyLabel(
        'Starting Codex login...'
      );

      const device =
        await api.startCodexDeviceAuth(
          currentSessionId
        );

      log(
        'assistant',
        `Enter the device code ${
          device.user_code
        } in the OpenAI authorization page.`
      );

      setBusyLabel(
        `Waiting for Codex authorization: ${
          device.user_code
        }`
      );

      // Open browser.
      window.open(
        device.verification_uri_complete ||
          device.verification_uri,
        '_blank'
      );

      // -----------------------------------------------------------------------
      // POLL
      // -----------------------------------------------------------------------

      if (
        pollRef.current !==
        null
      ) {
        window.clearInterval(
          pollRef.current
        );
      }

      pollRef.current =
        window.setInterval(
          async () => {
            try {
              const status =
                await api.getCodexDeviceStatus(
                  device.device_code
                );

              console.log(
                '[Design Engineer] Codex device status:',
                status
              );

              // ---------------------------------------------------------------
              // APPROVED
              // ---------------------------------------------------------------

              if (
                status.status ===
                'approved'
              ) {
                if (
                  pollRef.current !==
                  null
                ) {
                  window.clearInterval(
                    pollRef.current
                  );

                  pollRef.current =
                    null;
                }

                sendToPlugin({
                  type:
                    'save-codex-auth',
                });

                log(
                  'assistant',
                  `Codex authentication successful${
                    status.codexUser
                      ? ` as ${status.codexUser}`
                      : ''
                  }.`
                );

                setBusy(false);

                setBusyLabel('');

                // IMPORTANT:
                //
                // We do NOT ask for another device code.
                //
                // Codex CLI has stored the
                // authentication in CODEX_HOME.

                setStep(
                  'github'
                );
              }

              // ---------------------------------------------------------------
              // EXPIRED
              // ---------------------------------------------------------------

              if (
                status.status ===
                'expired'
              ) {
                if (
                  pollRef.current !==
                  null
                ) {
                  window.clearInterval(
                    pollRef.current
                  );

                  pollRef.current =
                    null;
                }

                setBusy(false);

                setBusyLabel('');

                setError(
                  'Codex device authentication expired. Please try again.'
                );
              }
            } catch (
              pollingError
            ) {
              console.error(
                '[Design Engineer] Codex polling error:',
                pollingError
              );
            }
          },
          (
            device.interval ||
            3
          ) *
            1000
        );
    } catch (error: any) {
      console.error(
        '[Design Engineer] Codex login failed:',
        error
      );

      setBusy(false);

      setBusyLabel('');

      setError(
        error?.message ||
          'Codex login failed.'
      );
    }
  }

  // ===========================================================================
  // GITHUB
  // ===========================================================================

  function handleConnectGithub() {
    const currentSessionId =
      sessionIdRef.current;

    if (
      !currentSessionId
    ) {
      setError(
        'No active session. Please sign in again.'
      );

      return;
    }

    window.open(
      api.githubAuthUrl(
        currentSessionId
      ),
      '_blank'
    );

    log(
      'user',
      'Connect GitHub'
    );

    log(
      'assistant',
      'GitHub authorization opened in your browser. Waiting for authorization...'
    );

    setBusy(true);

    setBusyLabel(
      'Waiting for GitHub authorization...'
    );

    if (
      pollRef.current !==
      null
    ) {
      window.clearInterval(
        pollRef.current
      );
    }

    pollRef.current =
      window.setInterval(
        async () => {
          try {
            const status =
              await api.getSessionStatus(
                currentSessionId
              );

            if (
              status.githubConnected
            ) {
              if (
                pollRef.current !==
                null
              ) {
                window.clearInterval(
                  pollRef.current
                );

                pollRef.current =
                  null;
              }

              log(
                'assistant',
                `Connected as @${status.githubUser}. Loading repositories...`
              );

              await loadRepos(
                currentSessionId
              );
            }
          } catch (
            pollingError
          ) {
            console.error(
              '[Design Engineer] GitHub polling error:',
              pollingError
            );
          }
        },
        2000
      );
  }

  // ===========================================================================
  // LOAD REPOSITORIES
  // ===========================================================================

  async function loadRepos(
    overrideSessionId?: string
  ) {
    const currentSessionId =
      overrideSessionId ||
      sessionIdRef.current;

    if (
      !currentSessionId
    ) {
      setError(
        'No active session.'
      );

      setBusy(false);

      return;
    }

    setBusy(true);

    setBusyLabel(
      'Loading repositories...'
    );

    try {
      const data =
        await api.listRepos(
          currentSessionId
        );

      setRepos(
        data.repos ||
          []
      );

      setBusy(false);

      setBusyLabel('');

      setStep(
        'repo'
      );
    } catch (error: any) {
      console.error(
        '[Design Engineer] Repository loading failed:',
        error
      );

      setBusy(false);

      setBusyLabel('');

      setError(
        error?.message ||
          'Failed to load repositories.'
      );
    }
  }

  // ===========================================================================
  // REPOSITORY
  // ===========================================================================

  async function handleSelectRepo(
    fullName: string
  ) {
    const currentSessionId =
      sessionIdRef.current;

    if (
      !currentSessionId
    ) {
      setError(
        'No active session.'
      );

      return;
    }

    setSelectedRepo(
      fullName
    );

    selectedRepoRef.current =
      fullName;

    log(
      'user',
      `Repo: ${fullName}`
    );

    setBusy(true);

    setBusyLabel(
      'Loading branches...'
    );

    try {
      const [
        owner,
        repo,
      ] =
        fullName.split('/');

      const data =
        await api.listBranches(
          currentSessionId,
          owner,
          repo
        );

      setBranches(
        data.branches ||
          []
      );

      log(
        'assistant',
        'Pick a branch to work from.'
      );

      setBusy(false);

      setBusyLabel('');

      setStep(
        'branch'
      );
    } catch (error: any) {
      console.error(
        '[Design Engineer] Branch loading failed:',
        error
      );

      setBusy(false);

      setBusyLabel('');

      setError(
        error?.message ||
          'Failed to load branches.'
      );
    }
  }

  // ===========================================================================
  // BRANCH
  // ===========================================================================

  function handleSelectBranch(
    name: string
  ) {
    setSelectedBranch(
      name
    );

    selectedBranchRef.current =
      name;

    log(
      'user',
      `Branch: ${name}`
    );

    log(
      'assistant',
      'Select one or more screens on the Figma canvas, then click Fetch.'
    );

    setStep(
      'screens'
    );
  }

  // ===========================================================================
  // SCREEN CHECKBOX
  // ===========================================================================

  function toggleChecked(
    id: string
  ) {
    setCheckedIds(
      (previous) => {
        const next =
          new Set(
            previous
          );

        if (
          next.has(id)
        ) {
          next.delete(id);
        } else {
          next.add(id);
        }

        return next;
      }
    );
  }

  // ===========================================================================
  // SELECT ALL
  // ===========================================================================

  function selectAllScreens() {
    setCheckedIds(
      new Set(
        selection.map(
          (
            screen
          ) =>
            screen.id
        )
      )
    );
  }

  // ===========================================================================
  // CLEAR
  // ===========================================================================

  function clearScreenSelection() {
    setCheckedIds(
      new Set()
    );
  }

  // ===========================================================================
  // FETCH
  // ===========================================================================

  function handleFetch() {
    const currentSessionId =
      sessionIdRef.current;

    const currentRepo =
      selectedRepoRef.current;

    const currentBranch =
      selectedBranchRef.current;

    if (
      !currentSessionId ||
      !currentRepo ||
      !currentBranch
    ) {
      setError(
        'Session, repository, or branch is missing.'
      );

      return;
    }

    if (
      checkedIds.size ===
      0
    ) {
      setError(
        'Please select at least one screen.'
      );

      return;
    }

    setError(null);

    log(
      'user',
      `Fetch ${
        checkedIds.size
      } screen${
        checkedIds.size >
        1
          ? 's'
          : ''
      }`
    );

    log(
      'assistant',
      `I'll analyze ${
        checkedIds.size
      } selected screen${
        checkedIds.size >
        1
          ? 's'
          : ''
      } and create the Design Context.`
    );

    setBusy(true);

    setBusyLabel(
      `Extracting ${
        checkedIds.size
      } screen${
        checkedIds.size >
        1
          ? 's'
          : ''
      }...`
    );

    // Send ALL selected IDs.
    sendToPlugin({
      type:
        'extract-screens',

      nodeIds:
        Array.from(
          checkedIds
        ),
    });
  }

  // ===========================================================================
  // EXTRACTION COMPLETE
  // ===========================================================================

  async function handleExtracted(
    results: any[]
  ) {
    const currentSessionId =
      sessionIdRef.current;

    const currentRepo =
      selectedRepoRef.current;

    const currentBranch =
      selectedBranchRef.current;

    if (
      !currentSessionId ||
      !currentRepo ||
      !currentBranch
    ) {
      setBusy(false);

      setError(
        'Session, repository, or branch is missing.'
      );

      return;
    }

    if (
      !results ||
      results.length ===
      0
    ) {
      setBusy(false);

      setBusyLabel('');

      setError(
        'No Design Context was returned by Figma.'
      );

      return;
    }

    setBusy(true);

    setBusyLabel(
      `Saving ${
        results.length
      } Design Context file${
        results.length >
        1
          ? 's'
          : ''
      }...`
    );

    try {
      const result =
        await api.submitScreens(
          currentSessionId,
          currentRepo,
          currentBranch,
          results
        );

      const saved =
        result.saved ||
        [];

      let message =
        `✅ Successfully extracted ${
          results.length
        } screen${
          results.length >
          1
            ? 's'
            : ''
        }.\n\n`;

      if (
        saved.length >
        0
      ) {
        message +=
          'Saved files:\n\n';

        message += saved
          .map(
            (
              file
            ) =>
              `✓ ${file}`
          )
          .join(
            '\n'
          );
      }

      log(
        'assistant',
        message
      );

      setCheckedIds(
        new Set()
      );

      setBusy(false);

      setBusyLabel(
        `✓ ${
          results.length
        } screen${
          results.length >
          1
            ? 's'
            : ''
        } saved successfully`
      );

      setStep(
        'done'
      );
    } catch (error: any) {
      console.error(
        '[Design Engineer] Save failed:',
        error
      );

      setBusy(false);

      setBusyLabel('');

      setError(
        error?.message ||
          'Failed to save Design Context.'
      );
    }
  }

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="app">
      {/* =================================================================== */}
      {/* HEADER                                                              */}
      {/* =================================================================== */}

      <header>
        <h1>
          Design Engineer
        </h1>

        {selectedRepo && (
          <div className="subhead">
            {selectedRepo}

            {selectedBranch
              ? ` @ ${selectedBranch}`
              : ''}
          </div>
        )}
      </header>

      {/* =================================================================== */}
      {/* RESTORING                                                           */}
      {/* =================================================================== */}

      {step ===
        'restoring' && (
        <div
          style={{
            padding:
              '16px',
          }}
        >
          <ProgressCard
            label="Checking your previous Codex login..."
          />
        </div>
      )}

      {/* =================================================================== */}
      {/* SCREEN CHIPS                                                        */}
      {/* =================================================================== */}

      {step ===
        'screens' &&
        selection.length >
          0 && (
          <div className="chips">
            {selection.map(
              (
                screen
              ) => (
                <ContextChip
                  key={
                    screen.id
                  }
                  label={
                    screen.name
                  }
                  checked={checkedIds.has(
                    screen.id
                  )}
                  onToggle={() =>
                    toggleChecked(
                      screen.id
                    )
                  }
                />
              )
            )}
          </div>
        )}

      {/* =================================================================== */}
      {/* MULTI SCREEN CONTROLS                                               */}
      {/* =================================================================== */}

      {step ===
        'screens' &&
        selection.length >
          1 && (
          <div
            style={{
              display:
                'flex',

              gap:
                '8px',

              padding:
                '8px 16px',
            }}
          >
            <button
              type="button"
              onClick={
                selectAllScreens
              }
              disabled={
                busy
              }
            >
              Select all
            </button>

            <button
              type="button"
              onClick={
                clearScreenSelection
              }
              disabled={
                busy
              }
            >
              Clear
            </button>
          </div>
        )}

      {/* =================================================================== */}
      {/* CHAT                                                                */}
      {/* =================================================================== */}

      <Chat
        messages={
          messages
        }
      />

      {/* =================================================================== */}
      {/* PROGRESS                                                            */}
      {/* =================================================================== */}

      {busy &&
        busyLabel && (
          <div
            style={{
              padding:
                '0 16px',
            }}
          >
            <ProgressCard
              label={
                busyLabel
              }
            />
          </div>
        )}

      {/* =================================================================== */}
      {/* ERROR                                                               */}
      {/* =================================================================== */}

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {/* =================================================================== */}
      {/* FOOTER                                                              */}
      {/* =================================================================== */}

      <footer>
        {/* ----------------------------------------------------------------- */}
        {/* SIGN IN                                                           */}
        {/* ----------------------------------------------------------------- */}

        {step ===
          'signin' && (
          <button
            className="primary"
            disabled={
              busy
            }
            onClick={
              handleSignIn
            }
          >
            Sign in to Codex
          </button>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* GITHUB                                                            */}
        {/* ----------------------------------------------------------------- */}

        {step ===
          'github' && (
          <button
            className="primary"
            disabled={
              busy
            }
            onClick={
              handleConnectGithub
            }
          >
            Continue with GitHub
          </button>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* REPOSITORY                                                        */}
        {/* ----------------------------------------------------------------- */}

        {step ===
          'repo' && (
          <select
            disabled={
              busy
            }
            defaultValue=""
            onChange={(
              event
            ) => {
              const value =
                event.target
                  .value;

              if (value) {
                handleSelectRepo(
                  value
                );
              }
            }}
          >
            <option
              value=""
              disabled
            >
              Choose a repository...
            </option>

            {repos.map(
              (
                repo
              ) => (
                <option
                  key={
                    repo.fullName
                  }
                  value={
                    repo.fullName
                  }
                >
                  {
                    repo.fullName
                  }

                  {repo.private
                    ? ' (private)'
                    : ''}
                </option>
              )
            )}
          </select>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* BRANCH                                                            */}
        {/* ----------------------------------------------------------------- */}

        {step ===
          'branch' && (
          <select
            disabled={
              busy
            }
            defaultValue=""
            onChange={(
              event
            ) => {
              const value =
                event.target
                  .value;

              if (value) {
                handleSelectBranch(
                  value
                );
              }
            }}
          >
            <option
              value=""
              disabled
            >
              Choose a branch...
            </option>

            {branches.map(
              (
                branch
              ) => (
                <option
                  key={
                    branch.name
                  }
                  value={
                    branch.name
                  }
                >
                  {
                    branch.name
                  }
                </option>
              )
            )}
          </select>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* FETCH                                                             */}
        {/* ----------------------------------------------------------------- */}

        {step ===
          'screens' && (
          <button
            className="primary"
            disabled={
              busy ||
              checkedIds.size ===
                0
            }
            onClick={
              handleFetch
            }
          >
            {checkedIds.size >
            0
              ? `Fetch (${checkedIds.size})`
              : 'Select screens'}
          </button>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* DONE                                                              */}
        {/* ----------------------------------------------------------------- */}

        {step ===
          'done' && (
          <button
            className="primary"
            onClick={() => {
              setStep(
                'screens'
              );

              setBusyLabel('');

              setError(null);
            }}
          >
            Select more screens
          </button>
        )}
      </footer>

      {/* =================================================================== */}
      {/* COMPOSER                                                            */}
      {/* =================================================================== */}

      {step ===
        'done' && (
        <Composer
          onSend={() => {}}
          disabled
        />
      )}
    </div>
  );
}