#!/bin/sh
# Arrancar backend Node.js en background
cd /app/backend
node index.js &
# Arrancar nginx en foreground
nginx -g 'daemon off;'
