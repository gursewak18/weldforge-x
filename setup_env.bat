@echo off
echo ========================================================
echo   WELDFORGE-X: Industrial Digital Twin Env Setup
echo ========================================================
cd /d "%~dp0"

echo [1/3] Creating virtual environment (.venv)...
python -m venv .venv
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to create virtual environment. Ensure Python is in your PATH.
    pause
    exit /b %ERRORLEVEL%
)

echo [2/3] Upgrading pip...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip

echo [3/3] Installing dependencies from requirements.txt...
pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to install requirements.
    pause
    exit /b %ERRORLEVEL%
)

echo ========================================================
echo   Virtual environment successfully initialized!
echo   To launch the digital twin, run: start.bat
echo ========================================================
pause
