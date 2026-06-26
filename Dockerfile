# ── Stage 1: instalar dependencias del backend ────────────────────────────────
FROM node:20-alpine AS backend-deps
WORKDIR /backend
COPY backend/package*.json ./
RUN npm install --omit=dev

# ── Stage 2: imagen final con nginx + node ────────────────────────────────────
FROM nginx:alpine

# Instalar Node.js en la imagen nginx-alpine
RUN apk add --no-cache nodejs npm

# Copiar frontend estático
COPY index.html gracias.html styles.css script.js radio.js \
     robots.txt sitemap.xml nginx.conf \
     logo.jpg hero_bg.png /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copiar backend
WORKDIR /app/backend
COPY backend/ ./
COPY --from=backend-deps /backend/node_modules ./node_modules
RUN mkdir -p /app/data

# Script de arranque: lanza node en background y nginx en foreground
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 80
CMD ["/start.sh"]
