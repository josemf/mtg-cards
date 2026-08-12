# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER app

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]