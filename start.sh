#!/bin/sh
echo "[start] Arrancando backend Node.js..."
cd /app/backend
node index.js &
NODE_PID=$!
echo "[start] Node PID: $NODE_PID"
sleep 2
echo "[start] Arrancando nginx..."
nginx -g 'daemon off;'
