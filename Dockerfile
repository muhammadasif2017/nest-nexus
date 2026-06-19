# ── Build stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# bcrypt and sharp compile/link native bindings on install.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY prisma.config.ts tsconfig.json ./
COPY prisma ./prisma

ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate

COPY src ./src
RUN npm run build

# Drop devDependencies now that the build artifacts exist.
RUN npm prune --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S nestjs && adduser -S nestjs -G nestjs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY package.json ./

USER nestjs
EXPOSE 3000
CMD ["node", "dist/main"]
