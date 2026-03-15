FROM nginx:alpine

# Copiar configuración personalizada de nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copiar archivos de la web al directorio de nginx
COPY index.html /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/
COPY script.js /usr/share/nginx/html/
COPY logo.jpg /usr/share/nginx/html/
COPY hero_bg.png /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
