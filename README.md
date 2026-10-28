# Design Engineer — Phase 1 (Supabase edition)

Design Engineer is a Figma plugin plus a Node backend that turns Figma
screens into **Design Context** JSON and (Phase 2) implements those screens
as **React Native or React JS** code in a GitHub repo, opened as a pull
request — the stack is chosen per project.

Phase 1 scope:

1. Import the plugin into Figma.
2. **Create an account / sign in** (Supabase Auth) with email + password or
   **Continue with Google**; log out and switch accounts anytime.
3. Dashboard shows your **projects** and **connections** (GitHub, Codex).
4. Create a project → connect **GitHub** (OAuth, token stored encrypted in
   Supabase) → connect **Codex** (CLI device login, credentials stored
   encrypted in Supabase).
5. Choose a **repo** and a **branch**.
6. **Select screens** (frames) on the canvas.
7. Hit **Fetch** → the plugin extracts each screen's metadata + a screenshot,
   normalizes it into the **Design Context** format, and sends it to the
   backend, which stores it in Supabase.

> **Phase 1 has no subscription or payment gating.** Every account can create
> unlimited projects and fetch unlimited screens. The `plans`,
> `user_subscriptions`, and `payments` tables stay in Supabase for a later
> phase, but the backend and plugin do not use them.

There are two folders:

```
design-engineer-plugin/    ← the Figma plugin (TypeScript + React)
design-engineer-backend/   ← the Node/Express backend it talks to
```

The plugin never talks to GitHub or Supabase directly — it only talks to the
backend on `https://design-engineer.onrender.com`. The backend holds the GitHub OAuth
**client secret** (`.env`, never exposed to the plugin) and talks to Supabase
with the user's own JWT, so row-level security keeps every user on their own
rows.

### Where everything lives now

| Piece | Location |
|---|---|
| User accounts / sessions | Supabase **Auth** (`auth.users`), built-in |
| User profile | `public.profiles` |
| Projects (repo, base branch) | `public.projects` |
| GitHub OAuth tokens (encrypted) | `public.github_connections` |
| Codex CLI credentials (encrypted) | `public.codex_accounts` |
| Fetched design contexts (JSON) | `public.design_contexts` |
| Plugin session (access/refresh token) | Figma `clientStorage` (GitHub/Codex credentials never touch Figma storage) |

Nothing that used to live in Docker volumes / in-memory sessions is there
anymore. **Everything is in Supabase**, so a backend restart or a rebuilt
container no longer logs you out or loses connections.

---

## 1. Prerequisites

- **Node.js 18+** (needed for global `fetch` in the backend) and npm.
- **Figma desktop app** (plugin development requires the desktop app, not
  the browser).
- A **Supabase project** (free) — see §2.
- A **GitHub OAuth App** (free, 2 minutes) — see §3.

---

## 2. Set up Supabase

1. Create a project at <https://supabase.com> (free tier is fine).
2. Open **SQL Editor** → **New query**, paste the contents of
   `design-engineer-backend/supabase/schema.sql`, and **Run**.

   This creates `profiles`, `projects`, `github_connections`,
   `codex_accounts`, and `design_contexts` (idempotent — safe to re-run), the
   row-level-security policies, a trigger that auto-creates a profile row on
   signup, and `updated_at` triggers.

   > If you already ran an earlier version of the schema, re-run the current
   > `schema.sql` — it adds missing tables/columns (e.g. `design_contexts`,
   > `projects.repository`, `projects.base_branch`) without touching data.

3. Optional but recommended: in **Authentication → Providers → Email**,
   turn **off "Confirm email"** so signups can sign in immediately. If you
   leave it on, the plugin still works — it just shows "Check your email to
   confirm" and waits for you to confirm before signing in.
4. If you want **"Continue with Google"** in the plugin, enable
   **Authentication → Providers → Google**, create a Google OAuth client for
   your Supabase project (Web application), and set the authorized redirect
   URI to `{SUPABASE_URL}/auth/v1/callback`. Then add the backend callback to
   **Authentication → URL Configuration → Redirect URLs** — add
   `https://design-engineer.onrender.com/**` (or your deployed `BACKEND_URL` + `/**`) so
   Supabase is allowed to redirect back after Google auth. The plugin then
   offers Google sign-in/account creation alongside email + password. Users
   can log out and sign in with a different Google account anytime.
5. Copy the project **URL** (e.g. `https://xxxx.supabase.co`) and the
   **anon / publishable key** from **Settings → API** — these go in the
   backend's `.env` (§4). The Supabase keys live only in the backend;
   the plugin never sees them.

---

## 3. Create a GitHub OAuth App

1. Go to <https://github.com/settings/developers> → **New OAuth App**.
2. Fill in:
   - **Application name**: `Design Engineer`
   - **Homepage URL**: `https://design-engineer.onrender.com`
   - **Authorization callback URL**: `https://design-engineer.onrender.com/auth/github/callback`
3. Click **Register application**, then **Generate a new client secret**.
4. Copy the **Client ID** and **Client Secret** — these go in the backend's
   `.env` (§4). The secret stays in `.env`; it is never sent to the plugin.

The callback URL registered in GitHub must exactly match
`<BACKEND_URL>/auth/github/callback`. For the deployed backend use
`https://design-engineer.onrender.com/auth/github/callback` and ensure the `.env` Client ID
and Client Secret belong to this OAuth app. A GitHub OAuth App has one callback
URL; use a separate OAuth app for local and deployed backends if both are
needed.

---

## 4. Run the backend (local) or deploy it

The plugin defaults to the deployed backend at
`https://design-engineer.onrender.com`. To run the backend locally instead,
set `BACKEND_URL=http://localhost:4000` in `.env` and add
`http://localhost:4000` to `design-engineer-plugin/manifest.json`.

```bash
cd design-engineer-backend
npm install
cp .env.example .env
# edit .env:
#   - SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY  (from §2)
#   - GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET  (from §3)
#   - ENCRYPTION_KEY (optional; 64 hex chars, e.g. `openssl rand -hex 32`.
#     If empty, a stable key is derived from SUPABASE_URL|GITHUB_CLIENT_SECRET|PORT)
npm start
```

You should see:

```
Design Engineer backend listening on https://design-engineer.onrender.com
```

Leave this running in a terminal tab.

### Docker (optional)

The Dockerfile still works; `git` and the Codex CLI are installed in the
image. Because all state is in Supabase, you no longer need persistent
volumes — the container itself can be thrown away:

```bash
cd design-engineer-backend
docker build -t design-engineer-backend .
docker run --rm -p 4000:4000 --env-file .env design-engineer-backend
```

---

## 5. Build the plugin

```bash
cd design-engineer-plugin
npm install
npm run watch   # rebuilds dist/ on every save; use `npm run build` for a one-off build
```

This produces `dist/code.js` and `dist/ui.html`.

---

## 6. Load the plugin in Figma

1. Open the **Figma desktop app**.
2. Open or create any file.
3. Menu → **Plugins** → **Development** → **Import plugin from manifest…**
4. Select `design-engineer-plugin/manifest.json`.
5. It now shows up under **Plugins → Development → Design Engineer**.

Run it any time from that same menu. To see console logs/errors from the
plugin (both the UI and the sandbox thread), use **Plugins → Development →
Open Console**.

---

## 7. End-to-end test walkthrough

Use (or create) a Figma file with at least one frame you can pretend is a
screen, e.g. name a frame `Product Details`.

1. **Run the plugin.** You'll see the account screen: *"Continue with Google"*
   or *"Create an account with email"* / *"I already have an account"*.
2. **Sign in any way you like:**
   - **Continue with Google** — a browser tab opens, you pick the Google
     account (you can switch accounts any time). The resulting session is
     stored in Supabase and saved back into Figma, so next time the plugin
     opens you're signed straight in.
   - **Create an account** (email + password, password ≥ 8 chars, confirm
     match) or **sign in** if you already have one.
     - If Supabase email confirmation is enabled, you'll be told to check your
       email, then sign in.
3. Connect **Codex** in the plugin. When the backend runs locally it opens
   OpenAI's browser sign-in and continues automatically after authorization.
   When the backend is deployed (for example on Render), the plugin shows a
   one-time device code and opens the OpenAI sign-in page; enter the code there
   and the plugin continues automatically. Codex is universal per Design
   Engineer account.
4. Connect **GitHub** in the plugin. Authorize the app in the browser; the
   plugin detects the connection automatically. Use **Switch GitHub account**
   to connect a different GitHub account, or use the **Account** menu to log
   out of Design Engineer.
5. After both connections are ready, choose an existing project or click
   **Create project** and enter a name. Projects are saved to your Design
   Engineer account and can be selected again later.
6. Select the GitHub repository and branch for the project. The repository
   and branch are saved on that project. Use the Back buttons to revisit
   previous setup steps.
7. Chat log shows *"Now select one or more screens..."*. **Click a frame on
    the canvas** (e.g. your `Product Details` frame). Selected frames are
    automatically checked — the **Fetch (N)** button updates immediately, no
    need to tap each chip's `+`. (Chips at the top still toggle individually if
    you want to exclude one, and **Clear** resets the list.)
8. Click **Fetch (N)**. You'll see progress messages ("Reading layers for...",
   "Capturing screenshot of..."), then *"Uploading design context to
   backend..."*, then a confirmation.
9. After the Design Context is saved, the plugin automatically asks the backend
   to build a read-only plan from the saved Design Contexts: a per-screen
   breakdown (size, page, node/text/image/component counts), the exact
   step-by-step of how Codex will write the code (branch, structure, navigation,
   tests), and the exact prompt that will be sent. **No code is written and no
   PR is raised at this step.**
10. Review the plan, then click **Start implement** (appears only after the
    plan is generated) → the backend clones the repo/branch into a temporary
    worktree, runs the authenticated Codex CLI (instructed to follow the chosen
    React Native or React JS folder structure), appends test steps to
    `README.md`, commits, pushes an `implement/<frame>-<timestamp>` branch, and
    opens a **pull request**. All selected screens are implemented together in
    one branch/PR, which the plugin displays when the job finishes.

### Verify the output

Fetched contexts are in `public.design_contexts` in Supabase (one row per
project + screen name). You can inspect them in the Supabase dashboard's
**Table Editor**, or query:

```sql
select screen_name, jsonb_pretty(content) from public.design_contexts;
```

The JSON looks like:

```json
{
  "screen": "Product Details",
  "width": 390,
  "height": 844,
  "elements": [
    {
      "type": "text",
      "name": "Product title",
      "text": "Rubber Hose",
      "fontSize": 24,
      "x": 24,
      "y": 96,
      "width": 200,
      "height": 32
    },
    {
      "type": "button",
      "name": "Add to cart",
      "width": 342,
      "height": 52,
      "radius": 12,
      "x": 24,
      "y": 740
    }
  ]
}
```

(Field set is a superset of the brief's example — `x`/`y`/colors/strokes
etc. are included since Codex will need positioning and styling info too.)

---

## 8. How the backend implements a screen (Phase 2)

`POST /api/screens/plan` first builds a read-only implementation plan from the
saved Design Contexts (per-screen summary + the exact Codex steps and prompt).
It writes no code and raises no PR.

`POST /api/screens/implement` runs for your selected screens (the plugin shows
it only after a plan has been generated):

1. Reads each screen's Design Context from `design_contexts` (not from disk).
2. Clones the project's repository + base branch into a temporary worktree.
3. Writes each screen's JSON into a temporary `.design-engineer/context` file.
4. Restores the account's Codex credentials into `CODEX_HOME` from
   `codex_accounts` (the first `codex login` still happens via the CLI's
   device flow; on approval the resulting `auth.json`/`config.toml` are
   encrypted and stored in Supabase, then restored per user when needed).
5. Runs the authenticated Codex CLI in the worktree. Codex reads the repo
   README and existing source tree, then follows the repository's current
   folder structure using the **stack the user chose on the project**
   (`projects.stack` — `react-native` or `react-js`): `src/screens`,
   `src/components`, `src/navigation` for React Native; `src/pages`,
   `src/components`, `src/routes` for React JS (Vite).
6. Removes the temporary context file, appends test steps to `README.md`,
   and commits the implementation.
7. Creates a branch `implement/<frame-name>-<timestamp>`, pushes it, and
   opens a GitHub pull request against the selected base branch.

The backend must run where `git` is installed (it is, in the Docker image).

---

## 9. Notes / gotchas

- **`networkAccess.allowedDomains`** in `manifest.json` is currently
  `https://design-engineer.onrender.com`. If you deploy the backend anywhere else, add
  that domain here too, or the plugin's `fetch()` calls will be blocked
  by Figma.
- **Why polling instead of a direct callback into the plugin?** The Figma
  plugin UI is a sandboxed iframe; a separate browser tab can't
  `postMessage` into it directly. Polling the backend endpoints is the
  standard workaround other Figma plugins use for OAuth.
- **Email confirmation**: if signup returns `confirmationRequired`, the
  plugin shows the sign-in screen with a note. Disable "Confirm email" in
  Supabase (Authentication → Providers → Email) for instant signups.
- **Google sign-in**: optional. Enable **Authentication → Providers →
  Google** in Supabase and point the Google OAuth redirect URI at
  `{SUPABASE_URL}/auth/v1/callback`. The plugin then shows a **Continue with
  Google** button on the account screen; the resulting session is stored like
  the email/password session. **Log out** in the dashboard revokes the
  Supabase session server-side so a different Google account can sign in.
- **Project and repository selection**: create or choose a project and select
  its GitHub repository on the same screen, then choose a branch.
- **Project stack**: every project stores a `stack` column (`react-native` or
  `react-js`). Choose it after selecting the branch; the backend passes it to
  Codex so generated code follows the matching folder structure.
- **RLS**: all backend DB access uses your access token as the PostgREST
  JWT, so users can only read/write their own rows (`profiles` is keyed to
  `auth.uid()`, other tables to `user_id`). The `design_contexts` table is
  scoped via the owning project.
- **GitHub OAuth state** uses a short-lived (10-minute) in-memory map —
  standard cross-request OAuth bookkeeping, not user data.
- **Encryption**: GitHub tokens and Codex credentials are AES-256-GCM
  encrypted at rest with a key from `ENCRYPTION_KEY` (64 hex chars) or a
  stable fallback derived from `.env` values.
- **Component detection**: for a Figma `INSTANCE`, the plugin resolves
  `getMainComponentAsync()` to record which component it's an instance of —
  useful later for mapping to your design system's real components.
- **Codex account switching** is account-wide: `codex_accounts` is `UNIQUE`
  on `user_id`, so an account has exactly one Codex connection at a time.