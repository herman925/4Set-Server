@echo off
REM Windows startup script for 4Set System local development
REM Starts Flask CORS proxy server

echo ========================================
echo 4Set System - Starting Development Server
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found!
    echo Please install Python 3.7+ from https://www.python.org/
    pause
    exit /b 1
)

REM Check if Flask is installed
python -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo Installing required packages...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Kill any existing proxy server processes on port 5000
echo Checking for existing proxy servers...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000"') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo Starting CORS proxy server on http://127.0.0.1:5000
echo.
echo Opening browser in 3 seconds...
echo Press Ctrl+C to stop the server
echo.

REM Start the proxy server in background and wait for it to initialize
start /B python proxy_server.py --port 5000 --host 127.0.0.1

REM Wait 3 seconds for server to start
timeout /t 3 /nobreak >nul

REM Open browser
start http://127.0.0.1:5000/index.html

echo.
echo Server is running! Browser should open automatically.
echo Close this window to stop the server.
echo.

REM Keep window open (server runs in background)
pause
