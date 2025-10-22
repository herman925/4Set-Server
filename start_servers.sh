#!/bin/bash
# Start both the proxy server and HTTP server for local development

echo "Starting 4Set System servers..."
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed or not in PATH"
    exit 1
fi

# Check if dependencies are installed
echo "Checking Python dependencies..."
python3 -c "import flask, flask_cors, requests" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "Installing Python dependencies..."
    pip install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "Error: Failed to install dependencies"
        exit 1
    fi
fi

# Start the CORS proxy server in the background
echo "Starting CORS proxy server on http://127.0.0.1:3000..."
python3 proxy_server.py --port 3000 > /tmp/proxy_server.log 2>&1 &
PROXY_PID=$!
echo "  ✓ Proxy server started (PID: $PROXY_PID)"
echo "    Logs: /tmp/proxy_server.log"

# Wait a moment for the proxy to start
sleep 2

# Start the HTTP file server in the background
echo "Starting HTTP file server on http://127.0.0.1:8080..."
python3 -m http.server 8080 > /tmp/http_server.log 2>&1 &
HTTP_PID=$!
echo "  ✓ HTTP server started (PID: $HTTP_PID)"
echo "    Logs: /tmp/http_server.log"

echo ""
echo "=========================="
echo "Servers are running!"
echo "=========================="
echo ""
echo "Access the application:"
echo "  • Main page:        http://127.0.0.1:8080/index.html"
echo "  • Upload interface: http://127.0.0.1:8080/upload.html"
echo "  • Checking system:  http://127.0.0.1:8080/checking_system_home.html"
echo ""
echo "Proxy server:"
echo "  • Health check:     http://127.0.0.1:3000/health"
echo "  • Service info:     http://127.0.0.1:3000/"
echo ""
echo "To stop the servers, run:"
echo "  kill $PROXY_PID $HTTP_PID"
echo ""
echo "Or press Ctrl+C to stop all servers"
echo ""

# Save PIDs to a file for easy cleanup
echo "$PROXY_PID" > /tmp/4set_servers.pid
echo "$HTTP_PID" >> /tmp/4set_servers.pid

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Stopping servers..."
    kill $PROXY_PID 2>/dev/null
    kill $HTTP_PID 2>/dev/null
    rm -f /tmp/4set_servers.pid
    echo "Servers stopped."
    exit 0
}

# Trap Ctrl+C
trap cleanup INT

# Keep the script running
echo "Press Ctrl+C to stop all servers"
wait
