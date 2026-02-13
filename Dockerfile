# Stage 1 - install deps and build
FROM node:22-alpine AS builder
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build
RUN pnpm prune --prod

# Stage 2 - production runtime
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000
CMD ["node", "apps/bot/dist/main.js"]
