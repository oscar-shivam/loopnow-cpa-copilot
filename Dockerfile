# FROM node:24-alpine AS dependencies
# WORKDIR /app
# COPY package.json package-lock.json* ./
# RUN npm ci

# FROM node:24-alpine AS builder
# WORKDIR /app
# COPY --from=dependencies /app/node_modules ./node_modules
# COPY . .
# RUN npm run build

# FROM node:24-alpine AS runner
# WORKDIR /app
# ENV NODE_ENV=production
# COPY --from=builder /app/.next ./.next
# COPY --from=builder /app/public ./public
# COPY --from=builder /app/package.json ./package.json
# COPY --from=builder /app/node_modules ./node_modules
# COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
# COPY --from=builder /app/db ./db
# EXPOSE 3000
# CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && npm run start"]





FROM node:24-alpine AS dependencies

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci


FROM node:24-alpine AS builder

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules

COPY . .

RUN npm run build


FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/db ./db
COPY --from=builder /app/domain ./domain

EXPOSE 3000

CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && npm run start"]