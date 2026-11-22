# Fidelity Engine (deployment 10)

Every build now measures how exactly the generated app reproduces the Figma
screens it came from, and reports one score out of 100 in the plugin and in
the pull request. The source of truth is the Figma file itself: the plugin
already has every node's position, size, styles, prototype links and
transitions, so the check doesn't need to trust the code generator.

## How it works

```
Figma plugin                    Build container (one per job)
────────────                    ─────────────────────────────────────────────
Fetch screens                   1. Agent writes the code (prompt now includes the
  · design context v3              "fidelity contract": tag nodes, routes, motion)
    (origin, text styles,       2. Copy the repo → install → web build
     interactions, transitions,    (as the isolated agent user, no secrets)
     parent links, rootId)      3. Serve the build read-only on 127.0.0.1
  · Figma PNG export of each    4. Chromium at each frame's exact size:
    frame (1x)                     · read every [data-fid] / testID="fid:…" element
        │                          · compare with the Figma node: box, styles
        ▼                          · screenshot vs Figma export (SSIM + heatmap)
design_contexts                    · click every prototype link, sample the
  .content        ─────────────►     transition each frame (duration + easing)
  .reference_png                   · resize to two other widths (overflow, clipping)
                                5. Score < target (90)? Give the agent the worst
                                   30 problems and measure again (1 round, if
                                   at least 5 min of build time is left)
                                6. Commit, push, PR with a "Design fidelity" section
                                7. Job result → plugin shows the score card
```

The generated code is matched to Figma by **node ID**: the agent tags what it
renders with `data-fid="12:345"` (web) or `testID="fid:12:345"` (React
Native; react-native-web renders it as `data-testid`). It also writes
`design-engineer.fidelity.json` with the route of each screen, which is
committed, so the check can be re-run later.

## Who sees what

| | Every account | Admin account (yours) |
| --- | --- | --- |
| Check and repair round run on the build | Yes | Yes |
| Preview of the built screens, tap to enlarge | Yes | Yes |
| Open pull request | Yes | Yes |
| Score card, layer bars, issues, heatmaps | No | Yes |
| "% match" on recent builds | No | Yes |
| "Design fidelity" section in the PR description | No | Yes |

Admin is decided on the server from the verified sign-in, with
`ADMIN_EMAILS` (comma-separated) or `ADMIN_USER_IDS`; nobody is admin when
neither is set. `GET /api/jobs/:id` and `GET /api/projects/:id/builds` shape
the stored result for the account asking
(`services/fidelity/report.resultForViewer`), so a normal account never
receives the report. The plugin just shows what it gets. (The full result is
still stored on the user's own job row in Supabase.)

The preview images are the screenshots the check takes of the final build at
each frame's size (phone frames at 1x, wide frames scaled to 480 px), so a
preview exists whenever the check ran, even without a Figma reference image.

## The score

| Layer | Weight | What it measures |
| --- | --- | --- |
| Layout | 30 | Each visible Figma layer is in the page, at the right x/y (±2 px full marks, 0 at 24 px off) and size (±2 px or 3 %). Missing layers score 0. Text is compared by its line boxes, so a text box measures the same in Figma and the browser. |
| Visual | 20 | SSIM between the rendered screen and the Figma export, over 8×8 blocks that have something on them (empty background would otherwise hide every difference). Full marks from 0.92. |
| Styles | 15 | Fill and text colour (ΔE), font family (and whether it actually loaded), size, weight, line height, letter spacing, corner radius, border, opacity. |
| Prototype | 15 | Each ON_CLICK / ON_PRESS / AFTER_TIMEOUT link opens the right screen; BACK returns; URL links point to the right address. |
| Motion | 10 | For links with a transition: measured duration (full marks within 20 %) and how closely the movement follows the Figma easing curve. An instant change where Figma animates scores 0. |
| Responsive | 10 | At two other widths (360/430 for phones) the page doesn't scroll sideways or cut text off. |

Layers that can't be measured for a build (no prototype links, no reference
image) are left out and the rest re-weighted. Grades: 95+ exact, 85+ close,
70+ needs work, below that off.

Calibration on the test fixture: a faithful build scores 99.9 even when the
reference is rasterised differently (2× export downsampled); a build with
typical mistakes (8 px offset, wrong colour and size, untagged button,
missing transition, fixed widths) scores about 45 and every mistake is named.

## Where things are

| Piece | File |
| --- | --- |
| Extraction (v3 context, interactions, reference PNG) | `design-engineer-plugin/src/figma/parser.ts`, `screenshot.ts`, `src/code.ts` |
| Engine | `design-engineer-backend/services/fidelity/` (`spec`, `browser`, `score`, `image`, `motion`, `app`, `check`, `report`, `index`) |
| Pipeline | `server.js`: prompt contract, `checkWithRepair` after the agent, PR section, `result.fidelity` |
| Storage | `supabase/012_fidelity.sql`: `design_contexts.reference_png`, `reference_scale` |
| Plugin UI | `src/ui/components/Preview.tsx` (everyone), `Fidelity.tsx` (admin card), score tag in recent builds |
| Roles | `design-engineer-backend/services/admin.js` |
| Container | `cloudflare/Dockerfile`: Playwright Chromium in `/ms-playwright` |

## Settings (env)

| Variable | Default | |
| --- | --- | --- |
| `ADMIN_EMAILS` | none | Accounts that see the full report (comma-separated) |
| `ADMIN_USER_IDS` | none | Same, by Supabase user ID |
| `FIDELITY_CHECK` | on | `0` turns the check off (no preview either) |
| `FIDELITY_TARGET` | 90 | Score that skips the repair round |
| `FIDELITY_REPAIR_ROUNDS` | 1 | 0 to 3 |
| `FIDELITY_REPAIR_MIN_MS` | 300000 | Build time that must be left to start a repair round |
| `FIDELITY_JOB_BUDGET_MS` | 840000 | Total build time the check plans around (the build holds 15 min) |
| `FIDELITY_CHECK_BUDGET_MS` | 300000 | Max time for one check (install + build + browser) |
| `FIDELITY_CHROMIUM_PATH` | Playwright's | Use another Chrome/Chromium |

## Safety

- The check works on a **copy** of the repository; nothing it installs or
  builds can reach the pull request.
- Install and build run as the isolated agent user with only `PATH`, a
  scratch `HOME` and network/proxy settings, never the server's secrets.
- The static server only serves files inside the build output (no symlinks
  out, no `..`). The page may load only its own origin and public `https`
  resources; localhost, private ranges and metadata hosts are blocked.
- The check never fails a build: if it can't run, the result says
  "not measured" with the reason and the PR opens as before.
- The Figma export is stored beside the design context, never inside it, so
  the coding agent doesn't read a large image as text.

## Deploy

1. Apply `supabase/012_fidelity.sql` (additive; already in `schema.sql`).
   Set `ADMIN_EMAILS` to your sign-in email in the server secrets.
2. Rebuild the container image (`npm run deploy` in `cloudflare/`): the
   Dockerfile now installs Chromium. The image grows by about 400 MB.
3. Publish the plugin build. Screens fetched with an older plugin still work:
   positions are estimated and the report suggests fetching again.

## Tests

```
cd design-engineer-backend && FIDELITY_CHROMIUM_PATH=/usr/bin/google-chrome npm test
cd design-engineer-plugin  && npm run build:preview && E2E_CHROMIUM_PATH=/usr/bin/google-chrome npm run test:e2e
```

`tests/fidelity-runner.test.js` renders a faithful and a sloppy build of the
same two screens in real Chromium, and runs the repair loop with a fake agent.
Also verified by hand: a real Vite project (install + build + check, 16 s)
and a real Expo app exported to the web (testID tagging, 53 s, 99.8).

## Not covered yet

- Hover / pressed variants (`ON_HOVER`, `CHANGE_TO`), drag and scroll-to
  links are reported as "not checked".
- Native-only rendering (iOS/Android) is measured through the web build;
  native differences need a device runner.
- Spring easings are scored on duration only.
