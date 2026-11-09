# Design Engineer — Cloudflare Workers Paid + Containers (Deployment 05)

This branch targets **Cloudflare Workers Paid ($5/month base) with Containers**.

**Read the complete deployment guide:** [PAID_DEPLOYMENT.md](./PAID_DEPLOYMENT.md)

Run from `cloudflare/`:

```powershell
npm install
npx wrangler login
npm run deploy
```

The deployment script stages backend code, builds and pushes the Cloudflare
Container image, and deploys the Worker. Configuration requires eight
Cloudflare Worker secrets; use `scripts/upload-secrets.ps1` after setting
the **staging** `design-engineer-backend/.env`.

Cloudflare usage may cost more than $5/month. This is a staging-ready
deployment, **not yet a multi-tenant production release**; see the guide's
security, job isolation, restart recovery and cost limitations. Deployment 04
remains unchanged.
