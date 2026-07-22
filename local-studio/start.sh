#!/usr/bin/env bash
# RAYVER Local Studio — arrancar en Linux / Mac
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV" ]; then
    echo "❌ Entorno virtual no encontrado. Ejecuta primero: bash install.sh"
    exit 1
fi

source "$VENV/bin/activate"
exec python "$SCRIPT_DIR/studio.py" "$@"
