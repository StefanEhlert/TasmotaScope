# Build (Kontext = Repo-Root, damit shared/ verfügbar ist)
FROM node:20-alpine AS builder
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=1024
# shared nach /shared (Backend package.json: "file:../shared" → /app/../shared)
COPY shared /shared
RUN cd /shared && npm ci && npm run build
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# Run
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json ./
COPY --from=builder /shared /shared
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
