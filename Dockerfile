# Stage 1 - build web + bot
FROM node:22-alpine AS builder
WORKDIR /app
ENV NODE_ENV=development

# Enable npm workspaces install
COPY package.json package-lock.json ./
COPY apps/bot/package.json ./apps/bot/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY scripts ./scripts
RUN npm install

COPY . .
RUN npm run build
RUN npm prune --omit=dev

# Stage 2 - production image
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Copy necessary runtime files
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/bot ./apps/bot

EXPOSE 3000
CMD ["node", "apps/bot/dist/main.js"]
