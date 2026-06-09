FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html gracias.html styles.css script.js radio.js \
     logo.jpg hero_bg.png robots.txt sitemap.xml \
     /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
