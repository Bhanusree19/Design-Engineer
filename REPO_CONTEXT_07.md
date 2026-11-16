# Deployment 07 — repository context and automatic stack

**Branch:** `design-engineer-repo-context-07`, built on
`design-engineer-subscriptions-minutes-razorpay-06b`.

## What it does

When a user picks a repository and branch in the plugin, the backend reads
that branch through the GitHub API (no clone, usually 2–7 API calls) and
stores what it finds on the project as `projects.repo_context`.

| Branch contains | What the plugin does |
| --- | --- |
| An Expo / React Native app | Sets the stack to React Native and goes straight to the agent step |
| A React web app (Vite, Next.js, CRA, Remix, Gatsby) | Sets the stack to React JS and goes straight to the agent step |
| Both a mobile and a web app | Shows both and asks which one |
| Nothing, or only a README | Asks the user to choose a stack (as before) |
| Vue, Angular, Svelte, Flutter, native iOS/Android | Explains it and asks the user to choose |
| GitHub not reachable | Falls back to asking, with a short message |

It also records the language (TypeScript or JavaScript), package manager,
styling (NativeWind, Tailwind, styled-components, CSS Modules, StyleSheet…),
UI library (shadcn/ui, MUI, React Native Paper, Tamagui…), navigation (Expo
Router, React Navigation, React Router, Next.js routers), state and test
tools, theme/token files, and the existing component names.

That context is added to the plan and to the coding agent's prompt, telling it
to reuse the existing components, keep the same styling and register screens
in the existing navigation. The agent is told to trust the files if they
disagree with the detection.

The user can still change a detected stack from the agent step ("Change").
Picking a stack that doesn't match the existing app shows a warning that the
agent would add a second app. A stack the user picks is stored as
`stack_source = 'user'` and is never overwritten by later detection.

## Setup

Run in Supabase (after 008 and 009):

`design-engineer-backend/supabase/010_repo_context.sql`

It adds `projects.repo_context` (jsonb) and `projects.stack_source`, and marks
existing projects' stacks as user-chosen. Safe to re-run. The backend's
project update now writes these columns, so **run 010 before deploying this
backend**.

## Code

- `design-engineer-backend/services/repo-context.js` — detection
  (`detectContext` is pure and unit tested; `analyzeRepository` does the
  GitHub calls; `contextPromptLines` builds the prompt block from
  allow-listed values only, so repository text cannot steer the agent).
- `POST /api/projects/:id/repo-context` — analyse, store, auto-set stack.
- Plugin: branch step shows "Reading the repository"; new
  `RepoContextCard`; Stack step explains detections and warns on conflicts.
- Tests: `tests/repo-context.test.js` (10 cases: Expo, RN CLI, Vite+MUI,
  Next+shadcn, monorepo, mobile+web, empty/unsupported, unsafe names, GitHub
  empty/missing/expired responses).
