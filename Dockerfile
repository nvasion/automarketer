# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 – development
#   Used by docker-compose.yml for local dev with hot-module reload.
#   Source is volume-mounted at runtime; only deps are baked into the image.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS development

WORKDIR /app

# Install deps before copying source — maximises layer cache reuse
COPY package*.json ./
RUN npm ci

# Source directory is mounted via docker-compose volume; not copied here
EXPOSE 5173

CMD ["npm", "run", "dev"]

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 – builder
#   Compiles TypeScript and produces the optimised production bundle in /app/dist
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 – production
#   Lightweight nginx image that serves the static bundle.
#   Only the compiled dist/ directory is copied — no Node.js or source code.
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.25-alpine AS production

# Remove default nginx config and replace with our SPA-aware config
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
