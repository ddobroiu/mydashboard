FROM node:20-slim AS base

# Install dependencies only when needed
FROM base AS deps
RUN apt-get update && apt-get install -y openssl libssl-dev libc6-dev
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate

# Rebuild the source code only when needed
FROM base AS builder
# Install openssl for Prisma client generation
RUN apt-get update && apt-get install -y openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Fara baza la build: niciun URL real / parola nu intra in imagine. Build-ul nu se conecteaza la baza
# (paginile care citesc din ea se randeaza la cerere); lib/prisma cere doar ca variabila sa existe.
# URL-ul real vine la rulare din .env de pe server (docker-compose env_file).

# Generate Prisma Client
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build npx prisma generate

# Build Next.js
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build NEXT_TELEMETRY_DISABLED=1 npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

# Install openssl in the runner for prisma to work
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy prisma generated client so it works at runtime
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
