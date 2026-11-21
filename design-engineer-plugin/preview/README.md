# Design Engineer (Preview)

Runs the flow-revamp UI (branch `design-engineer-flow-revamp-09`) **next to** the
live plugin. It has its own plugin id and its own `dist/` folder, so it never
replaces the published plugin or its saved session.

## Build

```bash
cd design-engineer-plugin
npm ci
DESIGN_ENGINEER_API_URL=https://design-engineer-containers-v05.hariprasad0919.workers.dev npm run build:preview
```

The output goes to `preview/dist/` (ignored by git).

## Run in Figma

Figma desktop app → Plugins → Development → **Import plugin from manifest…** →
choose `design-engineer-plugin/preview/manifest.json`. It shows up as
"Design Engineer (Preview)".

## What works before the backend is updated

The Preview works against today's backend. Until migration `011_flow_revamp.sql`
is applied and the backend from this branch is deployed:

- a project has one repo + branch (the "+ Link another" button is hidden),
- the AI model is remembered in Figma on this computer,
- builds are listed from the minutes history,
- builds are charged by run time only (no 10 s buffer is shown or charged).

After the backend update, the same Preview build picks up multiple repo links,
the per-account model, per-project builds and the 10 s server-start charge.
