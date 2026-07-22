@echo off
REM ─────────────────────────────────────────────────────────
REM RAYVER Local Studio — Instalador Windows
REM Ejecuta: install.bat
REM ─────────────────────────────────────────────────────────
setlocal

set "SCRIPT_DIR=%~dp0"
set "VENV=%SCRIPT_DIR%.venv"
set "YUE_DIR=%USERPROFILE%\YuE"

echo.
echo ============================================
echo    RAYVER Local Studio - Setup Windows
echo ============================================
echo.

REM 1. Entorno virtual
echo -- Creando entorno virtual...
python -m venv "%VENV%"
call "%VENV%\Scripts\activate.bat"
pip install --upgrade pip --quiet

REM 2. PyTorch CUDA 12.1
echo -- Instalando PyTorch con CUDA 12.1...
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 --quiet

REM 3. Servidores GPU
echo -- Instalando dependencias de servidores...
pip install fastapi "uvicorn[standard]" pydantic --quiet

REM 4. Studio
echo -- Instalando dependencias del studio...
pip install -r "%SCRIPT_DIR%requirements.txt" --quiet

REM 5. ACE-Step
echo -- Instalando ACE-Step...
pip install git+https://github.com/ace-step/ACE-Step.git --quiet

REM 6. YuE
echo -- Clonando/actualizando YuE en %YUE_DIR%...
if not exist "%YUE_DIR%" (
    git clone https://github.com/multimodal-art-project/YuE.git "%YUE_DIR%"
) else (
    git -C "%YUE_DIR%" pull
)
if exist "%YUE_DIR%\requirements.txt" (
    pip install -r "%YUE_DIR%\requirements.txt" --quiet
)

REM 7. xcodec2
echo -- Instalando xcodec2...
pip install git+https://github.com/zhenye234/xcodec2.git --quiet || pip install xcodec2 --quiet

REM 8. Guardar ruta YuE
python -c "import json,os; p='%SCRIPT_DIR%config.json'; c=json.load(open(p)) if os.path.exists(p) else {}; c['yue_dir']='%YUE_DIR%'; json.dump(c,open(p,'w'),indent=2)"

echo.
echo ============================================
echo    Instalacion completada
echo    Arrancar: start.bat
echo ============================================
echo.
pause
