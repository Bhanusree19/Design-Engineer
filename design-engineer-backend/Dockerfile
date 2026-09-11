FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=4000
ENV BACKEND_URL=http://localhost:4001
ENV CODEX_HOME=/app/.codex

EXPOSE 4000

CMD ["npm", "start"]
