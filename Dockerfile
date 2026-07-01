# Stage 1: dependencias Node
FROM node:20-alpine AS backend-deps
WORKDIR /backend
COPY backend/package*.json ./
RUN npm install --omit=dev

# Stage 2: contenedor único nginx + node
FROM nginx:alpine
RUN apk add --no-cache nodejs

# Frontend estático — todos los archivos html y assets
COPY index.html gracias.html admin.html styles.css script.js radio.js \
     robots.txt sitemap.xml logo.jpg hero_bg.png \
     manifest.json service-worker.js pwa-install.js \
     /usr/share/nginx/html/

# PWA — iconos
COPY icons/ /usr/share/nginx/html/icons/

# nginx.conf apuntando a localhost (contenedor único)
COPY nginx-single.conf /etc/nginx/conf.d/default.conf

# Backend Node
WORKDIR /app/backend
COPY backend/ ./
COPY --from=backend-deps /backend/node_modules ./node_modules
# /app/data es donde Coolify monta el volumen persistente
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

# Script de arranque
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 80
CMD ["/start.sh"]
