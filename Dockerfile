# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Stage 1: deps — install npm packages + generate Prisma Client.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# openssl is required by Prisma engine at install time on Alpine.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
# Reproducible install. devDeps included — needed for `tsc` (next stage) and
# the `prisma` CLI (used at runtime by entrypoint.sh for `migrate deploy`).
RUN npm ci --no-audit --no-fund
RUN npx prisma generate

# -----------------------------------------------------------------------------
# Stage 2: builder — compile TypeScript to dist/.
# -----------------------------------------------------------------------------
FROM deps AS builder
WORKDIR /app

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3: runner — minimal runtime image.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

# openssl: Prisma engine. tini: proper PID 1 (signal forwarding, zombie reaping).
RUN apk add --no-cache openssl tini \
  && addgroup -S app \
  && adduser -S app -G app

ENV NODE_ENV=production \
    PORT=3000

# Bring in installed deps (incl. generated Prisma Client) and compiled output.
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist          ./dist
COPY --from=deps    /app/prisma        ./prisma
COPY package.json ./
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh && chown -R app:app /app

USER app
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--", "./entrypoint.sh"]
