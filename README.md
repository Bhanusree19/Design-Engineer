# Design Engineer — Phase 1

Phase 1 scope, exactly as specced:

1. Import the plugin into Figma.
2. Plugin asks for **Codex sign-in**.
3. Plugin asks for **GitHub authentication**.
4. Plugin asks you to **choose a repo**, then a **branch**.
5. Plugin lets you **select screens** (frames) on the canvas.
6. Hit **Fetch** → the plugin extracts each screen's metadata + a screenshot,
   normalizes it into the **Design Context** format, and sends it to the
   backend, which writes it to disk.

There are two folders:

```
design-engineer-plugin/    ← the Figma plugin (TypeScript + React)
design-engineer-backend/   ← the Node/Express backend it talks to
```

The plugin never talks to GitHub directly — it only ever talks to the
backend, and the backend holds the real GitHub OAuth token. The `screen ->
JSON` normalization happens in the plugin (`src/figma/parser.ts`) before
anything leaves Figma, exactly as you specced ("don't send raw Figma data
directly to Codex").

---

## 1. Prerequisites

- **Node.js 18+** (needed for global `fetch` in the backend) and npm.
- **Figma desktop app** (plugin development requires the desktop app, not
  the browser).
- A **GitHub OAuth App** (free, takes 2 minutes — see below).

---

## 2. Create a GitHub OAuth App

1. Go to <https://github.com/settings/developers> → **New OAuth App**.
2. Fill in:
   - **Application name**: `Design Engineer (local)`
   - **Homepage URL**: `http://localhost:4001`
   - **Authorization callback URL**: `http://localhost:4001/auth/github/callback`
3. Click **Register application**, then **Generate a new client secret**.
4. Copy the **Client ID** and **Client Secret** — you'll paste these into
   the backend's `.env` in the next step.

---

## 3. Run the backend

```bash
cd design-engineer-backend
npm install
cp .env.example .env
# edit .env and paste in GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
npm start
```

You should see:

```
Design Engineer backend listening on http://localhost:4001
```

Leave this running in a terminal tab.

---

## 4. Build the plugin

```bash
cd design-engineer-plugin
npm install
npm run watch   # rebuilds dist/ on every save; use `npm run build` for a one-off build
```

This produces `dist/code.js` and `dist/ui.html`.

---

## 5. Load the plugin in Figma

1. Open the **Figma desktop app**.
2. Open or create any file.
3. Menu → **Plugins** → **Development** → **Import plugin from manifest…**
4. Select `design-engineer-plugin/manifest.json`.
5. It now shows up under **Plugins → Development → Design Engineer**.

Run it any time from that same menu. To see console logs/errors from the
plugin (both the UI and the sandbox thread), use **Plugins → Development →
Open Console**.

---

## 6. End-to-end test walkthrough

Use (or create) a Figma file with at least one frame you can pretend is a
screen, e.g. name a frame `Product Details`.

1. **Run the plugin.** You'll see: *"Sign in to start..."* and a
   **Sign in to Design Engineer** button.
2. Click it → this calls `POST /auth/session` on the backend and gets a
   session id. Chat log shows *"Signed in. Now connect your GitHub
   account..."*.
3. Click **Continue with GitHub** → a browser tab opens to
   `http://localhost:4000/auth/github?session=...`, which redirects to
   GitHub's OAuth screen. Authorize the app.
4. GitHub redirects back to `/auth/github/callback`, which shows
   *"GitHub connected ✅"*. **Close that tab** and go back to Figma —
   the plugin is polling every 2s and will pick up the connection
   automatically.
5. Chat log shows *"Connected as @yourhandle. Loading your
   repositories..."*, then a **Choose a repository...** dropdown appears.
   Pick one.
6. A **Choose a branch...** dropdown appears. Pick one.
7. Chat log shows *"Now select one or more screens..."*. **Click a frame
   on the canvas** (e.g. your `Product Details` frame). A chip for it
   appears at the top of the plugin — click the chip to check it (shown
   with a border + `×`).
8. Click **Fetch (1)**. You'll see progress messages ("Reading layers
   for...", "Capturing screenshot of..."), then *"Uploading design
   context to backend..."*, then a confirmation listing the saved file
   paths.

### Verify the output

```bash
cd design-engineer-backend
find data -type f
cat data/<your-github-user>/<repo>__/<branch>/Product_Details.json
```

You should see something matching the format from the brief:

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

A matching `Product_Details.png` (2x scale screenshot of the frame) is
saved alongside it.

---

## 7. What's real vs. placeholder in this phase

| Piece | Status |
|---|---|
| GitHub OAuth (login, repo list, branch list) | **Real** — actual GitHub API calls. |
| "Codex sign-in" | **Placeholder.** It just mints a session id on the backend (`POST /auth/session`). Swap the body of that route (and `handleSignIn` in `App.tsx`) for your real product auth once it's defined — nothing downstream needs to change, everything else just keys off `sessionId`. |
| Figma extraction (metadata + screenshot) | **Real** — walks the actual node tree via the Figma Plugin API. |
| Design Context normalization | **Real**, but the `classify()` heuristic in `src/figma/parser.ts` (deciding text vs. button vs. component vs. generic frame) is intentionally simple — tune it as you see real screens come through. |
| Storage | **Real but local** — writes JSON + PNG to `design-engineer-backend/data/`. Swap for a DB/S3 when you're ready. |
| Session store | **In-memory** (a `Map`). Fine for local dev; restarting the backend clears all sessions — you'll need to sign in again. |

---

## 8. Notes / gotchas

- **`networkAccess.allowedDomains`** in `manifest.json` is currently
  `http://localhost:4000`. If you deploy the backend anywhere else, add
  that domain here too, or the plugin's `fetch()` calls will be blocked
  by Figma.
- **Why polling instead of a direct callback into the plugin?** The Figma
  plugin UI is a sandboxed iframe; a separate browser tab can't
  `postMessage` into it directly. Polling `GET /auth/session/:id` is the
  standard workaround other Figma plugins use for OAuth.
- **Component detection**: for a Figma `INSTANCE`, we resolve
  `getMainComponentAsync()` to record which component it's an instance
  of — useful later for mapping to your design system's real components.
- The `Chat`, `Composer`, `ApprovalCard`, and `ProgressCard` UI pieces are
  scaffolded per your file tree, but Phase 1 only actively uses `Chat` and
  `ProgressCard` for the wizard flow. `Composer` and `ApprovalCard` are
  wired but idle — reserved for Phase 2, where you'll likely want
  free-form chat with Codex and approval gates before it writes code.


Docker building comments: docker build -t design-engineer-backend . 

docker run -p 4000:4000 design-engineer-backend 