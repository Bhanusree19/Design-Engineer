# Cloudflare Deployment 04 staging scaffold

This is NOT the production architecture. It runs the existing Express API
inside a single Cloudflare Container behind a Worker. It is useful for
evaluating container startup, backend routing, CLI installation and OAuth
configuration, but it is NOT isolated per coding job and DOES NOT include
the required persistent queue.

1. Create a Cloudflare account with Containers access and install Docker.
2. Apply the 004_multi_agent.sql migration to a development Supabase database.
3. From cloudflare/: npm install
4. Configure Cloudflare secrets: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
   SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, GITHUB_CLIENT_ID,
   GITHUB_CLIENT_SECRET, BACKEND_URL. The container must explicitly receive
   required secrets in its environment; Worker secrets are not automatically
   propagated to a Container.
5. Do not deploy publicly until secret propagation, per-job isolation, job
   queue, OAuth state persistence, concurrency and security are implemented.
6. Use npx wrangler dev for config testing. Validate the image build context
   before running npx wrangler deploy.

Required production work: durable queue, per-job isolated containers,
progress/cancellation API, rate limiting, per-user OAuth state persistence,
secret forwarding, secrets isolation, and end-to-end provider smoke tests.

References:
https://developers.cloudflare.com/containers/get-started/
https://developers.cloudflare.com/containers/configuration/wrangler/
