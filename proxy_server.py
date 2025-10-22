#!/usr/bin/env python3
"""
Simple CORS proxy server for JotForm API requests.
This server forwards requests to the JotForm API and adds appropriate CORS headers
to allow browser-based applications to make API calls.

Usage:
    python proxy_server.py [--port PORT] [--host HOST]

Example:
    python proxy_server.py --port 3000 --host 127.0.0.1
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import argparse
import logging
from urllib.parse import urlencode

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

JOTFORM_API_BASE = "https://api.jotform.com"


@app.route('/api/jotform/form/<form_id>/submissions', methods=['GET', 'OPTIONS'])
def proxy_form_submissions(form_id):
    """Proxy GET requests to JotForm form submissions endpoint."""
    if request.method == 'OPTIONS':
        # Handle preflight CORS request
        return '', 204
    
    try:
        # Build the JotForm API URL
        url = f"{JOTFORM_API_BASE}/form/{form_id}/submissions"
        
        # Forward query parameters
        params = dict(request.args)
        
        logger.info(f"Proxying request to: {url}")
        logger.info(f"Parameters: {params}")
        
        # Make request to JotForm API
        response = requests.get(url, params=params, timeout=30)
        
        # Log response status
        logger.info(f"JotForm API response status: {response.status_code}")
        
        # Return the response with proper CORS headers
        return jsonify(response.json()), response.status_code
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Error proxying request: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/api/jotform/form/<form_id>/questions', methods=['GET', 'OPTIONS'])
def proxy_form_questions(form_id):
    """Proxy GET requests to JotForm form questions endpoint."""
    if request.method == 'OPTIONS':
        return '', 204
    
    try:
        url = f"{JOTFORM_API_BASE}/form/{form_id}/questions"
        params = dict(request.args)
        
        logger.info(f"Proxying questions request to: {url}")
        
        response = requests.get(url, params=params, timeout=30)
        logger.info(f"JotForm API response status: {response.status_code}")
        
        return jsonify(response.json()), response.status_code
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Error proxying request: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "ok", "service": "jotform-proxy"}), 200


@app.route('/', methods=['GET'])
def index():
    """Root endpoint with service information."""
    return jsonify({
        "service": "JotForm CORS Proxy",
        "version": "1.0.0",
        "endpoints": {
            "/api/jotform/form/<form_id>/submissions": "Proxy to JotForm submissions API",
            "/api/jotform/form/<form_id>/questions": "Proxy to JotForm questions API",
            "/health": "Health check"
        }
    }), 200


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='JotForm CORS Proxy Server')
    parser.add_argument('--port', type=int, default=3000,
                       help='Port to listen on (default: 3000)')
    parser.add_argument('--host', type=str, default='127.0.0.1',
                       help='Host to bind to (default: 127.0.0.1)')
    parser.add_argument('--debug', action='store_true',
                       help='Enable debug mode')
    
    args = parser.parse_args()
    
    logger.info(f"Starting JotForm CORS Proxy Server on {args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == '__main__':
    main()
