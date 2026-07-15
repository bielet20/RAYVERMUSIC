#!/bin/sh
set -e

# Función de arranque del backend con reinicio automático
start_backend() {
  echo "[start] Arrancando backend Node.js..."
  cd /app/backend
  while true; do
    node index.js
    echo "[start] Backend terminó (exit $?). Reiniciando en 3s..."
    sleep 3
  done &
}

start_backend

# Esperar a que el backend esté listo (máx 10s)
echo "[start] Esperando al backend..."
for i in $(seq 1 10); do
  if wget -q -O- http://127.0.0.1:3001/api/tracks > /dev/null 2>&1; then
    echo "[start] Backend listo."
    break
  fi
  sleep 1
done

echo "[start] Arrancando nginx..."
nginx -g 'daemon off;'
