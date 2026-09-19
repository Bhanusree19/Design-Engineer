# Node 22+ is required: @supabase/supabase-js needs the native WebSocket that
# only ships in Node >= 22 (Node 20 crashes on startup).
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache git

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=4000
ENV BACKEND_URL=http://localhost:4000
ENV CODEX_HOME=/app/.codex

EXPOSE 4000

CMD ["npm", "start"]
