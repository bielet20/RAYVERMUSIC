#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# RAYVER Local Studio — Instalador Linux / Mac
# Ejecuta: bash install.sh
# ─────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SCRIPT_DIR/.venv"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       RAYVER Local Studio — Setup        ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# 1. Entorno virtual
echo "→ Creando entorno virtual…"
python3 -m venv "$VENV"
source "$VENV/bin/activate"
pip install --upgrade pip --quiet

# 2. PyTorch (CUDA 12.1 — ajusta si tienes otra versión)
echo "→ Instalando PyTorch con CUDA 12.1…"
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 --quiet

# 3. Dependencias base de los servidores GPU
echo "→ Instalando dependencias de servidores…"
pip install "fastapi>=0.111.0" "uvicorn[standard]>=0.30.0" pydantic --quiet

# 4. Dependencias del studio
echo "→ Instalando dependencias del studio…"
pip install -r "$SCRIPT_DIR/requirements.txt" --quiet

# 5. ACE-Step
echo ""
echo "→ Instalando ACE-Step…"
pip install git+https://github.com/ace-step/ACE-Step.git --quiet || {
    echo "⚠️  ACE-Step no se pudo instalar desde git. Intenta manualmente:"
    echo "    pip install git+https://github.com/ace-step/ACE-Step.git"
}

# 6. YuE
echo ""
YUE_DIR="${YUE_DIR:-$HOME/YuE}"
if [ ! -d "$YUE_DIR" ]; then
    echo "→ Clonando YuE en $YUE_DIR…"
    git clone https://github.com/multimodal-art-project/YuE.git "$YUE_DIR"
else
    echo "→ YuE ya existe en $YUE_DIR, actualizando…"
    git -C "$YUE_DIR" pull --quiet
fi

if [ -f "$YUE_DIR/requirements.txt" ]; then
    echo "→ Instalando dependencias de YuE…"
    pip install -r "$YUE_DIR/requirements.txt" --quiet
fi

echo "→ Instalando xcodec2 (vocoder YuE)…"
pip install git+https://github.com/zhenye234/xcodec2.git --quiet || \
pip install xcodec2 --quiet || \
echo "⚠️  xcodec2 no disponible — YuE puede no funcionar."

# 7. Guardar ruta YuE en config
CFG="$SCRIPT_DIR/config.json"
if [ ! -f "$CFG" ]; then
    echo "{\"yue_dir\": \"$YUE_DIR\"}" > "$CFG"
else
    # Añadir/actualizar yue_dir con python
    python3 -c "
import json, sys
with open('$CFG') as f: c = json.load(f)
c['yue_dir'] = '$YUE_DIR'
with open('$CFG', 'w') as f: json.dump(c, f, indent=2)
"
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✅  Instalación completada             ║"
echo "║                                          ║"
echo "║   Arrancar:  bash start.sh               ║"
echo "╚══════════════════════════════════════════╝"
echo ""
