# Node 22+ is required: @supabase/supabase-js needs the native WebSocket that
# only ships in Node >= 22 (Node 20 crashes on startup).
#
# Use a glibc (Debian) base image, NOT Alpine: the @openai/codex Linux binary
# that npm installs is compiled against glibc and will not run on Alpine/musl.
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=4000
ENV BACKEND_URL=http://localhost:4000
ENV CODEX_HOME=/app/.codex

EXPOSE 4000

CMD ["npm", "start"]
