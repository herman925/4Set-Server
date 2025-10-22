#!/bin/bash
# Linux/Mac startup script for 4Set System local development
# Starts Flask CORS proxy server

echo "========================================"
echo "4Set System - Starting Development Server"
echo "========================================"
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 not found!"
    echo "Please install Python 3.7+ from https://www.python.org/"
    exit 1
fi

# Check if Flask is installed
if ! python3 -c "import flask" &> /dev/null; then
    echo "Installing required packages..."
    pip3 install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to install dependencies"
        exit 1
    fi
fi

# Kill any existing proxy server processes on port 3000
echo "Checking for existing proxy servers..."
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Stopping existing proxy server..."
    lsof -Pi :3000 -sTCP:LISTEN -t | xargs kill -9 2>/dev/null || true
    sleep 1
fi

echo ""
echo "Starting CORS proxy server on http://127.0.0.1:3000"
echo ""
echo "Opening browser in 3 seconds..."
echo "Press Ctrl+C to stop the server"
echo ""

# Start the proxy server in background
python3 proxy_server.py --port 3000 --host 127.0.0.1 &
SERVER_PID=$!

# Wait 3 seconds for server to start
sleep 3

# Open browser (cross-platform detection)
URL="http://127.0.0.1:3000/checking_system_home.html"
if command -v xdg-open &> /dev/null; then
    xdg-open "$URL"  # Linux
elif command -v open &> /dev/null; then
    open "$URL"      # macOS
elif command -v start &> /dev/null; then
    start "$URL"     # Windows (Git Bash)
else
    echo "Could not open browser automatically. Please visit:"
    echo "  $URL"
fi

echo ""
echo "Server is running! Browser should open automatically."
echo "Press Ctrl+C to stop the server."
echo ""

# Wait for server process
wait $SERVER_PID
