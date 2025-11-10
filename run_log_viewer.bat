@echo off
REM ========================================
REM Log Viewer Launcher with Local Server
REM ========================================
REM Starts proxy_server.py and opens log.html in browser
REM 
REM Why needed: log.html needs to read CSV files from ./logs/
REM which requires a web server (CORS restrictions prevent file:// access)
REM ========================================

echo.
echo ========================================
echo Log Viewer Server Launcher
echo ========================================
echo.

REM Check if Python is installed
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python not found!
    echo.
    echo Please install Python from:
    echo https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

REM Check if required packages are installed
echo Checking dependencies...
python -c "import flask, flask_cors, requests" 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] Required packages not installed. Installing now...
    echo.
    pip install flask flask-cors requests
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

echo Starting local server...
echo.
echo Server will serve files from: %SCRIPT_DIR%
echo Log files location: %SCRIPT_DIR%logs\
echo.
echo Press Ctrl+C to stop the server
echo.

REM Start server and open browser
start http://localhost:3000/log.html
python "%SCRIPT_DIR%proxy_server.py" --port 3000 --host 127.0.0.1

REM This line is reached when server is stopped
echo.
echo Server stopped.
pause
