@echo off
cd /d "%~dp0"
echo =======================================================
echo WELDFORGE-X // Industrial Digital Twin Launcher
echo =======================================================
echo.
echo Starting local WebGL and HTML5 server on port 8000...
echo.

:: Verify virtual environment exists to run Python securely
if not exist .venv (
    echo Error: Virtual environment not found. Please run setup_env.bat first!
    pause
    exit /b 1
)

:: Launch Python HTTP Server in the background using venv Python
start /b .venv\Scripts\python.exe -m http.server 8000 > nul 2>&1

:: Wait 2 seconds for server to bind port using ping (failsafe sleep)
ping 127.0.0.1 -n 3 > nul

:: Open default browser to the webapp homepage
echo Launching web interface in your default browser...
start http://localhost:8000

echo.
echo -------------------------------------------------------
echo Digital Twin successfully running at: http://localhost:8000
echo Telemetry Dashboard available at: http://localhost:8000/dashboard.html
echo -------------------------------------------------------
echo.
echo Press any key to stop the server and exit...
pause > nul

:: Find and terminate the background Python HTTP server
taskkill /f /im python.exe > nul 2>&1
echo.
echo Server stopped. Exit complete.
ping 127.0.0.1 -n 2 > nul
