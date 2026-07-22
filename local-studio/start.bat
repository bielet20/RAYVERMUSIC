@echo off
REM RAYVER Local Studio — arrancar en Windows
set "SCRIPT_DIR=%~dp0"
set "VENV=%SCRIPT_DIR%.venv"

if not exist "%VENV%" (
    echo No se encontro el entorno virtual. Ejecuta primero: install.bat
    pause
    exit /b 1
)

call "%VENV%\Scripts\activate.bat"
python "%SCRIPT_DIR%studio.py" %*
