@echo off
REM Windows startup script for Pipeline Test (test-pipeline-core-id.html)
REM Starts Flask CORS proxy server and opens the test page

echo ========================================
echo Pipeline Test - Starting Local Server
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
    cd ..
    pip install -r requirements.txt
    cd TEMP
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
echo This allows the test page to access JotForm and Qualtrics APIs
echo.
echo Opening test page in 3 seconds...
echo Press Ctrl+C to stop the server
echo.

REM Start the proxy server from parent directory
cd ..
start /B python proxy_server.py --port 5000 --host 127.0.0.1

REM Wait 3 seconds for server to start
timeout /t 3 /nobreak >nul

REM Open test page through proxy server (not file://)
start http://localhost:5000/TEMP/test-pipeline-core-id.html

echo.
echo ========================================
echo Server is running!
echo ========================================
echo.
echo Test page URL: http://localhost:5000/TEMP/test-pipeline-core-id.html
echo.
echo IMPORTANT: The page MUST be accessed via http://localhost:5000
echo            (NOT file:// protocol) for the proxy to work!
echo.
echo If the page doesn't open automatically:
echo 1. Open your browser manually
echo 2. Navigate to: http://localhost:5000/TEMP/test-pipeline-core-id.html
echo.
echo Close this window to stop the server.
echo.

REM Keep window open (server runs in background)
pause
