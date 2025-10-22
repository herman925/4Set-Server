@echo off
REM Start both the proxy server and HTTP server for local development

echo Starting 4Set System servers...
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not installed or not in PATH
    pause
    exit /b 1
)

REM Check if dependencies are installed
echo Checking Python dependencies...
python -c "import flask, flask_cors, requests" 2>nul
if errorlevel 1 (
    echo Installing Python dependencies...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo Error: Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Start the CORS proxy server in a new window
echo Starting CORS proxy server on http://127.0.0.1:3000...
start "4Set Proxy Server" /MIN python proxy_server.py --port 3000
echo   + Proxy server started in background window
timeout /t 2 /nobreak >nul

REM Start the HTTP file server in a new window
echo Starting HTTP file server on http://127.0.0.1:8080...
start "4Set HTTP Server" /MIN python -m http.server 8080
echo   + HTTP server started in background window

echo.
echo ==========================
echo Servers are running!
echo ==========================
echo.
echo Access the application:
echo   * Main page:        http://127.0.0.1:8080/index.html
echo   * Upload interface: http://127.0.0.1:8080/upload.html
echo   * Checking system:  http://127.0.0.1:8080/checking_system_home.html
echo.
echo Proxy server:
echo   * Health check:     http://127.0.0.1:3000/health
echo   * Service info:     http://127.0.0.1:3000/
echo.
echo To stop the servers, close the "4Set Proxy Server" and "4Set HTTP Server" windows
echo or press Ctrl+C in each window.
echo.
pause
