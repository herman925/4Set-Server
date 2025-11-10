#!/usr/bin/env python3
"""
Local Development CORS Proxy Server for JotForm API

Purpose: Bypass CORS restrictions during local development by proxying
         requests from browser to JotForm API.

Why Flask: The project already uses Python for parser/ and upload.py,
           so Flask adds zero new dependencies compared to Node.js.

Usage:
    python proxy_server.py --port 3000 --host 127.0.0.1

Production: NOT needed - GitHub Pages has no CORS restrictions.
            This is ONLY for local development.
"""

import os
import sys
import argparse
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)  # Enable CORS for all routes

# JotForm API base URL
JOTFORM_API_BASE = 'https://api.jotform.com'


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint for monitoring"""
    return jsonify({
        'status': 'healthy',
        'service': '4Set CORS Proxy',
        'version': '1.0.0'
    }), 200


@app.route('/api/jotform/form/<form_id>/submissions', methods=['GET'])
def proxy_submissions(form_id):
    """
    Proxy endpoint for JotForm submissions API
    
    Forwards GET requests to:
    https://api.jotform.com/form/{form_id}/submissions
    
    Preserves all query parameters (apiKey, limit, offset, etc.)
    """
    try:
        # Build JotForm API URL with query parameters
        jotform_url = f'{JOTFORM_API_BASE}/form/{form_id}/submissions'
        
        logger.info(f'[PROXY] Forwarding submissions request: {jotform_url}')
        logger.debug(f'[PROXY] Query params: {dict(request.args)}')
        
        # Forward request to JotForm API with streaming for large responses
        response = requests.get(
            jotform_url,
            params=dict(request.args),
            timeout=(10, 120),  # (connect timeout, read timeout)
            stream=False  # Don't stream initially, get full response
        )
        
        logger.info(f'[PROXY] JotForm response status: {response.status_code}')
        
        # Check response size
        content_length = response.headers.get('content-length', 'unknown')
        logger.info(f'[PROXY] Response size: {content_length} bytes')
        
        # Parse JSON with explicit encoding and error handling
        try:
            # Force UTF-8 encoding for response
            response.encoding = 'utf-8'
            
            # Get raw text first to check
            text_data = response.text
            logger.info(f'[PROXY] Received {len(text_data)} characters')
            
            # Try to parse JSON from text
            import json
            data = json.loads(text_data)
            
            logger.info(f'[PROXY] Successfully parsed JSON response')
            
            # Check if it's a valid JotForm response
            if 'content' in data:
                logger.info(f'[PROXY] Found {len(data.get("content", []))} submissions')
            
            return jsonify(data), response.status_code
            
        except json.JSONDecodeError as e:
            logger.error(f'[PROXY] JSON parsing error: {str(e)}')
            logger.error(f'[PROXY] Error at position: {e.pos}')
            logger.error(f'[PROXY] Response text preview (first 500 chars): {text_data[:500]}...')
            logger.error(f'[PROXY] Response text preview (last 500 chars): ...{text_data[-500:]}')
            logger.error(f'[PROXY] Total response length: {len(text_data)}')
            
            return jsonify({
                'error': 'json_parse_error',
                'message': f'Failed to parse JotForm response at position {e.pos}: {str(e)}',
                'response_size': len(text_data),
                'preview_start': text_data[:200],
                'preview_end': text_data[-200:] if len(text_data) > 200 else text_data
            }), 502
            
        except Exception as e:
            logger.error(f'[PROXY] Unexpected error: {str(e)}')
            return jsonify({
                'error': 'unexpected_error',
                'message': str(e)
            }), 502
        
    except requests.exceptions.Timeout:
        logger.error('[PROXY] Request to JotForm API timed out')
        return jsonify({
            'error': 'timeout',
            'message': 'Request to JotForm API timed out'
        }), 504
        
    except requests.exceptions.RequestException as e:
        logger.error(f'[PROXY] Request failed: {str(e)}')
        return jsonify({
            'error': 'proxy_error',
            'message': str(e)
        }), 502
        
    except Exception as e:
        logger.error(f'[PROXY] Unexpected error: {str(e)}')
        return jsonify({
            'error': 'internal_error',
            'message': 'Internal proxy server error'
        }), 500


@app.route('/api/jotform/form/<form_id>/questions', methods=['GET'])
def proxy_questions(form_id):
    """
    Proxy endpoint for JotForm questions API
    
    Forwards GET requests to:
    https://api.jotform.com/form/{form_id}/questions
    """
    try:
        jotform_url = f'{JOTFORM_API_BASE}/form/{form_id}/questions'
        
        logger.info(f'[PROXY] Forwarding questions request: {jotform_url}')
        
        response = requests.get(
            jotform_url,
            params=dict(request.args),
            timeout=30
        )
        
        logger.info(f'[PROXY] JotForm response status: {response.status_code}')
        
        return jsonify(response.json()), response.status_code
        
    except Exception as e:
        logger.error(f'[PROXY] Error: {str(e)}')
        return jsonify({
            'error': 'proxy_error',
            'message': str(e)
        }), 500


@app.route('/')
def index():
    """Serve index landing page at root"""
    return app.send_static_file('index.html')


@app.route('/api/logs/list', methods=['GET'])
def list_log_files():
    """
    List available log files by scanning the logs directory
    Returns JSON array of dates (YYYYMMDD format) that have valid log files
    """
    import os
    import re
    from datetime import datetime
    
    try:
        logs_dir = os.path.join(os.getcwd(), 'logs')
        available_dates = []
        
        if not os.path.exists(logs_dir):
            return jsonify([]), 200
        
        # Pattern: YYYYMMDD_processing_agent.csv
        pattern = re.compile(r'^(\d{8})_processing_agent\.csv$')
        
        for filename in os.listdir(logs_dir):
            match = pattern.match(filename)
            if not match:
                continue
            
            date_str = match.group(1)
            filepath = os.path.join(logs_dir, filename)
            
            # Check if file has real logs (not just "Rolled log file" entries)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                    has_real_logs = False
                    
                    for i, line in enumerate(lines):
                        line = line.strip()
                        
                        # Skip empty lines
                        if not line:
                            continue
                        
                        # Skip header line (first line or lines starting with timestamp,level,file,message)
                        if i == 0 or line.lower().startswith('timestamp,'):
                            continue
                        
                        # This is a data line - check if it's NOT just a "Rolled log file" entry
                        if 'Rolled log file to' not in line:
                            has_real_logs = True
                            break
                    
                    if has_real_logs:
                        available_dates.append(date_str)
            except Exception as e:
                logger.warning(f'[LOGS] Error reading {filename}: {str(e)}')
                continue
        
        # Sort dates in descending order (newest first)
        available_dates.sort(reverse=True)
        
        logger.info(f'[LOGS] Found {len(available_dates)} valid log files')
        return jsonify(available_dates), 200
        
    except Exception as e:
        logger.error(f'[LOGS] Error listing log files: {str(e)}')
        return jsonify({
            'error': 'server_error',
            'message': str(e)
        }), 500


@app.route('/<path:path>')
def serve_static(path):
    """
    Serve static files from the workspace root
    
    This allows accessing files like:
    - /TEMP/test-pipeline-core-id.html
    - /assets/js/task-validator.js
    - /assets/tasks/CM.json
    
    Without this route, Flask only serves files from the exact static_folder root.
    """
    try:
        return app.send_static_file(path)
    except Exception as e:
        logger.error(f'[STATIC] Error serving {path}: {str(e)}')
        return jsonify({
            'error': 'file_not_found',
            'message': f'File not found: {path}'
        }), 404


def print_banner(host, port):
    """Print startup banner"""
    print(f"""
╔════════════════════════════════════════════════════════════╗
║  4Set System - Local Development CORS Proxy              ║
╠════════════════════════════════════════════════════════════╣
║  Status: Running on http://{host}:{port:<28} ║
║  Health: http://{host}:{port}/health{' ' * (28 - len(str(port)))}║
║  Homepage: http://{host}:{port}/index.html{' ' * (18 - len(str(port)))}║
╠════════════════════════════════════════════════════════════╣
║  API Routes:                                              ║
║  • /api/jotform/form/<id>/submissions                    ║
║  • /api/jotform/form/<id>/questions                      ║
╠════════════════════════════════════════════════════════════╣
║  Production: This proxy is NOT needed on GitHub Pages    ║
║  Security: For local development only - DO NOT expose    ║
╚════════════════════════════════════════════════════════════╝

Press Ctrl+C to stop the server
""")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='4Set System CORS Proxy Server for Local Development'
    )
    parser.add_argument(
        '--port', '-p',
        type=int,
        default=5000,
        help='Port to run the proxy server (default: 5000, avoiding Windows reserved port 3000)'
    )
    parser.add_argument(
        '--host', '-H',
        type=str,
        default='127.0.0.1',
        help='Host to bind the server (default: 127.0.0.1)'
    )
    parser.add_argument(
        '--debug',
        action='store_true',
        help='Enable debug logging'
    )
    
    args = parser.parse_args()
    
    if args.debug:
        logger.setLevel(logging.DEBUG)
    
    print_banner(args.host, args.port)
    
    # Run Flask development server
    app.run(
        host=args.host,
        port=args.port,
        debug=args.debug,
        threaded=True
    )
