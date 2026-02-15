# Stage 1 - install deps and build
FROM node:22-alpine AS builder
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Stage 2 - production runtime (install prod deps here so workspace deps are correct)
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# FFmpeg required for audio playback (prism-media spawns it to decode/transcode)
RUN apk add --no-cache ffmpeg

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --prod

# Overlay built output from builder (dist, web-dist)
COPY --from=builder /app/apps ./apps

EXPOSE 3000
CMD ["node", "apps/bot/dist/main.js"]
