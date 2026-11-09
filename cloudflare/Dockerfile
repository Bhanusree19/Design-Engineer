# Cloudflare Containers image. Build context is cloudflare/ (prepared by
# npm run prepare:image). Do not bake any .env, OAuth credentials or user data.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY build/backend/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code opencode-ai
COPY build/backend/ ./
# This service launches isolated unprivileged CLI processes; the Express
# orchestrator retains access to server-side Supabase and OAuth secrets.
ENV PORT=4000 NODE_ENV=production AGENT_OS_ISOLATION=1
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","server.js"]
